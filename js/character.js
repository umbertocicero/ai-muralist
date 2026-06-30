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

    // ── Arms: rigged at the shoulder, folding at the elbow ──────────────────
    // Each arm is a Group whose pivot sits at the shoulder ball. The upper arm
    // hangs from that pivot; an elbow Group hangs from the bottom of the upper
    // arm; the forearm + hand hang from the elbow. So the whole arm swings from
    // the shoulder and bends at the elbow, instead of a single cylinder spinning
    // about its own middle.
    const buildArm = (side) => {
      const shoulder = new THREE.Group(); shoulder.position.set(side * 0.30, 1.36, 0);
      const upper  = cyl(0.072, 0.062, 0.34, SKIN, true, 1.05, 12); upper.position.y  = -0.17;
      const sleeve = cyl(0.105, 0.092, 0.22, SHIRT, true, 1.04, 14); sleeve.position.y = -0.07;
      const elbow  = new THREE.Group(); elbow.position.y = -0.34;
      const fore   = cyl(0.062, 0.05, 0.30, SKIN, true, 1.05, 12); fore.position.y = -0.15;
      const hand   = ball(0.085, SKIN, true, 1.07); hand.position.set(0, -0.31, 0.02);
      elbow.add(fore, hand);
      shoulder.add(upper, sleeve, elbow);
      return { shoulder, elbow };
    };
    const aL = buildArm(-1), aR = buildArm(1);
    this.armL = aL.shoulder; this.elbowL = aL.elbow;
    this.armR = aR.shoulder; this.elbowR = aR.elbow;

    // Spray can (the lone colour accent), carried on the right forearm so it
    // tracks the elbow as the arm folds.
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), toonMat('#d8d4cc'));
    can.castShadow = true; addInk(can, 1.12); can.position.set(0, -0.33, 0.11); aR.elbow.add(can);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.06, 12), toonMat('#ff6b35'));
    addInk(cap, 1.14); cap.position.set(0, -0.20, 0.11); aR.elbow.add(cap);

    // ── Dark shorts + rigged legs (hip pivot, bending knee) + sneakers ──────
    // Same idea as the arms: a hip Group pivots the whole leg, the thigh hangs
    // from it, a knee Group hangs from the thigh, and the shin + shoe hang from
    // the knee — so the leg swings from the hip and the foot lifts at the knee.
    const shorts = cyl(0.235, 0.205, 0.34, SHORTS, true, 1.03, 16); shorts.position.set(0, 0.73, 0); shorts.scale.z = 0.84;
    const buildLeg = (side) => {
      const hip   = new THREE.Group(); hip.position.set(side * 0.11, 0.65, 0);
      const thigh = cyl(0.082, 0.07, 0.30, SKIN, true, 1.05, 12); thigh.position.y = -0.15;
      const knee  = new THREE.Group(); knee.position.y = -0.30;
      const shin  = cyl(0.07, 0.062, 0.275, SKIN, true, 1.05, 12); shin.position.y = -0.1375;
      const shoe  = blob(0.13, SHOE, 0.8, 0.62, 1.26, true, 1.05); shoe.position.set(0, -0.275, 0.06);
      const sole  = blob(0.13, SOLE, 0.86, 0.28, 1.32, false);     sole.position.set(0, -0.325, 0.06);
      knee.add(shin, shoe, sole);
      hip.add(thigh, knee);
      return { hip, knee };
    };
    const lL = buildLeg(-1), lR = buildLeg(1);
    this.legL = lL.hip; this.kneeL = lL.knee;
    this.legR = lR.hip; this.kneeR = lR.knee;

    [this.head, neck, this.body, chest, collar, shoulderL, shoulderR, pack, flap, strapL, strapR,
     this.armL, this.armR, shorts, this.legL, this.legR].forEach(m => this.group.add(m));

    this.group.position.set(start.x, 0, start.z);
    scene.add(this.group);
  }

  faceDirection(rot)     { this.facing = Math.atan2(rot.x, rot.z); }
  faceNormalInward(slot) { this.facing = Math.atan2(-slot.nx, -slot.nz); }

  walk(t, scale = 1) {
    const ph = t * 8, s = Math.sin(ph);
    // Shoulders swing fore/aft, opposite to the hips, with a soft elbow carry
    // that folds a little harder on each backswing.
    this.armL.rotation.x   =  s * 0.45 * scale;
    this.armR.rotation.x   = -s * 0.45 * scale;
    this.elbowL.rotation.x = -(0.3 + Math.max(0,  s) * 0.45) * scale;
    this.elbowR.rotation.x = -(0.3 + Math.max(0, -s) * 0.45) * scale;
    // Hips swing the legs; the trailing leg's knee folds to lift the foot clear.
    this.legL.rotation.x  = -s * 0.5 * scale;
    this.legR.rotation.x  =  s * 0.5 * scale;
    this.kneeL.rotation.x =  Math.max(0,  s) * 0.95 * scale;
    this.kneeR.rotation.x =  Math.max(0, -s) * 0.95 * scale;
    this.head.position.y = 1.66 + Math.sin(ph * 2) * 0.012;
    this.head.rotation.y = 0;
  }

  idle(t) {
    this.armL.rotation.x = this.armR.rotation.x = 0;
    this.elbowL.rotation.x = this.elbowR.rotation.x = -0.22;   // relaxed soft bend
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.kneeL.rotation.x = this.kneeR.rotation.x =  0.04;     // knees not locked
    this.head.position.y = 1.66 + Math.sin(t * 1.8) * 0.004;  // breathing
    this.head.rotation.y = Math.sin(t * 0.9) * 0.06;
  }

  paint(t) {
    this.armL.rotation.x = 0; this.elbowL.rotation.x = -0.3;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.kneeL.rotation.x = this.kneeR.rotation.x =  0.05;
    // Right shoulder lifts the arm to the wall; the elbow works the can up and
    // down for the spraying stroke.
    this.armR.rotation.x   = -1.1 + Math.sin(t * 6) * 0.12;
    this.elbowR.rotation.x = -0.7 + Math.sin(t * 6) * 0.35;
    this.head.rotation.y = Math.sin(t * 3) * 0.04;
  }

  // Ease the heading only. The flat (pos, yaw) is the source of truth; the App
  // maps it onto the little planet each frame (placeOnPlanet), so we must NOT
  // write group.position/rotation here (that mapping would be clobbered).
  sync() {
    this.yaw = lerpAngle(this.yaw, this.facing, 0.15);
  }
}
