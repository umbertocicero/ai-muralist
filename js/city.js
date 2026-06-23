import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';

export class City {
  constructor(scene) {
    this.scene    = scene;
    this.bboxes   = [];
    this.wallSlots = [];
    this._buildGround();
    this._buildBuildings();
  }

  // ---- Ground, roads, sidewalks -------------------------------------------
  _buildGround() {
    const plane = (w, d, color, x = 0, y = 0.01, z = 0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color, roughness: 1 })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.scene.add(m);
    };

    plane(200, 200, '#7f7f7f', 0, 0, 0);

    // Main roads (along X and Z axes)
    plane(6, 200,   '#6e6e6e');
    plane(200, 6,   '#6e6e6e');
    // Secondary roads
    [-20, 20].forEach(c => {
      plane(5, 200, '#6e6e6e', c, 0.01, 0);
      plane(200, 5, '#6e6e6e', 0, 0.01, c);
    });
    // Sidewalks
    [-3.6, 3.6].forEach(o => {
      plane(1, 200, '#b8b4ac', o, 0.05, 0);
      plane(200, 1, '#b8b4ac', 0, 0.05, o);
    });
  }

  // ---- Buildings, collision boxes, wall slots ------------------------------
  _buildBuildings() {
    const cols = CONFIG.buildingColors;
    CONFIG.buildingPositions.forEach(([x, z], idx) => {
      const w = 7 + (idx % 3);
      const d = 7 + ((idx + 1) % 3);
      const h = 4 + (idx % 4);
      const color = cols[idx % cols.length];

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
      );
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);

      // AABB (padded by character radius)
      const r = CONFIG.charRadius;
      this.bboxes.push({
        minX: x - w/2 - r, maxX: x + w/2 + r,
        minZ: z - d/2 - r, maxZ: z + d/2 + r,
      });

      // Four wall slots: N (+z), S (-z), E (+x), W (-x)
      const py = h / 2;
      this.wallSlots.push({ px: x, py, pz: z + d/2, nx:  0, nz:  1, wallW: w, wallH: h, buildingIdx: idx, used: false, mesh: null });
      this.wallSlots.push({ px: x, py, pz: z - d/2, nx:  0, nz: -1, wallW: w, wallH: h, buildingIdx: idx, used: false, mesh: null });
      this.wallSlots.push({ px: x + w/2, py, pz: z,  nx:  1, nz:  0, wallW: d, wallH: h, buildingIdx: idx, used: false, mesh: null });
      this.wallSlots.push({ px: x - w/2, py, pz: z,  nx: -1, nz:  0, wallW: d, wallH: h, buildingIdx: idx, used: false, mesh: null });

      if (idx % 3 === 0) this._lamppost(x, z, w);
    });
  }

  _lamppost(bx, bz, bw) {
    const lx = bx + (bw / 2 + 1.4) * (bx >= 0 ? 1 : -1);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 4, 8),
      new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.6 })
    );
    post.position.set(lx, 2, bz);
    post.castShadow = true;
    this.scene.add(post);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe07a', emissiveIntensity: 0.6 })
    );
    bulb.position.set(lx, 4.1, bz);
    this.scene.add(bulb);
  }

  // ---- Collision -----------------------------------------------------------
  isColliding(x, z) {
    for (const b of this.bboxes) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  randomReachablePoint() {
    for (let i = 0; i < 30; i++) {
      const x = -35 + Math.random() * 70;
      const z = -35 + Math.random() * 70;
      if (!this.isColliding(x, z)) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  // ---- Wall slots ---------------------------------------------------------
  approachPoint(slot) {
    return {
      x: slot.px + slot.nx * CONFIG.approachOffset,
      z: slot.pz + slot.nz * CONFIG.approachOffset,
    };
  }

  isApproachFree(slot) {
    const p = this.approachPoint(slot);
    return !this.isColliding(p.x, p.z);
  }

  pickFreeSlot() {
    const free = this.wallSlots.filter(s => !s.used && this.isApproachFree(s));
    return free.length ? free[(Math.random() * free.length) | 0] : null;
  }

  allWallsUsed() {
    return this.wallSlots.every(s => s.used);
  }

  // ---- Steering -----------------------------------------------------------
  // Move pos one step toward target with obstacle avoidance + wall sliding.
  // Returns the chosen direction vector, or null if fully stuck.
  steer(pos, target, dist) {
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / len, z: dz / len };

    for (let attempt = 0; attempt < 12; attempt++) {
      const sign  = attempt % 2 === 0 ? 1 : -1;
      const steps = (attempt / 2) | 0;
      const rot   = rotateY2D(dir, sign * steps * (Math.PI / 12));
      const nx    = pos.x + rot.x * dist;
      const nz    = pos.z + rot.z * dist;
      if (!this.isColliding(nx, nz)) {
        pos.x = nx; pos.z = nz;
        return rot;
      }
    }
    return null;
  }
}
