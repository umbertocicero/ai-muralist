import { CONFIG } from './config.js';
import { muralThumb } from './helpers.js';
import { getToken, onAuthChange } from './auth.js';

// ===========================================================================
//  LiveLink — the browser's window onto the ONE shared, server-authoritative
//  Kay (Durable Object at <worker>/live). The client stops simulating Kay
//  itself: it uploads the world model once, then just renders wherever the
//  server says Kay is and applies whatever murals the server paints. Because
//  every browser talks to the same object, they all see the identical Kay.
//
//  If the socket never opens (no Worker, no DO binding, offline), main.js keeps
//  the old local Kay — LiveLink.everConnected stays false and it never takes over.
// ===========================================================================

// Build the compact model the server needs to move Kay without three.js: a
// coarse walkability grid sampled from city.isColliding (already body-inflated),
// plus the full wall catalogue with pre-computed approach points. The grid rides
// the wire as base64 (1 byte/cell) to keep the one-time upload small.
// Bump when the model's shape/resolution changes — must match worker.js
// MODEL_VERSION so a DO caching an older grid discards it and re-requests one.
export const MODEL_VERSION = 4;   // v4: connectivity filter drops unreachable wall slots from the catalogue

// Client revision, logged at connect next to the worker build: answers "is the
// deployed FRONTEND stale?" straight from the console — several "still broken"
// reports turned out to be an old Pages bundle talking to a fixed Worker.
// Bump on any behavioural change in live.js / remote-driver.js / map.js.
export const CLIENT_REV = 11;

// Build the walkability grid (with each wall's approach cell + spawn carved
// free), flood-fill the reachable region from spawn, and TAG every wall slot
// with s.unreachable / s.approach. Shared by buildWorldModel AND the map (via a
// boot-time call in main.js) so the map always knows a wall's true state even
// when the DO already has the model and buildWorldModel isn't called this load.
// Returns the grid so buildWorldModel can serialise it without rebuilding.
export function tagReachability(city) {
  const half = city.HALF, cellSize = 0.5;   // finer than before → narrow alleys stay open
  const cols = Math.ceil((half * 2) / cellSize), rows = cols;
  const cells = new Uint8Array(cols * rows);
  const idx = (gx, gz) => gz * cols + gx;
  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = -half + (gx + 0.5) * cellSize, z = -half + (gz + 0.5) * cellSize;
      if (city.isColliding(x, z)) cells[idx(gx, gz)] = 1;
    }
  }
  const cellOf = (x, z) => idx(
    Math.min(cols - 1, Math.max(0, ((x + half) / cellSize) | 0)),
    Math.min(rows - 1, Math.max(0, ((z + half) / cellSize) | 0)));

  // Carve each wall's approach cell + the spawn free, exactly as the sim expects.
  for (const s of city.wallSlots) { const ap = city.approachPoint(s); s._approach = ap; cells[cellOf(ap.x, ap.z)] = 0; }
  cells[cellOf(city.spawn.x, city.spawn.z)] = 0;

  // 8-connected flood-fill from spawn (no corner cutting — matches the sim's BFS).
  const reach = new Uint8Array(cols * rows);
  const sc = cellOf(city.spawn.x, city.spawn.z);
  const q = new Int32Array(cols * rows); let head = 0, tail = 0;
  reach[sc] = 1; q[tail++] = sc;
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (head < tail) {
    const cur = q[head++], cgx = cur % cols, cgz = (cur / cols) | 0;
    for (const [dx, dz] of NB) {
      const ngx = cgx + dx, ngz = cgz + dz;
      if (ngx < 0 || ngz < 0 || ngx >= cols || ngz >= rows) continue;
      if (dx && dz && (cells[idx(cgx + dx, cgz)] !== 0 || cells[idx(cgx, cgz + dz)] !== 0)) continue;
      const ni = idx(ngx, ngz);
      if (reach[ni] || cells[ni] !== 0) continue;
      reach[ni] = 1; q[tail++] = ni;
    }
  }

  let dropped = 0;
  for (const s of city.wallSlots) {
    s.unreachable = !reach[cellOf(s._approach.x, s._approach.z)];
    if (s.unreachable) dropped++;
  }
  return { cells, cols, rows, cellSize, half, dropped };
}

export function buildWorldModel(city) {
  const { cells, cols, rows, cellSize, half, dropped } = tagReachability(city);
  // Only REACHABLE walls go in the catalogue Kay navigates; id stays the
  // wallSlots index so the server's targetId → city.wallSlots mapping holds.
  const walls = [];
  city.wallSlots.forEach((s, id) => {
    if (s.unreachable) return;
    walls.push({ id, px: s.px, py: s.py, pz: s.pz, nx: s.nx, nz: s.nz,
                 wallW: s.wallW, wallH: s.wallH, ax: s._approach.x, az: s._approach.z });
  });
  if (dropped) console.info(`[live] ${dropped} unreachable wall slot(s) excluded (approach cut off from the street network)`);

  let bin = '';
  for (let i = 0; i < cells.length; i++) bin += String.fromCharCode(cells[i]);
  return {
    version: MODEL_VERSION,
    half, cellSize, cols, rows, cellsB64: btoa(bin),
    spawn: { x: city.spawn.x, z: city.spawn.z }, walls,
  };
}

export class LiveLink {
  constructor(workerUrl, worldKey, city, factory, ui) {
    this.city    = city;
    this.factory = factory;
    this.ui      = ui;
    this.worldKey = worldKey;
    this.url = workerUrl.replace(/\/$/, '').replace(/^http/, 'ws') + '/live?world=' + worldKey;

    this.connected     = false;   // socket open right now
    this.everConnected = false;   // ever completed a handshake (→ take over from local Kay)
    this.kay = null;              // latest server snapshot {x,z,facing,state,status,muralCount}
    this.onState = null;          // (newState, prevState) — main.js drives the camera off this
    this.onRoute = null;          // (route) — main.js hands it to the RemoteDriver to walk locally

    this._ws = null;
    this._prevState = null;
    this._backoff = 1000;
    this._closed = false;
    this._modelSent = false;
    this._seq = 0;
    this._pendingMural = null;    // finished piece held back until the spray ends
    this._muralT = null;          // safety flush if the PAINTING→ADMIRING edge is missed
  }

  start() {
    // Re-report mode when the owner signs in/out, so their (authenticated) mode
    // choice takes effect immediately.
    onAuthChange(() => { if (this.connected) this._sendMode(); });
    // Mobile Safari kills the socket WITHOUT a close event when the app is
    // backgrounded, and suspends the retry timers with the page — on return the
    // link could sit dead for many seconds (the "Kay restarted somewhere random"
    // report: the local fallback took over meanwhile). The moment the page is
    // visible again, drop whatever half-dead socket remains and reconnect NOW.
    const wake = () => { if (!this._closed && document.visibilityState === 'visible') this.reconnectNow(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);          // BFCache resume fires no visibilitychange
    // Keepalive ping: tells the server "someone is really watching" — iOS zombie
    // sockets otherwise kept the shared world ticking for minutes after the last
    // real viewer left (see the staleness guard in worker.js KayDO._tick).
    this._pingT = setInterval(() => {
      if (this.connected) { try { this._ws.send('{"type":"ping"}'); } catch {} }
    }, 20_000);
    this._connect();
    return this;
  }

  // Immediate reconnect (page came back to the foreground): reset the backoff
  // and replace the current socket unless it is provably alive and OPEN.
  reconnectNow() {
    this._backoff = 1000;
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try { this._ws.send('{"type":"ping"}'); } catch {}   // freshen the server's liveness clock
      return;
    }
    try { this._ws?.close(); } catch {}
    this._connect();
  }

  _connect() {
    if (this._closed) return;
    if (this._ws && (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN)) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch { this._retry(); return; }
    this._ws = ws;
    ws.onopen    = () => { this._backoff = 1000; };
    ws.onmessage = (ev) => this._onMessage(ev);
    ws.onclose   = () => { this.connected = false; this._retry(); };
    ws.onerror   = () => { try { ws.close(); } catch {} };
  }

  _retry() {
    if (this._closed) return;
    clearTimeout(this._retryT);
    this._retryT = setTimeout(() => this._connect(), this._backoff);
    this._backoff = Math.min(this._backoff * 2, 15000);
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'hello':
        this.connected = true; this.everConnected = true;
        console.info(`[live] connected · worker build ${msg.build} · client r${CLIENT_REV} · needWorld ${msg.needWorld}`);
        this._sendMode();                       // tell the server demo vs AI (always)
        if (msg.needWorld) this._sendModel();
        if (msg.kay) this._applyKay(msg.kay);
        if (msg.route) this.onRoute?.(msg.route);   // mid-walk joiner resumes the route
        break;
      case 'kay':
        this._applyKay(msg);
        break;
      case 'route':                             // Kay set off toward a new wall
        this.onRoute?.(msg);
        break;
      case 'mural':
        // The server sends the piece the moment generation FINISHES — for demo
        // murals that's milliseconds after the spray starts. Applying it right
        // away spoils the reveal, so while Kay is still PAINTING we hold it and
        // flush on the next state edge (→ ADMIRING): the mural appears just as
        // he steps back to admire. A 20 s timer guards a missed edge.
        if (this.kay?.state === 'PAINTING') {
          this._pendingMural = msg;
          clearTimeout(this._muralT);
          this._muralT = setTimeout(() => this._flushMural(), 20_000);
        } else {
          this._applyMural(msg);
        }
        break;
      case 'notice':   // server-side status the user should see (e.g. why Kay can't paint)
        console.warn('[live] Kay:', msg.message);
        break;
      case 'error':
        console.warn('[live] server:', msg.message);
        break;
    }
  }

  _applyKay(k) {
    this.kay = k;
    // Reveal a held mural the moment the spray ends — BEFORE the state hook, so
    // the wall already carries the piece when the camera moves in to admire it.
    if (this._pendingMural && k.state !== 'PAINTING') this._flushMural();
    if (k.state !== this._prevState) { this.onState?.(k.state, this._prevState); this._prevState = k.state; }
  }

  _flushMural() {
    const m = this._pendingMural;
    if (!m) return;
    this._pendingMural = null;
    clearTimeout(this._muralT);
    this._applyMural(m);
  }

  // Report the site's resolved mode so the server knows whether to paint
  // procedurally (demo) or call Anthropic. Sent on every connect (works even when
  // the DO already has the world model, i.e. needWorld=false).
  _sendMode() {
    if (!this._ws) return;
    // Only the OWNER may set the shared mode, so only bother the server when
    // actually signed in — a not-signed-in visitor would just get rejected
    // (that's the noisy "Sign in as the owner" notice). The owner's mode is
    // (re)sent on sign-in via onAuthChange.
    const token = getToken();
    if (!token) return;
    try { this._ws.send(JSON.stringify({ type: 'mode', demo: CONFIG.mode === 'demo', token })); } catch {}
  }

  _sendModel() {
    if (this._modelSent || !this._ws) return;
    this._modelSent = true;
    const model = buildWorldModel(this.city);
    this._ws.send(JSON.stringify({ type: 'world', worldKey: this.worldKey, model, demo: CONFIG.mode === 'demo' }));
    console.info(`[live] uploaded world model: ${model.walls.length} walls, ${model.cols}×${model.rows} grid`);
  }

  // Server painted a wall → render it here. Mirrors persistence.restore: match
  // the slot by anchor, apply the SVG, and log it into the HUD + gallery.
  async _applyMural(m) {
    const slot = this.city.wallSlots.find((s) =>
      !s.used && (s.px - m.px) ** 2 + (s.py - m.py) ** 2 + (s.pz - m.pz) ** 2 < 0.01);
    if (!slot) return;
    slot.used = true;
    const PW = 512, PH = Math.round(512 * (slot.wallH / slot.wallW));
    try {
      await this.factory.apply(slot, { svg: m.svg, PW, PH });
    } catch (e) {
      slot.used = false;
      console.warn('[live] mural apply failed:', e.message);
      return;
    }
    const entry = {
      id: `live-${this._seq++}`,
      styleName: m.style, wallW: slot.wallW, wallH: slot.wallH,
      buildingIdx: slot.buildingIdx, by: m.user_id,
      // Provenance for the detail view — carried inline (a live id isn't a D1
      // row, so the modal can't lazy-fetch it; the broadcast already has it).
      thought: m.thought ?? null, model: m.model ?? null, prompt: m.prompt ?? null,
      target: { px: slot.px, py: slot.py, pz: slot.pz, nx: slot.nx, nz: slot.nz },
    };
    this.ui.logEntries.unshift(entry);
    if (this.ui.logEntries.length > CONFIG.maxLogEntries) this.ui.logEntries.pop();
    this.ui.gallery.unshift({ ...entry, thumb: muralThumb(m.svg) });
    this.ui.muralCount++;
    if (m.thought) { this.ui.thought = m.thought; this.ui.thoughtVisible = true; }
  }

  close() {
    this._closed = true;
    clearTimeout(this._muralT); clearTimeout(this._retryT); clearInterval(this._pingT);
    try { this._ws?.close(); } catch {}
  }
}
