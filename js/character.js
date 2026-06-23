import * as THREE from 'three';
import { lerpAngle } from './helpers.js';
import { toonMat, addInk } from './toon.js';

// Cel-shaded box with optional ink outline
function part(w, h, d, color, ink = false, k = 1.06) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(color));
  m.castShadow = true;
  if (ink) addInk(m, k);
  return m;
}
// Cel-shaded cylinder with optional ink outline
function cyl(rt, rb, h, color, ink = false, k = 1.08, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), toonMat(color));
  m.castShadow = true;
  if (ink) addInk(m, k);
  return m;
}

// KAI (カイ) — a Japanese student street-artist. Black gakuran (high-collar
// school uniform) over dark trousers, short black hair, a backpack on his
// shoulders, and a spray can with a colour-popped cap in his right hand.
// Modelled on the reference frame (Asano-esque) and cel-shaded with black ink
// contours so he reads as a drawn figure walking the lanes.
export class Character {
  constructor(scene, start) {
    this.pos    = { x: start.x, z: start.z };
    this.facing = 0;
    this.group  = new THREE.Group();

    // ── Head ───────────────────────────────────────────────────────────────
    this.head = part(0.44, 0.44, 0.40, '#e6d6c0', true, 1.05);
    this.head.position.y = 1.58;
    const hairTop  = part(0.50, 0.20, 0.46, '#0a0808', true, 1.04); hairTop.position.set(0, 1.81, -0.01);
    const hairBack = part(0.46, 0.22, 0.13, '#0a0808', true, 1.04); hairBack.position.set(0, 1.60, -0.20);
    const fringe   = part(0.46, 0.10, 0.06, '#0a0808', true, 1.05); fringe.position.set(0, 1.70, 0.20);
    const earL = part(0.05, 0.12, 0.10, '#e0cfb8'); earL.position.set(-0.23, 1.56, 0.02);
    const earR = part(0.05, 0.12, 0.10, '#e0cfb8'); earR.position.set( 0.23, 1.56, 0.02);
    const neck = part(0.18, 0.12, 0.18, '#d8c4ac'); neck.position.set(0, 1.34, 0);

    // ── Gakuran collar (black stand collar + thin white inner line) ─────────
    const collar     = part(0.46, 0.16, 0.34, '#141210', true, 1.05); collar.position.set(0, 1.28, 0);
    const collarLine = part(0.30, 0.04, 0.345, '#ece8e2');            collarLine.position.set(0, 1.34, 0);

    // ── Jacket / body ───────────────────────────────────────────────────────
    this.body = part(0.50, 0.70, 0.30, '#15140f', true, 1.05); this.body.position.y = 0.92;
    const placket = part(0.04, 0.66, 0.31, '#26241d'); placket.position.set(0, 0.92, 0.005);
    const btn = (y) => { const b = part(0.05, 0.05, 0.06, '#b9b3a4'); b.position.set(0, y, 0.16); return b; };
    const btn1 = btn(1.08), btn2 = btn(0.90), btn3 = btn(0.72);
    const belt = part(0.52, 0.10, 0.31, '#0a0a08', true, 1.05); belt.position.set(0, 0.58, 0);

    // ── Backpack on the shoulders ───────────────────────────────────────────
    const packBody = part(0.42, 0.56, 0.22, '#3a3a32', true, 1.04); packBody.position.set(0, 1.02, -0.30);
    const packFlap = part(0.44, 0.22, 0.10, '#33332b', true, 1.05); packFlap.position.set(0, 1.22, -0.36);
    const packPkt  = part(0.26, 0.22, 0.10, '#43433a', true, 1.06); packPkt.position.set(0, 0.86, -0.40);
    const strapL = part(0.07, 0.62, 0.07, '#2a2a24', true, 1.07); strapL.position.set(-0.20, 1.02, 0.16); strapL.rotation.x = 0.12;
    const strapR = part(0.07, 0.62, 0.07, '#2a2a24', true, 1.07); strapR.position.set( 0.20, 1.02, 0.16); strapR.rotation.x = 0.12;

    // ── Arms (with hands) ───────────────────────────────────────────────────
    this.armL = part(0.17, 0.50, 0.20, '#15140f', true, 1.06); this.armL.position.set(-0.38, 0.88, 0);
    this.armR = part(0.17, 0.50, 0.20, '#15140f', true, 1.06); this.armR.position.set( 0.38, 0.88, 0);
    const cuffL = part(0.18, 0.05, 0.21, '#26241d'); cuffL.position.set(0, -0.22, 0); this.armL.add(cuffL);
    const cuffR = part(0.18, 0.05, 0.21, '#26241d'); cuffR.position.set(0, -0.22, 0); this.armR.add(cuffR);
    const handL = part(0.15, 0.14, 0.17, '#e6d6c0', true, 1.07); handL.position.set(0, -0.30, 0.02); this.armL.add(handL);
    const handR = part(0.15, 0.14, 0.17, '#e6d6c0', true, 1.07); handR.position.set(0, -0.30, 0.06); this.armR.add(handR);

    // ── Spray can in the right hand (the only pop of colour) ────────────────
    const can = cyl(0.058, 0.058, 0.24, '#d8d4cc', true, 1.12); can.position.set(0, -0.34, 0.12); this.armR.add(can);
    const canBand = cyl(0.06, 0.06, 0.05, '#9a9690'); canBand.position.set(0, -0.40, 0.12); this.armR.add(canBand);
    const canCap = cyl(0.05, 0.06, 0.06, '#ff6b35', true, 1.14); canCap.position.set(0, -0.20, 0.12); this.armR.add(canCap);
    const nozzle = cyl(0.012, 0.012, 0.03, '#2a2a2a'); nozzle.position.set(0, -0.15, 0.12); this.armR.add(nozzle);

    // ── Trousers + shoes ────────────────────────────────────────────────────
    this.legL = part(0.20, 0.56, 0.25, '#0c0c10', true, 1.05); this.legL.position.set(-0.13, 0.30, 0);
    this.legR = part(0.20, 0.56, 0.25, '#0c0c10', true, 1.05); this.legR.position.set( 0.13, 0.30, 0);
    const shoeL = part(0.22, 0.10, 0.32, '#100c08', true, 1.06); shoeL.position.set(-0.13, 0.03, 0.03);
    const shoeR = part(0.22, 0.10, 0.32, '#100c08', true, 1.06); shoeR.position.set( 0.13, 0.03, 0.03);
    const soleL = part(0.23, 0.04, 0.33, '#cfcabd'); soleL.position.set(-0.13, -0.005, 0.03);
    const soleR = part(0.23, 0.04, 0.33, '#cfcabd'); soleR.position.set( 0.13, -0.005, 0.03);

    [this.head, hairTop, hairBack, fringe, earL, earR, neck,
     collar, collarLine, this.body, placket, btn1, btn2, btn3, belt,
     packBody, packFlap, packPkt, strapL, strapR,
     this.armL, this.armR,
     this.legL, this.legR, shoeL, shoeR, soleL, soleR].forEach(m => this.group.add(m));

    this.group.position.set(start.x, 0, start.z);
    scene.add(this.group);
  }

  faceDirection(rot)     { this.facing = Math.atan2(rot.x, rot.z); }
  faceNormalInward(slot) { this.facing = Math.atan2(-slot.nx, -slot.nz); }

  walk(t, scale = 1) {
    const s = Math.sin(t * 8) * 0.38 * scale;
    this.armL.rotation.x =  s; this.armR.rotation.x = -s;
    this.legL.rotation.x = -s; this.legR.rotation.x =  s;
    this.head.position.y = 1.58 + Math.sin(t * 16) * 0.012;
    this.head.rotation.y = 0;
  }

  idle(t) {
    this.armL.rotation.x = this.armR.rotation.x = 0;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.head.rotation.y = Math.sin(t * 0.9) * 0.06;
  }

  paint(t) {
    // left arm rests; right hand (spray can) makes the painting gesture
    this.armL.rotation.x = 0;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.armR.rotation.x = Math.sin(t * 6) * 0.55 - 0.5;   // lifted, spraying
    this.head.rotation.y = Math.sin(t * 3) * 0.04;
  }

  sync() {
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.facing, 0.15);
    this.group.position.set(this.pos.x, 0, this.pos.z);
  }
}
