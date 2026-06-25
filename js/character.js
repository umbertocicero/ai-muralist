import * as THREE from 'three';
import { lerpAngle } from './helpers.js';
import { toonMat, addInk } from './toon.js';

// ── cel-shaded primitive helpers (ink-outlined) ───────────────────────────
function box(w, h, d, color, ink = true, k = 1.05) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(color));
  m.castShadow = true; if (ink) addInk(m, k); return m;
}
function ball(r, color, ink = true, k = 1.04) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), toonMat(color));
  m.castShadow = true; if (ink) addInk(m, k); return m;
}
function tuft(r, len, color, k = 1.06) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, 4), toonMat(color));
  m.castShadow = true; addInk(m, k); return m;
}

const SKIN = '#ecdcc6', HAIR = '#16120e', SHIRT = '#f1eee7', SHORTS = '#3a3833',
      SHOE = '#191510', SOLE = '#d9d5cd', BAG = '#46443e', STRAP = '#2c2a25';

// KAI — a small manga schoolkid in the silhouette of the reference character:
// black tufted hair with an ahoge, a plain white short-sleeve shirt, dark
// shorts over bare legs, sneakers, and a backpack — with a spray can in hand for
// the graffiti role. The whole figure stays in the B&W palette (toonMat greys);
// the orange spray-can cap is the lone colour accent, so the saturation gate in
// postfx leaves only it (and the wall murals) in colour against the inked town.
export class Character {
  constructor(scene, start) {
    this.pos    = { x: start.x, z: start.z };
    this.facing = 0;
    this.yaw    = 0;     // eased heading (the app places the body on the planet)
    this.group  = new THREE.Group();

    // ── Head (rounded) + hair ───────────────────────────────────────────────
    this.head = new THREE.Group();
    this.head.position.y = 1.66;
    const skull = ball(0.23, SKIN, true, 1.05); skull.scale.set(0.94, 1.12, 0.96);
    this.head.add(skull);
    // ear hints
    [-1, 1].forEach(s => { const e = ball(0.05, SKIN, false); e.position.set(s * 0.235, -0.02, 0.01); e.scale.set(0.7, 1.1, 0.7); this.head.add(e); });

    // Hair: a back/top mass + spiky bangs + side tufts + a single ahoge.
    const back = ball(0.26, HAIR, true, 1.035); back.scale.set(1.02, 0.96, 0.92); back.position.set(0, 0.07, -0.04); this.head.add(back);
    const bangs = [
      [-0.17, 0.16, 0.18, 0.55], [-0.06, 0.18, 0.21, 0.2], [0.06, 0.18, 0.21, -0.2],
      [0.17, 0.16, 0.18, -0.55], [0.0, 0.2, 0.16, 0.0],
    ];
    bangs.forEach(([x, y, z, tilt]) => {
      const b = tuft(0.085, 0.26, HAIR); b.position.set(x, y, z);
      b.rotation.set(2.5, 0, tilt); this.head.add(b);          // tip pointing down-forward
    });
    [-1, 1].forEach(s => { const sd = tuft(0.08, 0.24, HAIR); sd.position.set(s * 0.2, 0.06, 0.02); sd.rotation.set(0, 0, s * 1.9); this.head.add(sd); });
    const ahoge = tuft(0.022, 0.22, HAIR); ahoge.position.set(0.02, 0.28, -0.02); ahoge.rotation.set(-0.5, 0, 0.3); this.head.add(ahoge);

    // ── Neck + plain short-sleeve shirt torso ───────────────────────────────
    const neck = box(0.12, 0.12, 0.12, SKIN, false); neck.position.y = 1.46;
    this.body = box(0.42, 0.66, 0.25, SHIRT, true, 1.04); this.body.position.y = 1.12;
    const collar = box(0.26, 0.08, 0.26, SHIRT, false); collar.position.set(0, 1.42, 0);

    // ── Backpack on the back (the reference's signature, kept greyscale) ────
    const pack = box(0.38, 0.52, 0.22, BAG, true, 1.04); pack.position.set(0, 1.12, -0.27);
    const flap = box(0.34, 0.2, 0.05, BAG, true, 1.05); flap.position.set(0, 1.28, -0.15);
    const strapL = box(0.06, 0.5, 0.06, STRAP, true, 1.07); strapL.position.set(-0.16, 1.18, 0.14); strapL.rotation.x = 0.1;
    const strapR = box(0.06, 0.5, 0.06, STRAP, true, 1.07); strapR.position.set( 0.16, 1.18, 0.14); strapR.rotation.x = 0.1;

    // ── Arms: bare (short sleeves) + hands, slim ────────────────────────────
    this.armL = box(0.15, 0.6, 0.17, SKIN, true, 1.05); this.armL.position.set(-0.31, 1.06, 0);
    this.armR = box(0.15, 0.6, 0.17, SKIN, true, 1.05); this.armR.position.set( 0.31, 1.06, 0);
    const sleeveL = box(0.18, 0.22, 0.2, SHIRT, true, 1.04); sleeveL.position.set(0, 0.2, 0); this.armL.add(sleeveL);
    const sleeveR = box(0.18, 0.22, 0.2, SHIRT, true, 1.04); sleeveR.position.set(0, 0.2, 0); this.armR.add(sleeveR);
    const handL = ball(0.085, SKIN, true, 1.07); handL.position.set(0, -0.34, 0.02); this.armL.add(handL);
    const handR = ball(0.085, SKIN, true, 1.07); handR.position.set(0, -0.34, 0.05); this.armR.add(handR);

    // Spray can in the right hand (a signature colour accent)
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 10), toonMat('#d8d4cc'));
    can.castShadow = true; addInk(can, 1.12); can.position.set(0, -0.4, 0.11); this.armR.add(can);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.06, 10), toonMat('#ff6b35'));
    addInk(cap, 1.14); cap.position.set(0, -0.27, 0.11); this.armR.add(cap);

    // ── Dark shorts + bare legs + sneakers ──────────────────────────────────
    const shorts = box(0.44, 0.3, 0.27, SHORTS, true, 1.04); shorts.position.set(0, 0.74, 0);
    this.legL = box(0.16, 0.56, 0.18, SKIN, true, 1.05); this.legL.position.set(-0.11, 0.37, 0);
    this.legR = box(0.16, 0.56, 0.18, SKIN, true, 1.05); this.legR.position.set( 0.11, 0.37, 0);
    const shoeL = box(0.2, 0.1, 0.32, SHOE, true, 1.06); shoeL.position.set(-0.11, 0.04, 0.05);
    const shoeR = box(0.2, 0.1, 0.32, SHOE, true, 1.06); shoeR.position.set( 0.11, 0.04, 0.05);
    const soleL = box(0.21, 0.04, 0.33, SOLE, false); soleL.position.set(-0.11, -0.01, 0.05);
    const soleR = box(0.21, 0.04, 0.33, SOLE, false); soleR.position.set( 0.11, -0.01, 0.05);

    [this.head, neck, this.body, collar, pack, flap, strapL, strapR,
     this.armL, this.armR, shorts, this.legL, this.legR,
     shoeL, shoeR, soleL, soleR].forEach(m => this.group.add(m));

    this.group.position.set(start.x, 0, start.z);
    scene.add(this.group);
  }

  faceDirection(rot)     { this.facing = Math.atan2(rot.x, rot.z); }
  faceNormalInward(slot) { this.facing = Math.atan2(-slot.nx, -slot.nz); }

  walk(t, scale = 1) {
    const s = Math.sin(t * 8) * 0.36 * scale;
    this.armL.rotation.x =  s; this.armR.rotation.x = -s;
    this.legL.rotation.x = -s; this.legR.rotation.x =  s;
    this.head.position.y = 1.66 + Math.sin(t * 16) * 0.012;
    this.head.rotation.y = 0;
  }

  idle(t) {
    this.armL.rotation.x = this.armR.rotation.x = 0;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.head.position.y = 1.66;
    this.head.rotation.y = Math.sin(t * 0.9) * 0.06;
  }

  paint(t) {
    this.armL.rotation.x = 0;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.armR.rotation.x = Math.sin(t * 6) * 0.55 - 0.5;   // lifted, spraying
    this.head.rotation.y = Math.sin(t * 3) * 0.04;
  }

  // Ease the heading only. The flat (pos, yaw) is the source of truth; the App
  // maps it onto the little planet each frame (placeOnPlanet), so we must NOT
  // write group.position/rotation here (that mapping would be clobbered).
  sync() {
    this.yaw = lerpAngle(this.yaw, this.facing, 0.15);
  }
}
