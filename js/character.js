import * as THREE from 'three';
import { lerpAngle } from './helpers.js';

function box(w, h, d, color, emissive = null) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });
  if (emissive) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = 0.18;
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

export class Character {
  constructor(scene, start) {
    this.pos    = { x: start.x, z: start.z };
    this.facing = 0;
    this.group  = new THREE.Group();

    // Head — warm terracotta
    this.head = box(0.42, 0.42, 0.42, '#c97a50');
    this.head.position.y = 1.57;

    // Hat: brim + crown (yellow, iconic silhouette)
    const brim  = box(0.60, 0.06, 0.60, '#f5c518'); brim.position.y  = 1.82;
    const crown = box(0.34, 0.24, 0.34, '#f5c518'); crown.position.y = 1.95;

    // Body — vivid orange-red with slight emissive so it pops in shadows
    this.body = box(0.52, 0.72, 0.32, '#ff4500', '#cc2200');
    this.body.position.y = 0.91;

    // Backpack (paint supplies) — dark slate
    const pack = box(0.22, 0.32, 0.12, '#3a3a50');
    pack.position.set(0, 0.98, -0.22);

    // Legs — near-black navy for ground contrast
    this.legL = box(0.20, 0.52, 0.26, '#0d0d28'); this.legL.position.set(-0.13, 0.30, 0);
    this.legR = box(0.20, 0.52, 0.26, '#0d0d28'); this.legR.position.set( 0.13, 0.30, 0);

    // Shoes — warm brown
    const shoeL = box(0.22, 0.10, 0.30, '#4a2e18'); shoeL.position.set(-0.13, 0.03,  0.02);
    const shoeR = box(0.22, 0.10, 0.30, '#4a2e18'); shoeR.position.set( 0.13, 0.03,  0.02);

    // Arms — same vivid orange with emissive
    this.armL = box(0.18, 0.52, 0.20, '#ff4500', '#cc2200'); this.armL.position.set(-0.40, 0.86, 0);
    this.armR = box(0.18, 0.52, 0.20, '#ff4500', '#cc2200'); this.armR.position.set( 0.40, 0.86, 0);

    [this.head, brim, crown, this.body, pack,
     this.legL, this.legR, shoeL, shoeR,
     this.armL, this.armR].forEach(m => this.group.add(m));

    this.group.position.set(start.x, 0, start.z);
    scene.add(this.group);
  }

  // --- facing helpers -------------------------------------------------------
  faceDirection(rot)    { this.facing = Math.atan2(rot.x, rot.z); }
  faceNormalInward(slot){ this.facing = Math.atan2(-slot.nx, -slot.nz); }

  // --- animation frames -----------------------------------------------------
  walk(t, scale = 1) {
    const s = Math.sin(t * 8) * 0.4 * scale;
    this.armL.rotation.x =  s; this.armR.rotation.x = -s;
    this.legL.rotation.x = -s; this.legR.rotation.x =  s;
    this.head.position.y = 1.57 + Math.sin(t * 16) * 0.015;
    this.head.rotation.y = 0;
  }

  idle(t) {
    this.armL.rotation.x = this.armR.rotation.x = 0;
    this.legL.rotation.x = this.legR.rotation.x = 0;
    this.head.rotation.y = Math.sin(t) * 0.05;
  }

  paint(t) {
    this.legL.rotation.x = this.legR.rotation.x = this.armL.rotation.x = 0;
    this.armR.rotation.x = Math.sin(t * 6) * 0.6 - 0.3;
    this.head.rotation.y = 0;
  }

  // Flush position + facing to Three.js group (call once per frame)
  sync() {
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.facing, 0.15);
    this.group.position.set(this.pos.x, 0, this.pos.z);
  }
}
