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

// KAI (カイ) — manga-style Japanese teenage street artist.
// Dark jacket, black hair + cap, light undershirt flash, messenger bag,
// spray can in hand. Rendered cel-shaded with black ink contours so he reads
// as a drawn figure, not a 3D toy.
export class Character {
  constructor(scene, start) {
    this.pos    = { x: start.x, z: start.z };
    this.facing = 0;
    this.group  = new THREE.Group();

    // Head — light skin, ink contour
    this.head = part(0.44, 0.44, 0.40, '#e6d6c0', true, 1.05);
    this.head.position.y = 1.58;

    // Hair — flat black block
    const hair = part(0.48, 0.13, 0.44, '#0a0808', true, 1.04);
    hair.position.set(0, 1.84, -0.01);

    // Cap visor
    const visor = part(0.46, 0.06, 0.18, '#141210');
    visor.position.set(0, 1.76, 0.15);

    // Jacket / body — near-black, ink contour
    this.body = part(0.50, 0.68, 0.30, '#1a1a1a', true, 1.05);
    this.body.position.y = 0.92;

    // Undershirt collar flash — light stripe
    const collar = part(0.28, 0.10, 0.31, '#e8e4e0');
    collar.position.set(0, 1.24, 0.0);

    // Messenger bag
    const bag = part(0.28, 0.24, 0.10, '#171510', true, 1.06);
    bag.position.set(-0.34, 0.82, -0.18);

    // Spray can in right hand
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8),
      toonMat('#e2dfda')
    );
    can.position.set(0.56, 0.68, 0.08);
    can.castShadow = true;
    addInk(can, 1.12);

    // Arms — dark jacket
    this.armL = part(0.17, 0.50, 0.20, '#1a1a1a', true, 1.06);
    this.armL.position.set(-0.38, 0.88, 0);
    this.armR = part(0.17, 0.50, 0.20, '#1a1a1a', true, 1.06);
    this.armR.position.set( 0.38, 0.88, 0);

    // Trousers — black
    this.legL = part(0.20, 0.54, 0.25, '#0c0c0c', true, 1.05);
    this.legL.position.set(-0.13, 0.30, 0);
    this.legR = part(0.20, 0.54, 0.25, '#0c0c0c', true, 1.05);
    this.legR.position.set( 0.13, 0.30, 0);

    // Shoes
    const shoeL = part(0.22, 0.09, 0.30, '#100c08', true, 1.06);
    shoeL.position.set(-0.13, 0.02, 0.02);
    const shoeR = part(0.22, 0.09, 0.30, '#100c08', true, 1.06);
    shoeR.position.set( 0.13, 0.02, 0.02);

    [this.head, hair, visor, this.body, collar, bag, can,
     this.armL, this.armR,
     this.legL, this.legR, shoeL, shoeR].forEach(m => this.group.add(m));

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
    this.legL.rotation.x = this.legR.rotation.x = this.armL.rotation.x = 0;
    this.armR.rotation.x = Math.sin(t * 6) * 0.55 - 0.28;
    this.head.rotation.y = Math.sin(t * 3) * 0.04;
  }

  sync() {
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.facing, 0.15);
    this.group.position.set(this.pos.x, 0, this.pos.z);
  }
}
