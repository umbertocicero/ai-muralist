import { CONFIG } from './config.js';

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
export function buildWorldModel(city) {
  const half     = city.HALF;
  const cellSize = 0.75;
  const cols = Math.ceil((half * 2) / cellSize);
  const rows = cols;
  const cells = new Uint8Array(cols * rows);
  const idx = (gx, gz) => gz * cols + gx;

  for (let gz = 0; gz < rows; gz++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = -half + (gx + 0.5) * cellSize;
      const z = -half + (gz + 0.5) * cellSize;
      if (city.isColliding(x, z)) cells[idx(gx, gz)] = 1;
    }
  }

  const cellOf = (x, z) => idx(
    Math.min(cols - 1, Math.max(0, ((x + half) / cellSize) | 0)),
    Math.min(rows - 1, Math.max(0, ((z + half) / cellSize) | 0)));

  // Every street-facing wall is a target; carve its approach cell walkable (it
  // is, by construction — that's why it's a slot) so a coarse cell that clips a
  // corner can never make a real wall unreachable.
  const walls = city.wallSlots.map((s, id) => {
    const ap = city.approachPoint(s);
    cells[cellOf(ap.x, ap.z)] = 0;
    return {
      id, px: s.px, py: s.py, pz: s.pz, nx: s.nx, nz: s.nz,
      wallW: s.wallW, wallH: s.wallH, ax: ap.x, az: ap.z,
    };
  });
  cells[cellOf(city.spawn.x, city.spawn.z)] = 0;

  let bin = '';
  for (let i = 0; i < cells.length; i++) bin += String.fromCharCode(cells[i]);
  return {
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

    this._ws = null;
    this._prevState = null;
    this._backoff = 1000;
    this._closed = false;
    this._modelSent = false;
    this._seq = 0;
  }

  start() { this._connect(); return this; }

  _connect() {
    if (this._closed) return;
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
    setTimeout(() => this._connect(), this._backoff);
    this._backoff = Math.min(this._backoff * 2, 15000);
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'hello':
        this.connected = true; this.everConnected = true;
        console.info(`[live] connected · worker build ${msg.build} · needWorld ${msg.needWorld}`);
        this._sendMode();                       // tell the server demo vs AI (always)
        if (msg.needWorld) this._sendModel();
        if (msg.kay) this._applyKay(msg.kay);
        break;
      case 'kay':
        this._applyKay(msg);
        break;
      case 'mural':
        this._applyMural(msg);
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
    if (k.state !== this._prevState) { this.onState?.(k.state, this._prevState); this._prevState = k.state; }
  }

  // Report the site's resolved mode so the server knows whether to paint
  // procedurally (demo) or call Anthropic. Sent on every connect (works even when
  // the DO already has the world model, i.e. needWorld=false).
  _sendMode() {
    if (!this._ws) return;
    try { this._ws.send(JSON.stringify({ type: 'mode', demo: CONFIG.mode === 'demo' })); } catch {}
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
      target: { px: slot.px, py: slot.py, pz: slot.pz, nx: slot.nx, nz: slot.nz },
    };
    this.ui.logEntries.unshift(entry);
    if (this.ui.logEntries.length > CONFIG.maxLogEntries) this.ui.logEntries.pop();
    this.ui.gallery.unshift({ ...entry, thumb: 'data:image/svg+xml;utf8,' + encodeURIComponent(m.svg) });
    this.ui.muralCount++;
    if (m.thought) { this.ui.thought = m.thought; this.ui.thoughtVisible = true; }
  }

  close() { this._closed = true; try { this._ws?.close(); } catch {} }
}
