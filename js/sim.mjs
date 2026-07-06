// Kay's authoritative simulation — PURE logic, no three.js / DOM / Worker APIs.
//
// This is the single source of truth for how Kay moves and chooses walls. It is
// imported by BOTH the Cloudflare Durable Object (server, js worker bundle) and
// the Node test (tests/sim.test.mjs), so the behaviour the test proves is the
// exact behaviour the server runs. The browser never imports it — the client
// only builds the world MODEL (grid + wall catalogue) and renders whatever the
// server broadcasts.
//
// Design goals (from the task):
//   • CONTINUOUS movement, NEVER toroidal — the world edge is a wall Kay bounces
//     off, so there is no "Pac-Man" teleport to the far side of the map.
//   • wall order is RANDOM but PROXIMITY-first — always a nearby wall, and a wall
//     Kay fails to reach is DEFERRED and retried later (never abandoned).
//   • ALL walls are equal — no "best wall" / frontage preference.
//
// The state machine mirrors js/agent.js so the on-screen character animates the
// same way; the difference is that here it runs once, on the server.

export const SIM_STATE = {
  WANDERING:      'WANDERING',
  MOVING_TO_WALL: 'MOVING_TO_WALL',
  THINKING:       'THINKING',
  PAINTING:       'PAINTING',
  ADMIRING:       'ADMIRING',
  CONTEMPLATING:  'CONTEMPLATING',
};

export const SIM_STATUS = {
  WANDERING:      'wandering the streets',
  MOVING_TO_WALL: 'approaching a blank wall',
  THINKING:       'imagining a mural',
  PAINTING:       'painting…',
  ADMIRING:       'admiring the finished mural',
  CONTEMPLATING:  'every wall is painted · contemplating',
};

export const DEFAULT_SIM_CFG = {
  moveSpeed:      3.2,   // m/s
  charRadius:     0.4,
  arriveWall:     0.5,   // reached the approach point
  arriveWander:   0.8,   // reached a stroll target
  thinkSeconds:   2.0,   // idle before the SVG is ready (also waits on the AI)
  paintSeconds:   2.2,
  admireSeconds:  3.0,
  cooldownMin:    20,    // steady pace: wander this long between murals…
  cooldownRange:  20,    // …+ up to this much (→ 20-40s), bounds token spend
  reachTimeout:   12,    // give up on a wall Kay can't path to in this many s…
  deferSeconds:   35,    // …and don't retry it for this long (revisit later)
  nearK:          6,     // pick randomly among the K nearest free walls
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Small seedable PRNG (mulberry32) so the test is reproducible; the server just
// passes Math.random.
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
  //   cells[gz*cols+gx] !== 0  ⇒ blocked. The client guarantees every wall's
  //   approach cell and Kay's spawn cell are carved FREE, so a wall is never
  //   structurally unreachable at its approach.
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
    this.nav = {};                // persistent steering state (heading + side)

    this.targetId = null;
    // First wall is chosen almost immediately (fast feedback that Kay is alive /
    // that painting works); the steady cooldown only kicks in AFTER the first
    // mural, so token pacing is unchanged for the long run.
    this.timers = { cooldown: 3, move: 0, think: 0, paint: 0, admire: 0 };
    this.wander = this._randomReachable();
    this._paintPending = false;   // the DO is generating an SVG right now
    this._paintResult  = null;    // { svg, thought } once ready

    this._setState(SIM_STATE.WANDERING);
  }

  _setState(s) { this.state = s; this.status = SIM_STATUS[s]; }
  _cooldown()  { return this.cfg.cooldownMin + this.rng() * this.cfg.cooldownRange; }

  // ── Grid collision (no wrap: out of bounds is solid) ─────────────────────────
  // The grid the client uploads is sampled through city.isColliding, which
  // ALREADY inflates every obstacle by Kay's body radius (+overhang pad). So a
  // set cell means "a body-sized Kay collides here" and we test just the cell he
  // stands in — re-inflating here would seal the town's narrow lanes. `extra` is
  // accepted for call-site symmetry with city.isColliding but isn't needed.
  blocked(x, z, _extra = 0) {
    const { half, cellSize, cols, rows, cells } = this.model;
    if (x < -half || x > half || z < -half || z > half) return true;   // world edge = solid
    const gx = ((x + half) / cellSize) | 0;
    const gz = ((z + half) / cellSize) | 0;
    if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) return true;
    return cells[gz * cols + gx] !== 0;
  }

  _randomReachable() {
    const h = this.model.half;
    for (let i = 0; i < 200; i++) {
      const x = (this.rng() * 2 - 1) * (h - 1);
      const z = (this.rng() * 2 - 1) * (h - 1);
      if (!this.blocked(x, z)) return { x, z };
    }
    return { x: this.model.spawn.x, z: this.model.spawn.z };
  }

  // Free = not yet painted AND its approach is walkable right now. Among those,
  // prefer walls NOT currently deferred (recently given up on); if every free
  // wall is deferred, retry them anyway so Kay always makes progress.
  _freeWalls() {
    return this.walls.filter((w) => !this.painted.has(w.id) && !this.blocked(w.ax, w.az));
  }

  _pickWall(fromX, fromZ) {
    const free = this._freeWalls();
    if (!free.length) return null;                       // nothing reachable → contemplate
    let pool = free.filter((w) => (this._defer.get(w.id) ?? 0) <= this.simTime);
    if (!pool.length) pool = free;                       // all deferred → allow retry
    pool.sort((a, b) =>
      ((a.px - fromX) ** 2 + (a.pz - fromZ) ** 2) - ((b.px - fromX) ** 2 + (b.pz - fromZ) ** 2));
    const k = Math.min(pool.length, this.cfg.nearK);     // random among the K nearest
    return pool[(this.rng() * k) | 0];
  }

  hasFreeReachable() { return this._freeWalls().length > 0; }
  allPainted()       { return this.walls.every((w) => this.painted.has(w.id)); }

  // ── Local pilot — continuous, grid-guarded, NO toroidal wrap ─────────────────
  // Ported/trimmed from city.steer (js/city.js): whiskers ahead + at ±24°, a
  // persistent heading turned toward the target at a limited rate, side
  // hysteresis to round obstacles, and an anti-pirouette that bails on a closed
  // orbit. All distances are PLAIN (never _wrapDelta) so Kay never Pac-Mans.
  // Returns true if he advanced, false if boxed in / spinning (caller re-plans).
  _steer(tx, tz, step) {
    const st = this.nav;
    const dt = Math.max(step / this.cfg.moveSpeed, 1e-4);
    const dx = tx - this.x, dz = tz - this.z;
    const distT = Math.hypot(dx, dz);
    const prevH = st.h;

    st.bias = clamp((st.bias ?? 0) + (this.rng() - 0.5) * 2.4 * dt, -0.6, 0.6);
    st.bias *= Math.max(0, 1 - 0.25 * dt);
    const desired = Math.atan2(dx, dz) + st.bias * clamp((distT - 2) / 6, 0, 1);
    let h = st.h ?? desired;

    const freeAt = (a, d) => !this.blocked(this.x + Math.sin(a) * d, this.z + Math.cos(a) * d, 0.14);
    const nearF = freeAt(h, 0.8), farF = freeAt(h, 1.7);
    const leftF = freeAt(h + 0.42, 1.15), rightF = freeAt(h - 0.42, 1.15);

    if (!nearF || !farF) {
      if (!st.side) st.side = leftF === rightF ? (freeAt(h + 1.0, 1.3) ? 1 : -1) : (leftF ? 1 : -1);
    } else if (st.side && leftF && rightF) {
      st.side = 0;
    }

    let turn = clamp(wrapAngle(desired - h), -2.4 * dt, 2.4 * dt);
    if (st.side) { if (!farF) turn += st.side * 2.2 * dt; if (!nearF) turn += st.side * 4.5 * dt; }
    if (!leftF)  turn -= 2.6 * dt;
    if (!rightF) turn += 2.6 * dt;
    h = wrapAngle(h + clamp(turn, -5.0 * dt, 5.0 * dt));

    const side = st.side || 1;
    for (let k = 0; k < 10; k++) {
      const a = wrapAngle(h + side * k * 0.22);
      const nx = this.x + Math.sin(a) * step, nz = this.z + Math.cos(a) * step;
      if (!this.blocked(nx, nz, 0.14)) {
        this.x = nx; this.z = nz; st.h = a; this.facing = a;
        // anti-pirouette: sum signed heading change, zero it on real headway;
        // a full turn with no headway back near where the loop began ⇒ bail.
        if (st.tx !== tx || st.tz !== tz) { st.tx = tx; st.tz = tz; st.best = distT; st.spin = 0; st.loopX = this.x; st.loopZ = this.z; }
        else if (distT < (st.best ?? Infinity) - 0.05) { st.best = distT; st.spin = 0; st.loopX = this.x; st.loopZ = this.z; }
        if (prevH !== undefined) {
          st.spin = (st.spin ?? 0) + wrapAngle(a - prevH);
          if (Math.abs(st.spin) >= 2 * Math.PI) {
            if (Math.hypot(st.loopX - this.x, st.loopZ - this.z) < 2.0) {
              st.h = undefined; st.side = 0; st.spin = 0; st.bias = 0;
              return false;                              // closed loop → re-plan
            }
            st.spin = 0; st.loopX = this.x; st.loopZ = this.z;
          }
        }
        return true;
      }
    }
    st.h = undefined; st.side = 0; st.spin = 0;           // boxed in → re-plan
    return false;
  }

  _faceWall(w) { this.facing = Math.atan2(-w.nx, -w.nz); }   // turn to face the wall

  _returnToWander() {
    this.wander = this._randomReachable();
    this._setState(SIM_STATE.WANDERING);
  }

  _giveUpTarget() {
    if (this.targetId != null) this._defer.set(this.targetId, this.simTime + this.cfg.deferSeconds);
    this.targetId = null;
    this._returnToWander();
  }

  // ── DO callbacks for the async paint ────────────────────────────────────────
  paintDone(result) { this._paintResult = result; this._paintPending = false; }
  paintFailed()     { this._paintResult = null;   this._paintPending = false; }

  // ── One tick. Returns { paint: wall } exactly once, when generation should
  // start; the DO then calls paintDone/paintFailed. Otherwise returns null. ─────
  step(dt) {
    this.simTime += dt;
    const step = this.cfg.moveSpeed * dt;

    switch (this.state) {
      case SIM_STATE.WANDERING: {
        this.timers.cooldown -= dt;
        const moved = this._steer(this.wander.x, this.wander.z, step);
        if (!moved || Math.hypot(this.wander.x - this.x, this.wander.z - this.z) < this.cfg.arriveWander)
          this.wander = this._randomReachable();
        if (this.timers.cooldown <= 0) {
          const w = this._pickWall(this.x, this.z);
          if (w) { this.targetId = w.id; this.timers.move = 0; this.nav = {}; this._setState(SIM_STATE.MOVING_TO_WALL); }
          else if (!this.hasFreeReachable()) this._setState(SIM_STATE.CONTEMPLATING);
          else this.timers.cooldown = 2;                 // reachable walls exist but all deferred; retry soon
        }
        return null;
      }

      case SIM_STATE.MOVING_TO_WALL: {
        this.timers.move += dt;
        const w = this.byId.get(this.targetId);
        if (!w) { this._giveUpTarget(); return null; }
        const moved = this._steer(w.ax, w.az, step);
        if (Math.hypot(w.ax - this.x, w.az - this.z) < this.cfg.arriveWall) {
          this._faceWall(w);
          this.timers.think = 0;
          this._paintPending = true;
          this._paintResult  = null;
          this._setState(SIM_STATE.THINKING);
          return { paint: w };                           // ← DO kicks off the AI here
        }
        if (!moved || this.timers.move > this.cfg.reachTimeout) this._giveUpTarget();
        return null;
      }

      case SIM_STATE.THINKING: {
        this.timers.think += dt;
        // hold until the minimum think time has passed AND the SVG is in
        if (this.timers.think > this.cfg.thinkSeconds && !this._paintPending) {
          if (this._paintResult && this._paintResult.svg) { this._setState(SIM_STATE.PAINTING); this.timers.paint = 0; }
          else this._giveUpTarget();                     // generation failed → skip, retry later
        }
        return null;
      }

      case SIM_STATE.PAINTING: {
        this.timers.paint += dt;
        if (this.timers.paint > this.cfg.paintSeconds) {
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
          this.timers.cooldown = this._cooldown();       // steady pace before the next
          this._returnToWander();
        }
        return null;
      }

      case SIM_STATE.CONTEMPLATING: {
        this.timers.cooldown -= dt;
        const moved = this._steer(this.wander.x, this.wander.z, step * 0.6);
        if (!moved || Math.hypot(this.wander.x - this.x, this.wander.z - this.z) < this.cfg.arriveWander)
          this.wander = this._randomReachable();
        if (this.timers.cooldown <= 0) {
          this.timers.cooldown = this._cooldown();
          if (this.hasFreeReachable()) this._setState(SIM_STATE.WANDERING);   // a deferred wall came back
        }
        return null;
      }
    }
    return null;
  }

  // ── Broadcast payload (small; sent to browsers each tick) ────────────────────
  snapshot() {
    return { x: this.x, z: this.z, facing: this.facing, state: this.state, status: this.status, muralCount: this.muralCount, targetId: this.targetId };
  }

  // ── Persistence to Durable Object storage (survives eviction while frozen) ───
  serialize() {
    return {
      x: this.x, z: this.z, facing: this.facing, state: this.state,
      targetId: this.targetId, muralCount: this.muralCount, simTime: this.simTime,
      timers: this.timers, nav: this.nav, wander: this.wander,
      painted: [...this.painted], defer: [...this._defer],
      paintPending: this._paintPending, paintResult: this._paintResult,
    };
  }

  hydrate(s) {
    if (!s) return this;
    this.x = s.x; this.z = s.z; this.facing = s.facing; this.state = s.state;
    this.status = SIM_STATUS[s.state] ?? this.status;
    this.targetId = s.targetId; this.muralCount = s.muralCount ?? 0; this.simTime = s.simTime ?? 0;
    this.timers = s.timers ?? this.timers; this.nav = s.nav ?? {}; this.wander = s.wander ?? this.wander;
    this.painted = new Set(s.painted ?? []);
    this._defer  = new Map(s.defer ?? []);
    // A paint that was mid-flight when the DO was evicted can't be resumed →
    // drop it so THINKING doesn't hang forever; the wall stays free.
    this._paintPending = false;
    this._paintResult  = null;
    if (this.state === SIM_STATE.THINKING || this.state === SIM_STATE.PAINTING) {
      if (this.targetId != null) this._defer.set(this.targetId, this.simTime);
      this.targetId = null;
      this._setState(SIM_STATE.WANDERING);
    }
    return this;
  }
}
