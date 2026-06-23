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

// KAI (カイ) — a Japanese student in a black gakuran (high-collar school
// uniform), short black hair, carrying a pale leather briefcase low in his
// left hand. Modelled on the reference manga frame (Asano-esque). Cel-shaded
// with black ink contours so he reads as a drawn figure walking the lanes.
export class Character {
  constructor(scene, start) {
    this.pos    = { x: start.x, z: start.z };
    this.facing = 0;
    this.group  = new THREE.Group();

    // Head — light skin, ink contour
    this.head = part(0.44, 0.44, 0.40, '#e6d6c0', true, 1.05);
    this.head.position.y = 1.58;

    // Hair — short, neat black cut (top + a little down the back/sides)
    const hairTop = part(0.50, 0.20, 0.46, '#0a0808', true, 1.04);
    hairTop.position.set(0, 1.80, -0.01);
    const hairBack = part(0.46, 0.20, 0.12, '#0a0808', true, 1.04);
    hairBack.position.set(0, 1.62, -0.20);

    // Gakuran stand-up collar (black) with a thin white inner collar line
    const collar = part(0.46, 0.16, 0.34, '#141210', true, 1.05);
    collar.position.set(0, 1.30, 0.0);
    const collarLine = part(0.30, 0.04, 0.345, '#ece8e2');
    collarLine.position.set(0, 1.36, 0.0);

    // Jacket / body — black gakuran, ink contour
    this.body = part(0.50, 0.70, 0.30, '#15140f', true, 1.05);
    this.body.position.y = 0.92;

    // Two small light buttons down the front (a hint of the uniform placket)
    const btn = (y) => { const b = part(0.05, 0.05, 0.06, '#b9b3a4'); b.position.set(0, y, 0.16); return b; };
    const btn1 = btn(1.06), btn2 = btn(0.86);

    // Arms — black sleeves
    this.armL = part(0.17, 0.50, 0.20, '#15140f', true, 1.06);
    this.armL.position.set(-0.38, 0.88, 0);
    this.armR = part(0.17, 0.50, 0.20, '#15140f', true, 1.06);
    this.armR.position.set( 0.38, 0.88, 0);

    // Trousers — dark, slightly bluish black
    this.legL = part(0.20, 0.56, 0.25, '#0c0c10', true, 1.05);
    this.legL.position.set(-0.13, 0.30, 0);
    this.legR = part(0.20, 0.56, 0.25, '#0c0c10', true, 1.05);
    this.legR.position.set( 0.13, 0.30, 0);

    // Shoes
    const shoeL = part(0.22, 0.09, 0.30, '#100c08', true, 1.06);
    shoeL.position.set(-0.13, 0.02, 0.02);
    const shoeR = part(0.22, 0.09, 0.30, '#100c08', true, 1.06);
    shoeR.position.set( 0.13, 0.02, 0.02);

    // Pale leather briefcase, hanging low in the left hand
    const bag = part(0.36, 0.26, 0.11, '#c9bfa6', true, 1.06);
    bag.position.set(-0.52, 0.42, 0.06);
    const bagHandle = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.018, 5, 10),
      toonMat('#8a8270'),
    );
    bagHandle.position.set(-0.52, 0.58, 0.06);
    bagHandle.scale.set(1, 0.6, 1);

    [this.head, hairTop, hairBack, collar, collarLine, this.body, btn1, btn2,
     this.armL, this.armR,
     this.legL, this.legR, shoeL, shoeR, bag, bagHandle].forEach(m => this.group.add(m));

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
    // left arm (briefcase) hangs still; right hand makes the painting gesture
    this.armL.rotation.x = 0;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.armR.rotation.x = Math.sin(t * 6) * 0.55 - 0.28;
    this.head.rotation.y = Math.sin(t * 3) * 0.04;
  }

  sync() {
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.facing, 0.15);
    this.group.position.set(this.pos.x, 0, this.pos.z);
  }
}
