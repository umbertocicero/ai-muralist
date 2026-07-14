// Kay's authoritative simulation — PURE logic, no three.js / DOM / Worker APIs.
//
// Single source of truth for how Kay moves and chooses walls. Imported by BOTH
// the Cloudflare Durable Object (server) and the Node test (tests/sim.test.mjs),
// so the behaviour the test proves is exactly what the server runs. The browser
// never imports it — the client only builds the world MODEL (grid + wall
// catalogue) and renders whatever the server broadcasts.
//
// MOVEMENT MODEL — purposeful, not aimless:
//   • Kay always has a GOAL: the nearest un-painted wall.
//   • He walks a real ROUTE to it — BFS pathfinding over the walkability grid,
//     then follows the waypoints in clean straight segments (with line-of-sight
//     smoothing so he cuts corners instead of stair-stepping). No random meander,
//     no lateral wiggle, no wandering to nowhere.
//   • CONTINUOUS, never toroidal (the world edge is solid — no "Pac-Man" jump).
//   • Wall order is RANDOM but PROXIMITY-first; an unreachable wall is deferred
//     and revisited later. ALL walls are equal (no "best wall").
//   • The gap between murals is spent traveling to the next wall + a short pause
//     "sizing it up" (OBSERVE) — purposeful, never a stroll to a random point.

export const SIM_STATE = {
  SEEKING:        'SEEKING',         // choosing the next wall + routing to it
  MOVING_TO_WALL: 'MOVING_TO_WALL',  // walking the route
  OBSERVE:        'OBSERVE',         // stood at the wall, sizing it up (paces murals)
  PAINTING:       'PAINTING',        // spraying (whole creation)
  ADMIRING:       'ADMIRING',        // looking at the finished mural
  CONTEMPLATING:  'CONTEMPLATING',   // every reachable wall painted
  // legacy (only ever seen in old persisted state on hydrate):
  WANDERING:      'WANDERING',
  THINKING:       'THINKING',
};

export const SIM_STATUS = {
  SEEKING:        'choosing the next wall',
  MOVING_TO_WALL: 'walking to a blank wall',
  OBSERVE:        'sizing up the wall',
  PAINTING:       'painting…',
  ADMIRING:       'admiring the finished mural',
  CONTEMPLATING:  'every wall is painted · contemplating',
  WANDERING:      'walking the streets',
  THINKING:       'imagining a mural',
};

export const DEFAULT_SIM_CFG = {
  moveSpeed:      2.6,   // m/s — a stroll
  charRadius:     0.4,
  arriveWall:     0.5,   // reached the approach point
  arriveWaypoint: 0.05,  // treated as "on" a route waypoint
  // Kay PAINTS (hand moving) for the WHOLE creation: at least paintMinSeconds
  // (demo murals generate instantly but still show a few seconds of spraying) and
  // up to paintMaxSeconds while an AI mural is still generating.
  paintMinSeconds: 6.0,
  paintMaxSeconds: 45,
  admireSeconds:   5.0,
  // Unhurried pace: a mural roughly every half-minute, not a graffiti blitz —
  // the gap is spent travelling, so it reads as strolling. OBSERVE (standing at
  // the wall before spraying) is capped separately below — it must NEVER eat
  // whatever's left of the cooldown (up to the full 18-32 s when two walls sit
  // close together and travel barely dents it): that read as Kay just staring
  // at a blank wall for ages before starting.
  cooldownMin:     18,   // gap between murals (travel counts toward it)
  cooldownRange:   14,   // → 18-32 s; also bounds token spend
  observeMaxSeconds: 1.0, // hard cap on the "sizing up the wall" pause on arrival
  reachTimeout:    30,   // safety: abandon a route that somehow overruns this
  deferSeconds:    35,   // don't retry an unreachable wall for this long
  nearK:           6,    // pick randomly among the K nearest free walls
};

// Small seedable PRNG (mulberry32) so the test is reproducible; the server passes Math.random.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class KaySim {
  // model: { half, spawn:{x,z}, cellSize, cols, rows, cells:Uint8Array(cols*rows),
  //          walls:[{ id, px,py,pz, nx,nz, wallW,wallH, ax,az }] }
  //   cells[gz*cols+gx] !== 0  ⇒ blocked. The client carves every wall's approach
  //   cell and Kay's spawn cell FREE, so a wall is reachable at its approach.
  constructor(model, cfg = {}, rng = Math.random) {
    this.model = model;
    this.cfg   = { ...DEFAULT_SIM_CFG, ...cfg };
    this.rng   = rng;
    this.walls = model.walls;
    this.byId  = new Map(this.walls.map((w) => [w.id, w]));

    this.painted = new Set();     // wall ids that carry a mural
    this._defer  = new Map();     // wall id → simTime it may be retried after
    this.muralCount = 0;
    this.simTime = 0;

    this.x = model.spawn.x;
    this.z = model.spawn.z;
    this.facing = 0;              // heading angle (dir = {x:sin, z:cos})

    this.targetId = null;
    this._path = null;            // array of {x,z} waypoints to the current wall
    this._pi = 0;                 // current waypoint index
    this._pathFails = 0;          // consecutive routing failures (→ relocate if boxed)
    this._cooldownLeft = 3;       // first mural comes quickly, then the steady gap
    this.timers = { move: 0, paint: 0, admire: 0, idle: 0 };
    this._paintPending = false;   // the DO is generating an SVG right now
    this._paintResult  = null;    // { svg, thought } once ready

    this._setState(SIM_STATE.SEEKING);
  }

  _setState(s) { this.state = s; this.status = SIM_STATUS[s] ?? this.status; }
  _cooldown()  { return this.cfg.cooldownMin + this.rng() * this.cfg.cooldownRange; }

  // ── Grid ─────────────────────────────────────────────────────────────────────
  // A set cell means "a body-sized Kay collides here" (the client samples the grid
  // through city.isColliding, which already inflates obstacles by his radius), so
  // we test just the cell he's in. Out of bounds is solid — no wrap.
  blocked(x, z) {
    const { half, cellSize, cols, rows, cells } = this.model;
    if (x < -half || x > half || z < -half || z > half) return true;
    const gx = ((x + half) / cellSize) | 0;
    const gz = ((z + half) / cellSize) | 0;
    if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) return true;
    return cells[gz * cols + gx] !== 0;
  }
  _cellFree(gx, gz) {
    const { cols, rows, cells } = this.model;
    if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) return false;
    return cells[gz * cols + gx] === 0;
  }
  _gx(x) { return clampI(((x + this.model.half) / this.model.cellSize) | 0, 0, this.model.cols - 1); }
  _gz(z) { return clampI(((z + this.model.half) / this.model.cellSize) | 0, 0, this.model.rows - 1); }
  _cx(gx) { return -this.model.half + (gx + 0.5) * this.model.cellSize; }
  _cz(gz) { return -this.model.half + (gz + 0.5) * this.model.cellSize; }

  _randomReachable() {
    const h = this.model.half;
    for (let i = 0; i < 200; i++) {
      const x = (this.rng() * 2 - 1) * (h - 1);
      const z = (this.rng() * 2 - 1) * (h - 1);
      if (!this.blocked(x, z)) return { x, z };
    }
    return { x: this.model.spawn.x, z: this.model.spawn.z };
  }

  // ── Wall choice — nearest free wall, with a little randomness ─────────────────
  _freeWalls() {
    return this.walls.filter((w) => !this.painted.has(w.id) && !this.blocked(w.ax, w.az));
  }
  _pickWall(fromX, fromZ) {
    const free = this._freeWalls();
    if (!free.length) return null;
    let pool = free.filter((w) => (this._defer.get(w.id) ?? 0) <= this.simTime);
    if (!pool.length) pool = free;                       // all deferred → allow retry
    pool.sort((a, b) =>
      ((a.px - fromX) ** 2 + (a.pz - fromZ) ** 2) - ((b.px - fromX) ** 2 + (b.pz - fromZ) ** 2));
    const k = Math.min(pool.length, this.cfg.nearK);
    return pool[(this.rng() * k) | 0];
  }
  hasFreeReachable() { return this._freeWalls().length > 0; }
  allPainted()       { return this.walls.every((w) => this.painted.has(w.id)); }

  // ── Pathfinding — BFS over the grid (8-connected, no corner cutting) ─────────
  // Returns waypoints (cell centres, last one is the exact approach point), or null.
  _findPath(sx, sz, tx, tz) {
    const { cols, rows } = this.model;
    const sgx = this._gx(sx), sgz = this._gz(sz);
    const tgx = this._gx(tx), tgz = this._gz(tz);
    if (!this._cellFree(sgx, sgz) || !this._cellFree(tgx, tgz)) return null;
    const start = sgz * cols + sgx, goal = tgz * cols + tgx;
    if (start === goal) return [{ x: tx, z: tz }];

    const prev = new Int32Array(cols * rows).fill(-1);
    prev[start] = start;
    const q = new Int32Array(cols * rows);
    let head = 0, tail = 0;
    q[tail++] = start;
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let found = false;
    while (head < tail) {
      const cur = q[head++];
      if (cur === goal) { found = true; break; }
      const gx = cur % cols, gz = (cur / cols) | 0;
      for (const [dx, dz] of NB) {
        const ngx = gx + dx, ngz = gz + dz;
        if (!this._cellFree(ngx, ngz)) continue;
        if (dx && dz && (!this._cellFree(gx + dx, gz) || !this._cellFree(gx, gz + dz))) continue; // no corner cut
        const ni = ngz * cols + ngx;
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        q[tail++] = ni;
      }
    }
    if (!found) return null;

    const cells = [];
    for (let c = goal; c !== start; c = prev[c]) cells.push(c);
    cells.push(start);
    cells.reverse();
    const wp = cells.map((c) => ({ x: this._cx(c % cols), z: this._cz((c / cols) | 0) }));
    wp[wp.length - 1] = { x: tx, z: tz };   // finish at the exact approach point
    return wp;
  }

  // Is the straight segment clear of obstacles? (line-of-sight for path smoothing)
  _lineClear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / (this.model.cellSize * 0.5)));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (this.blocked(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f)) return false;
    }
    return true;
  }

  // String-pull the raw BFS cells down to the fewest waypoints with clear
  // line-of-sight between them → straight diagonal segments (no stair-step). Done
  // ONCE when a route is created, so both the server AND the browser can walk the
  // exact same segments (the client has no grid to smooth with).
  _simplifyPath(wp) {
    if (!wp || wp.length <= 2) return wp;
    const out = [wp[0]];
    let i = 0;
    while (i < wp.length - 1) {
      let j = wp.length - 1;
      while (j > i + 1 && !this._lineClear(wp[i].x, wp[i].z, wp[j].x, wp[j].z)) j--;
      out.push(wp[j]);
      i = j;
    }
    return out;
  }

  // Consume a whole `step` of travel along the (already-simplified) route this
  // call — walking straight from waypoint to waypoint, spilling leftover budget
  // into the next segment. Works for a tiny 100 ms step OR a multi-second catch-up
  // step (server ticks coarsely; see advance()). Returns true once he's at the
  // final waypoint (the approach point).
  _followPath(step) {
    const wp = this._path;
    if (!wp || !wp.length) return true;
    let remaining = step;
    while (remaining > 1e-6 && this._pi < wp.length) {
      const tgt = wp[this._pi];
      const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
      if (d < 1e-6) { this._pi++; continue; }
      const s = Math.min(remaining, d);
      this.x += (dx / d) * s; this.z += (dz / d) * s;
      this.facing = Math.atan2(dx / d, dz / d);
      remaining -= s;
      if (s >= d - 1e-6) this._pi++;               // reached this waypoint → next
      else break;                                  // out of step budget mid-segment
    }
    const last = wp[wp.length - 1];
    return Math.hypot(last.x - this.x, last.z - this.z) < this.cfg.arriveWall;
  }

  // The route to broadcast so browsers animate the walk locally. Two flavours:
  //  · fromStart=true  → the FULL path from where the walk began. Used when Kay
  //    picks a new wall: every client is at that start point, so they all walk the
  //    identical path in lock-step (no snap — a coarse server tick may have run
  //    several metres into the route within the same tick, ahead of the clients).
  //  · fromStart=false → the REMAINING path + Kay's current position. Used in the
  //    hello, so a browser joining mid-walk resumes from where Kay actually is.
  currentRoute(fromStart = false) {
    if (this.state !== SIM_STATE.MOVING_TO_WALL || !this._path || !this._path.length) return null;
    const wp = fromStart ? this._path : this._path.slice(this._pi);
    const o  = fromStart ? this._path[0] : { x: this.x, z: this.z };
    return { targetId: this.targetId, speed: this.cfg.moveSpeed, x: o.x, z: o.z, waypoints: wp };
  }

  // Advance the sim by `elapsed` seconds using fixed 0.1 s sub-steps — so a coarse
  // server tick (e.g. every 2 s, hibernating in between) produces exactly the same
  // trajectory as continuous ticking. Returns a { paint } and/or { routeStarted }
  // signal if one fired. The loop BREAKS the moment a new route starts: the DO
  // must broadcast that route from its true start, and consuming the rest of the
  // coarse tick would walk Kay metres into it before any browser even knows the
  // route exists — every client would then trail the keyframes by a whole tick
  // (the "starts painting before he arrives" artefact).
  advance(elapsed) {
    const SUB = 0.1;
    let remaining = Math.max(0, elapsed);
    let out = null;
    let guard = 4000;
    while (remaining > 1e-6 && guard-- > 0) {
      const sig = this.step(Math.min(SUB, remaining));
      if (sig && sig.paint) out = sig;
      if (sig && sig.routeStarted) { out = { ...sig, ...(out ?? {}) }; break; }
      remaining -= SUB;
    }
    return out;
  }

  _faceWall(w) { this.facing = Math.atan2(-w.nx, -w.nz); }

  _toSeeking() { this._path = null; this._pi = 0; this._setState(SIM_STATE.SEEKING); }

  _beginPaint(w) {
    this._faceWall(w);
    this.timers.paint = 0;
    this._paintPending = true;
    this._paintResult  = null;
    this._setState(SIM_STATE.PAINTING);
    return { paint: w };
  }

  _giveUpTarget() {
    if (this.targetId != null) this._defer.set(this.targetId, this.simTime + this.cfg.deferSeconds);
    this.targetId = null;
    this._toSeeking();
  }

  // ── Trap escape (safety net; pathfinding makes this rare) ────────────────────
  _openNeighbors(x, z) {
    const s = this.model.cellSize;
    let n = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
      if (!this.blocked(x + dx * s, z + dz * s)) n++;
    return n;
  }
  _nearestOpen(x, z) {
    const s = this.model.cellSize;
    for (let r = 1; r < 80; r++) {
      const steps = r * 8;
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2;
        const px = x + Math.cos(ang) * r * s, pz = z + Math.sin(ang) * r * s;
        if (!this.blocked(px, pz) && this._openNeighbors(px, pz) >= 5) return { x: px, z: pz };
      }
    }
    return null;
  }
  _relocate() {
    const p = this._nearestOpen(this.x, this.z) || this._randomReachable();
    this.x = p.x; this.z = p.z;
    if (this.targetId != null) { this._defer.set(this.targetId, this.simTime + this.cfg.deferSeconds); this.targetId = null; }
    this._pathFails = 0;
    this._toSeeking();
  }

  // ── DO callbacks for the async paint ────────────────────────────────────────
  paintDone(result) { this._paintResult = result; this._paintPending = false; }
  paintFailed()     { this._paintResult = null;   this._paintPending = false; }

  // ── One tick. Returns { paint: wall } exactly once (when generation should
  // start); the DO then calls paintDone/paintFailed. Otherwise null. ────────────
  step(dt) {
    this.simTime += dt;
    const step = this.cfg.moveSpeed * dt;

    switch (this.state) {
      case SIM_STATE.SEEKING: {
        if (this.blocked(this.x, this.z)) { this._relocate(); return null; }   // drifted into a wall
        const w = this._pickWall(this.x, this.z);
        if (!w) { if (!this.hasFreeReachable()) this._setState(SIM_STATE.CONTEMPLATING); return null; }
        const path = this._findPath(this.x, this.z, w.ax, w.az);
        if (path) {
          this.targetId = w.id; this._path = this._simplifyPath(path); this._pi = 0; this._pathFails = 0;
          this.timers.move = 0; this._setState(SIM_STATE.MOVING_TO_WALL);
          return { routeStarted: true };   // advance() breaks here → route broadcast from its true start
        } else {
          this._defer.set(w.id, this.simTime + this.cfg.deferSeconds);          // unreachable → skip a while
          if (++this._pathFails > 12 && this._openNeighbors(this.x, this.z) < 6) this._relocate();
          // Routing keeps failing from an OPEN spot: Kay is standing on a
          // walkable island disconnected from every wall (e.g. hydrated onto a
          // spot the current grid can't route out of). _relocate() won't fire
          // (his neighbours are open) and nothing else moves him → without this
          // he'd re-fail forever, visibly frozen while the sim ticks fine.
          // Jump home: the spawn cell is carved free by the model builder and
          // is where every wall was reachable from when the world was uploaded.
          else if (this._pathFails > 30) {
            this.x = this.model.spawn.x; this.z = this.model.spawn.z;
            this._pathFails = 0;
          }
        }
        return null;
      }

      case SIM_STATE.MOVING_TO_WALL: {
        this.timers.move += dt;
        this._cooldownLeft = Math.max(0, this._cooldownLeft - dt);   // travel counts toward the gap
        const w = this.byId.get(this.targetId);
        if (!w) { this._toSeeking(); return null; }
        const arrived = this._followPath(step);
        if (arrived) {
          this._faceWall(w);
          if (this._cooldownLeft > 0) { this.timers.idle = 0; this._setState(SIM_STATE.OBSERVE); return null; }
          return this._beginPaint(w);
        }
        if (this.timers.move > this.cfg.reachTimeout) this._giveUpTarget();       // safety
        return null;
      }

      case SIM_STATE.OBSERVE: {
        const w = this.byId.get(this.targetId);
        if (!w) { this._toSeeking(); return null; }
        this._faceWall(w);
        this.timers.idle += dt;                                       // time actually spent observing
        this._cooldownLeft = Math.max(0, this._cooldownLeft - dt);
        if (this._cooldownLeft <= 0 || this.timers.idle >= this.cfg.observeMaxSeconds) return this._beginPaint(w);
        return null;
      }

      case SIM_STATE.PAINTING: {
        this.timers.paint += dt;
        if (this._paintPending) {
          if (this.timers.paint > this.cfg.paintMaxSeconds) { this._paintPending = false; this._giveUpTarget(); }
          return null;
        }
        if (!(this._paintResult && this._paintResult.svg)) { this._giveUpTarget(); return null; }
        if (this.timers.paint > this.cfg.paintMinSeconds) {
          this.painted.add(this.targetId);
          this._defer.delete(this.targetId);
          this.muralCount++;
          this._setState(SIM_STATE.ADMIRING);
          this.timers.admire = 0;
        }
        return null;
      }

      case SIM_STATE.ADMIRING: {
        this.timers.admire += dt;
        if (this.timers.admire > this.cfg.admireSeconds) {
          this.targetId = null;
          this._cooldownLeft = this._cooldown();      // steady pace before the next
          this._toSeeking();
        }
        return null;
      }

      case SIM_STATE.CONTEMPLATING: {
        this.timers.idle += dt;
        if (this.timers.idle > 3) { this.timers.idle = 0; if (this.hasFreeReachable()) this._toSeeking(); }
        return null;
      }

      default:                                       // legacy state from old persistence
        this._toSeeking();
        return null;
    }
  }

  // ── Broadcast payload (small; sent to browsers each tick) ────────────────────
  snapshot() {
    return { x: this.x, z: this.z, facing: this.facing, state: this.state, status: this.status, muralCount: this.muralCount, targetId: this.targetId };
  }

  // ── Persistence to Durable Object storage (survives eviction while frozen) ───
  // The active WALK survives too (state + targetId + route + progress): the DO
  // hibernates between 2 s ticks, and rebuilding as SEEKING on every wake made
  // Kay abandon his walk, re-pick a wall and re-broadcast a route — on screen a
  // constant backtrack/stutter. In-flight PAINTS still don't survive (the
  // generation itself is gone) — those re-decide as before.
  serialize() {
    const s = {
      x: this.x, z: this.z, facing: this.facing, muralCount: this.muralCount, simTime: this.simTime,
      cooldownLeft: this._cooldownLeft,
      painted: [...this.painted], defer: [...this._defer],
    };
    if (this.state === SIM_STATE.MOVING_TO_WALL && this._path && this._pi < this._path.length) {
      s.walk = { targetId: this.targetId, path: this._path, pi: this._pi, moveT: this.timers.move };
    }
    return s;
  }

  hydrate(s) {
    if (!s) return this;
    this.x = s.x ?? this.x; this.z = s.z ?? this.z; this.facing = s.facing ?? 0;
    this.muralCount = s.muralCount ?? 0; this.simTime = s.simTime ?? 0;
    this._cooldownLeft = s.cooldownLeft ?? 0;
    this.painted = new Set(s.painted ?? []);
    this._defer  = new Map(s.defer ?? []);
    this._paintPending = false; this._paintResult = null;
    const w = s.walk;
    if (w && this.byId.has(w.targetId) && Array.isArray(w.path) && w.pi < w.path.length &&
        w.path.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z))) {
      this.targetId = w.targetId; this._path = w.path; this._pi = w.pi | 0;
      this.timers.move = Number.isFinite(w.moveT) ? w.moveT : 0;
      this._setState(SIM_STATE.MOVING_TO_WALL);       // resume the walk mid-route
    } else {
      this.targetId = null; this._path = null; this._pi = 0;
      this._setState(SIM_STATE.SEEKING);
    }
    return this;
  }
}

function clampI(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
