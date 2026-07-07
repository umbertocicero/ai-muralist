import { CONFIG } from './config.js';

// ===========================================================================
//  RemoteDriver — animates the on-screen Kay from the server's authoritative
//  snapshots (LiveLink). It replaces the local Agent when a live server is
//  connected: it never DECIDES anything, it just eases the body toward the
//  broadcast position/heading, plays the matching animation, and fires the
//  existing camera + FX hooks on server state transitions. Kay's brain lives in
//  the Durable Object (js/sim.mjs); this is only his puppet.
// ===========================================================================

// The server sends `state` as a plain string; we match those literals here so
// the browser never has to import the server-only sim module.
const S = {
  WANDERING: 'WANDERING', MOVING_TO_WALL: 'MOVING_TO_WALL', THINKING: 'THINKING',
  PAINTING: 'PAINTING', ADMIRING: 'ADMIRING', CONTEMPLATING: 'CONTEMPLATING',
};

export class RemoteDriver {
  constructor(city, character, ui) {
    this.city = city;
    this.char = character;
    this.ui   = ui;
    // Client-side extrapolation: track the latest snapshot + a smoothed server
    // VELOCITY, and render continuous motion at that measured speed. This is
    // robust to the DO's jittery 10 Hz alarm (no stop-and-go / slides) and stops
    // cleanly when the server stops.
    this._cur = null;          // {x,z,t} latest snapshot
    this._ref = null;          // identity of the last-seen snapshot object
    this._vx = null; this._vz = null;   // smoothed server velocity (m/s)
    this._rx = null; this._rz = null;   // rendered position
  }

  update(dt, t, kay) {
    if (!kay) { this.char.idle(t); this.char.sync(); return; }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

    // A new snapshot arrived (LiveLink swaps the object each message).
    if (kay !== this._ref) {
      this._ref = kay;
      const prev = this._cur;
      this._cur = { x: kay.x, z: kay.z, t: now };
      if (prev && this._cur.t > prev.t) {
        const jump = Math.hypot(this._cur.x - prev.x, this._cur.z - prev.z);
        if (jump > 5) {                                   // a _relocate teleport → snap, no slide
          this._rx = kay.x; this._rz = kay.z; this._vx = 0; this._vz = 0;
        } else {
          const d = this._cur.t - prev.t;
          const vx = (this._cur.x - prev.x) / d, vz = (this._cur.z - prev.z) / d;
          const s = this._vx == null ? 1 : 0.35;          // EMA smooth (kills alarm jitter)
          this._vx = this._vx == null ? vx : this._vx + (vx - this._vx) * s;
          this._vz = this._vz == null ? vz : this._vz + (vz - this._vz) * s;
        }
      }
    }
    if (this._rx == null) { this._rx = kay.x; this._rz = kay.z; }

    const moving = kay.state === S.WANDERING || kay.state === S.MOVING_TO_WALL || kay.state === S.CONTEMPLATING;
    // Target = the extrapolated authoritative position (only while moving; when
    // painting/admiring he's meant to be still, so track the exact point).
    let tx = kay.x, tz = kay.z;
    if (moving && this._cur && this._vx != null) {
      const ahead = Math.min(now - this._cur.t, 0.4);     // cap so a stalled stream can't fly off
      tx = this._cur.x + this._vx * ahead;
      tz = this._cur.z + this._vz * ahead;
    }
    const a = 1 - Math.exp(-dt * 8);                       // gentle correction toward the target
    this._rx += (tx - this._rx) * a;
    this._rz += (tz - this._rz) * a;
    this.char.pos.x = this._rx;
    this.char.pos.z = this._rz;
    this.char.faceDirection({ x: Math.sin(kay.facing), z: Math.cos(kay.facing) });

    switch (kay.state) {
      case S.WANDERING:
      case S.MOVING_TO_WALL: this.char.walk(t); break;
      case S.CONTEMPLATING:  this.char.walk(t, 0.6); break;
      case S.PAINTING:       this.char.paint(t); break;   // hand moving the whole creation
      default:               this.char.idle(t); break;    // ADMIRING
    }
    // Keep the spray onomatopoeia popping while he paints (long AI creations too).
    if (kay.state === S.PAINTING) {
      this._sfxT = (this._sfxT ?? 0) + dt;
      if (this._sfxT > 1.8) { this._sfxT = 0; this._popSfx(); }
    } else this._sfxT = 0;
    this.char.sync();
  }

  // Server state edge → drive the camera (same hooks the Agent uses) and the
  // manga FX. `kay.targetId` indexes straight into city.wallSlots because the
  // uploaded catalogue is that array, in order.
  onState(state, prev, kay) {
    const slot = kay && kay.targetId != null ? this.city.wallSlots[kay.targetId] : null;

    // PAINTING now begins the moment Kay reaches the wall (and runs through the
    // whole generation): frame the wall, a brief impact flash, spray SFX.
    if (state === S.PAINTING) { if (slot) this.ui.onPaintBegin?.(slot); this._flashPulse(); this._popSfx(); }
    if (state === S.ADMIRING) { this.ui.flashActive = false; if (slot) this.ui.onAdmire?.(slot); }
    if (state === S.WANDERING && (prev === S.ADMIRING || prev === S.PAINTING)) {
      this.ui.flashActive = false;
      this.ui.thoughtVisible = false;
      this.ui.onPaintEnd?.();                                             // rise + resume follow
    }
  }

  // A short orange impact flash (not a held veil — painting can now last the
  // whole AI generation).
  _flashPulse() {
    this.ui.flashActive = true;
    if (this._flashT) clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { this.ui.flashActive = false; }, 600);
  }

  // A manga onomatopoeia over the wall as the stroke lands (mirrors Agent._popSfx).
  _popSfx() {
    const list = CONFIG.fx?.sfx;
    if (!list || !list.length) return;
    this.ui.sfxText = list[(Math.random() * list.length) | 0];
    this.ui.sfxX    = 38 + Math.random() * 24;
    this.ui.sfxY    = 26 + Math.random() * 20;
    this.ui.sfxRot  = (Math.random() * 16 - 8) | 0;
    this.ui.sfxKey  = (this.ui.sfxKey || 0) + 1;
  }
}
