import { CONFIG } from './config.js';

// ===========================================================================
//  RemoteDriver — animates the on-screen Kay from the server.
//
//  The server (KayDO) is authoritative but ticks COARSELY (~every 2 s, then
//  hibernates). To stay perfectly fluid the browser does the walking itself:
//  when Kay heads to a wall the server sends the ROUTE (straight-line waypoints);
//  this driver walks that route locally at 60 fps at the server's speed, and only
//  nudges toward the server's occasional position keyframe to cancel drift. When
//  Kay is still (painting / observing / admiring) it just eases to the server
//  point. Kay's brain lives in the DO (js/sim.mjs); this is only his puppet.
// ===========================================================================

// The server sends `state` as a plain string; we match those literals here so
// the browser never has to import the server-only sim module.
const S = {
  SEEKING: 'SEEKING', MOVING_TO_WALL: 'MOVING_TO_WALL', OBSERVE: 'OBSERVE',
  PAINTING: 'PAINTING', ADMIRING: 'ADMIRING', CONTEMPLATING: 'CONTEMPLATING',
  WANDERING: 'WANDERING',   // legacy
};

export class RemoteDriver {
  constructor(city, character, ui) {
    this.city = city;
    this.char = character;
    this.ui   = ui;
    this._route = null;        // remaining waypoints [{x,z}] to walk
    this._ri = 0;              // current waypoint index
    this._speed = CONFIG.moveSpeed || 2.6;
    this._facing = 0;
    this._rx = null; this._rz = null;   // rendered position
  }

  // A fresh route from the server: walk it locally from wherever Kay currently
  // is. No snap — he re-syncs to the wall during each paint pause, so any small
  // lag is absorbed there; the >8 m teleport guard in update() handles a relocate.
  setRoute(route) {
    if (!route || !Array.isArray(route.waypoints)) return;
    this._route = route.waypoints;
    this._ri = 0;
    this._speed = route.speed || this._speed;
    if (this._rx == null) { this._rx = route.x; this._rz = route.z; }
  }

  update(dt, t, kay) {
    if (!kay) { this.char.idle(t); this.char.sync(); return; }
    if (this._rx == null) { this._rx = kay.x; this._rz = kay.z; }

    const stillMoving = kay.state === S.MOVING_TO_WALL || kay.state === S.WANDERING;
    // Always FINISH the route to the wall (regardless of the coarse server state),
    // so he never snaps the last metre when the server declares arrival a tick
    // early. NO correction toward the keyframe: client and server walk the same
    // route at the same speed and track by construction (the keyframe is up to a
    // tick old — pulling toward it would drag him backward).
    const onRoute = this._route && this._ri < this._route.length;

    if (onRoute) {
      this._advanceRoute(dt);
      this.char.faceDirection({ x: Math.sin(this._facing), z: Math.cos(this._facing) });
    } else if (stillMoving) {
      // Arrived, but the server hasn't advanced his state yet (≤ a tick) → HOLD.
      this.char.faceDirection({ x: Math.sin(kay.facing), z: Math.cos(kay.facing) });
    } else {
      // A still state (OBSERVE/PAINTING/ADMIRING/SEEKING/…): keyframe is current
      // now, so settle onto the exact authoritative point — but never faster than
      // a walk, so even a rare 2 m gap eases smoothly instead of popping.
      const a = 1 - Math.exp(-dt * 6);
      let ex = (kay.x - this._rx) * a, ez = (kay.z - this._rz) * a;
      const em = Math.hypot(ex, ez), cap = this._speed * dt;
      if (em > cap) { ex *= cap / em; ez *= cap / em; }
      this._rx += ex; this._rz += ez;
      this.char.faceDirection({ x: Math.sin(kay.facing), z: Math.cos(kay.facing) });
    }
    // Teleport guard (a server _relocate): snap instead of sliding across town.
    if (Math.hypot(this._rx - kay.x, this._rz - kay.z) > 8) { this._rx = kay.x; this._rz = kay.z; this._route = null; }

    this.char.pos.x = this._rx;
    this.char.pos.z = this._rz;

    if (onRoute)                       this.char.walk(t);   // actually walking a route
    else if (kay.state === S.PAINTING) this.char.paint(t);  // hand moving the whole creation
    else                               this.char.idle(t);   // arrived / SEEKING / OBSERVE / ADMIRING / CONTEMPLATING

    if (kay.state === S.PAINTING) {
      this._sfxT = (this._sfxT ?? 0) + dt;
      if (this._sfxT > 1.8) { this._sfxT = 0; this._popSfx(); }
    } else this._sfxT = 0;
    this.char.sync();
  }

  // Consume speed·dt of travel along the route, straight from waypoint to
  // waypoint (they're pre-simplified server-side, so no grid needed here).
  _advanceRoute(dt) {
    const wp = this._route;
    let remaining = this._speed * dt;
    while (remaining > 1e-6 && this._ri < wp.length) {
      const tgt = wp[this._ri];
      const dx = tgt.x - this._rx, dz = tgt.z - this._rz, d = Math.hypot(dx, dz);
      if (d < 1e-6) { this._ri++; continue; }
      const s = Math.min(remaining, d);
      this._rx += (dx / d) * s; this._rz += (dz / d) * s;
      this._facing = Math.atan2(dx / d, dz / d);
      remaining -= s;
      if (s >= d - 1e-6) this._ri++;
      else break;
    }
  }

  // Server state edge → drive the camera (same hooks the Agent uses) and the
  // manga FX. `kay.targetId` indexes straight into city.wallSlots because the
  // uploaded catalogue is that array, in order.
  onState(state, prev, kay) {
    const slot = kay && kay.targetId != null ? this.city.wallSlots[kay.targetId] : null;

    // Frame the wall the moment he ARRIVES (OBSERVE, or PAINTING if he skipped
    // the pause). PAINTING also flashes + sprays. ADMIRING zooms the mural.
    if ((state === S.OBSERVE || state === S.PAINTING) && prev === S.MOVING_TO_WALL && slot) this.ui.onPaintBegin?.(slot);
    if (state === S.PAINTING) { this._flashPulse(); this._popSfx(); }
    if (state === S.ADMIRING) { this.ui.flashActive = false; if (slot) this.ui.onAdmire?.(slot); }
    if (state === S.SEEKING && (prev === S.ADMIRING || prev === S.PAINTING || prev === S.OBSERVE)) {
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
