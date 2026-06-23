import * as THREE from 'three';
import { lerpAngle } from './helpers.js';

function box(w, h, d, color, emissive = null, emissiveIntensity = 0.12) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02 });
  if (emissive) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = emissiveIntensity;
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

// MURO — manga-style Japanese street artist
// Silhouette: dark jacket, light undershirt flash, black trousers
export class Character {
  constructor(scene, start) {
    this.pos    = { x: start.x, z: start.z };
    this.facing = 0;
    this.group  = new THREE.Group();

    // Head — light skin, slightly larger (manga proportion)
    this.head = box(0.44, 0.44, 0.40, '#d4c0a0');
    this.head.position.y = 1.58;

    // Hair — flat dark block on crown
    const hair = box(0.48, 0.12, 0.44, '#0a0808');
    hair.position.set(0, 1.84, -0.01);

    // Cap visor — dark flat brim over eyes
    const visor = box(0.46, 0.06, 0.18, '#181614');
    visor.position.set(0, 1.76, 0.15);

    // Jacket / body — dark charcoal with slight emissive so it reads in shadow
    this.body = box(0.50, 0.68, 0.30, '#1c1c1c', '#303030', 0.10);
    this.body.position.y = 0.92;

    // Collar / undershirt flash — light stripe visible at neck
    const collar = box(0.28, 0.10, 0.31, '#dedad6');
    collar.position.set(0, 1.24, 0.0);

    // Messenger bag — dark satchel at left hip
    const bag = box(0.28, 0.24, 0.10, '#1e1c14');
    bag.position.set(-0.34, 0.82, -0.18);

    // Spray-can in right hand (small white cylinder)
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: '#e0ddd8', roughness: 0.4 })
    );
    can.position.set(0.56, 0.68, 0.08);
    can.castShadow = true;

    // Arms — dark jacket
    this.armL = box(0.17, 0.50, 0.20, '#1c1c1c', '#282828', 0.10);
    this.armL.position.set(-0.38, 0.88, 0);
    this.armR = box(0.17, 0.50, 0.20, '#1c1c1c', '#282828', 0.10);
    this.armR.position.set( 0.38, 0.88, 0);

    // Trousers — near-black
    this.legL = box(0.20, 0.54, 0.25, '#0a0a0a');
    this.legL.position.set(-0.13, 0.30, 0);
    this.legR = box(0.20, 0.54, 0.25, '#0a0a0a');
    this.legR.position.set( 0.13, 0.30, 0);

    // Shoes — very dark brown
    const shoeL = box(0.22, 0.09, 0.30, '#100c08');
    shoeL.position.set(-0.13, 0.02, 0.02);
    const shoeR = box(0.22, 0.09, 0.30, '#100c08');
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
