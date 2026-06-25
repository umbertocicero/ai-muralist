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
// A rounded limb/torso piece: a (optionally tapered) cylinder. Far softer than a
// box — this is what takes the "squareness" out of the figure so it reads as a
// drawn manga body instead of a stack of crates.
function cyl(rTop, rBot, h, color, ink = true, k = 1.05, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), toonMat(color));
  m.castShadow = true; if (ink) addInk(m, k); return m;
}
// A squashable rounded blob (an ellipsoid) — for shoes, the pack, soft caps.
function blob(r, color, sx, sy, sz, ink = true, k = 1.05) {
  const m = ball(r, color, ink, k); m.scale.set(sx, sy, sz); return m;
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

    // ── Neck + rounded short-sleeve shirt torso ─────────────────────────────
    // Tapered cylinder (broad shoulders → narrow waist), flattened front-to-back,
    // capped with a soft chest blob — a drawn torso, not a crate.
    const neck = cyl(0.07, 0.085, 0.16, SKIN, false); neck.position.y = 1.45;
    this.body = cyl(0.215, 0.17, 0.62, SHIRT, true, 1.03, 16); this.body.position.y = 1.13; this.body.scale.z = 0.8;
    const chest = blob(0.225, SHIRT, 1.0, 0.62, 0.82, true, 1.03); chest.position.set(0, 1.41, 0);
    const collar = blob(0.155, SHIRT, 1.0, 0.5, 0.92, false); collar.position.set(0, 1.47, 0);
    // rounded shoulder balls where the arms meet the torso
    const shoulderL = blob(0.12, SHIRT, 1.0, 0.9, 1.0, true, 1.04); shoulderL.position.set(-0.26, 1.33, 0);
    const shoulderR = blob(0.12, SHIRT, 1.0, 0.9, 1.0, true, 1.04); shoulderR.position.set( 0.26, 1.33, 0);

    // ── Backpack on the back (signature, kept greyscale) — rounded ──────────
    const pack = blob(0.26, BAG, 1.32, 1.7, 0.86, true, 1.03); pack.position.set(0, 1.12, -0.28);
    const flap = blob(0.2, BAG, 1.55, 0.72, 0.5, true, 1.04); flap.position.set(0, 1.3, -0.18);
    const strapL = cyl(0.033, 0.033, 0.52, STRAP, true, 1.08, 8); strapL.position.set(-0.16, 1.18, 0.13); strapL.rotation.x = 0.08;
    const strapR = cyl(0.033, 0.033, 0.52, STRAP, true, 1.08, 8); strapR.position.set( 0.16, 1.18, 0.13); strapR.rotation.x = 0.08;

    // ── Arms: bare tapered limbs (short sleeves) + ball hands ────────────────
    this.armL = cyl(0.072, 0.058, 0.6, SKIN, true, 1.05, 12); this.armL.position.set(-0.30, 1.06, 0);
    this.armR = cyl(0.072, 0.058, 0.6, SKIN, true, 1.05, 12); this.armR.position.set( 0.30, 1.06, 0);
    const sleeveL = cyl(0.105, 0.092, 0.22, SHIRT, true, 1.04, 14); sleeveL.position.set(0, 0.22, 0); this.armL.add(sleeveL);
    const sleeveR = cyl(0.105, 0.092, 0.22, SHIRT, true, 1.04, 14); sleeveR.position.set(0, 0.22, 0); this.armR.add(sleeveR);
    const handL = ball(0.085, SKIN, true, 1.07); handL.position.set(0, -0.34, 0.02); this.armL.add(handL);
    const handR = ball(0.085, SKIN, true, 1.07); handR.position.set(0, -0.34, 0.05); this.armR.add(handR);

    // Spray can in the right hand (a signature colour accent)
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), toonMat('#d8d4cc'));
    can.castShadow = true; addInk(can, 1.12); can.position.set(0, -0.4, 0.11); this.armR.add(can);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.06, 12), toonMat('#ff6b35'));
    addInk(cap, 1.14); cap.position.set(0, -0.27, 0.11); this.armR.add(cap);

    // ── Dark shorts + bare tapered legs + rounded sneakers ──────────────────
    const shorts = cyl(0.235, 0.205, 0.34, SHORTS, true, 1.03, 16); shorts.position.set(0, 0.73, 0); shorts.scale.z = 0.84;
    this.legL = cyl(0.082, 0.066, 0.56, SKIN, true, 1.05, 12); this.legL.position.set(-0.11, 0.37, 0);
    this.legR = cyl(0.082, 0.066, 0.56, SKIN, true, 1.05, 12); this.legR.position.set( 0.11, 0.37, 0);
    const shoeL = blob(0.13, SHOE, 0.8, 0.62, 1.26, true, 1.05); shoeL.position.set(-0.11, 0.075, 0.06);
    const shoeR = blob(0.13, SHOE, 0.8, 0.62, 1.26, true, 1.05); shoeR.position.set( 0.11, 0.075, 0.06);
    const soleL = blob(0.13, SOLE, 0.86, 0.28, 1.32, false); soleL.position.set(-0.11, 0.025, 0.06);
    const soleR = blob(0.13, SOLE, 0.86, 0.28, 1.32, false); soleR.position.set( 0.11, 0.025, 0.06);

    [this.head, neck, this.body, chest, collar, shoulderL, shoulderR, pack, flap, strapL, strapR,
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
