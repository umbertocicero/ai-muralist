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
  }

  // Per-frame: ease the character toward the latest server position (10Hz →
  // 60fps) and play the state's animation. A plain lerp — the server never
  // wraps, so there is no seam to jump.
  update(dt, t, kay) {
    if (!kay) { this.char.idle(t); this.char.sync(); return; }
    const a = 1 - Math.exp(-dt * 10);
    this.char.pos.x += (kay.x - this.char.pos.x) * a;
    this.char.pos.z += (kay.z - this.char.pos.z) * a;
    this.char.faceDirection({ x: Math.sin(kay.facing), z: Math.cos(kay.facing) });

    switch (kay.state) {
      case S.WANDERING:
      case S.MOVING_TO_WALL: this.char.walk(t); break;
      case S.CONTEMPLATING:  this.char.walk(t, 0.6); break;
      case S.PAINTING:       this.char.paint(t); break;
      default:               this.char.idle(t); break;   // THINKING / ADMIRING
    }
    this.char.sync();
  }

  // Server state edge → drive the camera (same hooks the Agent uses) and the
  // manga FX. `kay.targetId` indexes straight into city.wallSlots because the
  // uploaded catalogue is that array, in order.
  onState(state, prev, kay) {
    const slot = kay && kay.targetId != null ? this.city.wallSlots[kay.targetId] : null;

    if (state === S.THINKING && slot) this.ui.onPaintBegin?.(slot);      // frame the wall
    if (state === S.PAINTING) { this.ui.flashActive = true; this._popSfx(); }
    if (state === S.ADMIRING) { this.ui.flashActive = false; if (slot) this.ui.onAdmire?.(slot); }
    if (state === S.WANDERING && (prev === S.ADMIRING || prev === S.THINKING || prev === S.PAINTING)) {
      this.ui.flashActive = false;
      this.ui.thoughtVisible = false;
      this.ui.onPaintEnd?.();                                             // rise + resume follow
    }
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
