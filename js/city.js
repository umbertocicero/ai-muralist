import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';

// Shared materials (created once, reused across all geometry)
const MAT = {
  roof:    new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.96 }),
  eave:    new THREE.MeshStandardMaterial({ color: '#121010', roughness: 0.85 }),
  pole:    new THREE.MeshStandardMaterial({ color: '#2e2820', roughness: 0.95 }),
  trunk:   new THREE.MeshStandardMaterial({ color: '#28201a', roughness: 1.0  }),
  foliage: new THREE.MeshStandardMaterial({ color: '#181816', roughness: 1.0  }),
  lowWall: new THREE.MeshStandardMaterial({ color: '#aeaaa4', roughness: 0.98 }),
  wire:    new THREE.LineBasicMaterial({ color: '#141212' }),
};

export class City {
  constructor(scene) {
    this.scene     = scene;
    this.bboxes    = [];
    this.wallSlots = [];
    this._buildGround();
    this._buildBuildings();
    this._buildUtilityPoles();
    this._buildProps();
  }

  // ── Ground, roads, sidewalks ──────────────────────────────────────────────
  _buildGround() {
    const flat = (w, d, color, x = 0, y = 0.01, z = 0, rough = 0.98) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color, roughness: rough })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.scene.add(m);
    };

    flat(200, 200, '#8e8a86');          // base — worn asphalt
    flat(7,   200, '#6a6a6a');          // main road (x-axis)
    flat(200, 7,   '#6a6a6a');          // main road (z-axis)
    [-21, 21].forEach(c => {
      flat(5, 200, '#606060', c, 0.01, 0);
      flat(200, 5, '#606060', 0, 0.01, c);
    });
    // Sidewalks — aged concrete slabs
    [-4.2, 4.2].forEach(o => {
      flat(1.4, 200, '#bcb8b2', o, 0.05, 0);
      flat(200, 1.4, '#bcb8b2', 0, 0.05, o);
    });
    // Centre-line road dashes
    for (let v = -88; v < 90; v += 8) {
      flat(0.25, 3.2, '#d8d4ce', v,    0.02, 0);
      flat(3.2, 0.25, '#d8d4ce', 0,    0.02, v);
    }
  }

  // ── Buildings ─────────────────────────────────────────────────────────────
  _buildBuildings() {
    CONFIG.buildingPositions.forEach(([x, z], idx) => {
      const w = 6 + (idx % 4);
      const d = 5 + ((idx + 1) % 4);
      const h = 2.8 + (idx % 4) * 1.3;  // 2.8 / 4.1 / 5.4 / 6.7 m
      const color = CONFIG.buildingColors[idx % CONFIG.buildingColors.length];

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.94 })
      );
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);

      this._hipRoof(x, z, w, d, h);
      this._addWindows(x, z, w, d, h, idx);

      const r = CONFIG.charRadius;
      this.bboxes.push({
        minX: x - w/2 - r, maxX: x + w/2 + r,
        minZ: z - d/2 - r, maxZ: z + d/2 + r,
      });

      const py = h / 2;
      this.wallSlots.push({ px: x,       py, pz: z + d/2, nx:  0, nz:  1, wallW: w, wallH: h, buildingIdx: idx, used: false, mesh: null });
      this.wallSlots.push({ px: x,       py, pz: z - d/2, nx:  0, nz: -1, wallW: w, wallH: h, buildingIdx: idx, used: false, mesh: null });
      this.wallSlots.push({ px: x + w/2, py, pz: z,       nx:  1, nz:  0, wallW: d, wallH: h, buildingIdx: idx, used: false, mesh: null });
      this.wallSlots.push({ px: x - w/2, py, pz: z,       nx: -1, nz:  0, wallW: d, wallH: h, buildingIdx: idx, used: false, mesh: null });
    });
  }

  // Japanese hip roof — 4-sided pyramid + dark eave trim
  _hipRoof(x, z, w, d, h) {
    const oh  = 0.38;
    const rH  = 0.9 + Math.min(w, d) * 0.13;
    const dia = Math.hypot(w + oh * 2, d + oh * 2) * 0.5;

    const cone = new THREE.Mesh(new THREE.ConeGeometry(dia, rH, 4), MAT.roof);
    cone.position.set(x, h + rH / 2, z);
    cone.rotation.y = Math.PI / 4;
    cone.castShadow = true;
    this.scene.add(cone);

    // Eave — dark overhang band
    const eave = new THREE.Mesh(new THREE.BoxGeometry(w + oh * 2, 0.14, d + oh * 2), MAT.eave);
    eave.position.set(x, h + 0.07, z);
    this.scene.add(eave);
  }

  // Simple rectangular windows inset into faces
  _addWindows(x, z, w, d, h, idx) {
    const glassMat = new THREE.MeshStandardMaterial({ color: '#8898a8', roughness: 0.08, metalness: 0.45 });
    const floors   = Math.max(1, Math.round(h / 2.8));
    const cols     = 1 + (idx % 2);

    for (let fl = 0; fl < floors; fl++) {
      const wy = 1.1 + fl * 2.6;
      if (wy + 0.6 > h) continue;
      for (let c = 0; c < cols; c++) {
        const ox = (c - (cols - 1) / 2) * 2.0;
        // north face
        const wN = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), glassMat);
        wN.position.set(x + ox, wy, z + d / 2 + 0.01);
        this.scene.add(wN);
        // south face
        const wS = wN.clone();
        wS.position.set(x + ox, wy, z - d / 2 - 0.01);
        wS.rotation.y = Math.PI;
        this.scene.add(wS);
      }
    }
  }

  // ── Utility poles + wires ─────────────────────────────────────────────────
  _buildUtilityPoles() {
    const PH   = 7.8;
    const rowZ = [4.9, -4.9, 22.5, -22.5];
    const posX = [-26, -15, -4, 4, 15, 26];

    rowZ.forEach(rz => {
      posX.forEach(px => this._pole(px, rz, PH));
      // Wires between adjacent poles in same row
      for (let i = 0; i < posX.length - 1; i++) {
        const x0 = posX[i], x1 = posX[i + 1];
        const mx = (x0 + x1) / 2;
        [PH - 0.5, PH - 1.0, PH - 1.6].forEach(wh => {
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(x0, wh, rz),
            new THREE.Vector3(mx,  wh - 0.42, rz),
            new THREE.Vector3(x1, wh, rz)
          );
          const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(14));
          this.scene.add(new THREE.Line(geo, MAT.wire));
        });
      }
    });

    // Cross wires connecting opposite sidewalk rows (main road crossing)
    [-26, -15, -4, 4, 15, 26].forEach(px => {
      const z0 = 4.9, z1 = -4.9, mz = 0;
      [PH - 0.5, PH - 1.2].forEach(wh => {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(px, wh, z0),
          new THREE.Vector3(px, wh - 0.5, mz),
          new THREE.Vector3(px, wh, z1)
        );
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(12));
        this.scene.add(new THREE.Line(geo, MAT.wire));
      });
    });
  }

  _pole(x, z, h) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, h, 6), MAT.pole);
    shaft.position.set(x, h / 2, z);
    shaft.castShadow = true;
    this.scene.add(shaft);

    // Two cross-arms at different heights
    [[h - 0.55, 1.7], [h - 1.55, 1.1]].forEach(([ay, aw]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), MAT.pole);
      arm.position.set(x, ay, z);
      this.scene.add(arm);
    });
  }

  // ── Decorative props ──────────────────────────────────────────────────────
  _buildProps() {
    // Low concrete garden walls (not in bbox — short enough KAI steps over)
    [
      { x: -3,  z: -14, w: 4.5, d: 0.22, h: 0.9 },
      { x:  3,  z:  14, w: 4.5, d: 0.22, h: 0.9 },
      { x: -14, z:  3,  w: 0.22, d: 4.5, h: 1.1 },
      { x:  14, z: -3,  w: 0.22, d: 4.5, h: 1.1 },
      { x: -22, z:  7,  w: 4.0, d: 0.22, h: 0.85 },
      { x:  22, z: -7,  w: 4.0, d: 0.22, h: 0.85 },
    ].forEach(({ x, z, w, d, h }) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.lowWall);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      this.scene.add(m);
    });

    // Trees — dark silhouettes typical of manga street scenes
    [
      [ 8,  8], [-8, -8], [ 8, -8], [-8,  8],
      [20,  6], [-20, -6], [6,  20], [-6, -20],
      [24, -18], [-24, 18],
    ].forEach(([tx, tz]) => this._tree(tx, tz));

    // Vending machines (boxes with accent colour — small detail near buildings)
    [
      { x: -10, z: -14, c: '#c8c4c0' },
      { x:  10, z:  14, c: '#b8b4b0' },
      { x: -14, z:  10, c: '#c0bcb8' },
    ].forEach(({ x, z, c }) => {
      const vm = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.8, 0.4),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })
      );
      vm.position.set(x, 0.9, z);
      vm.castShadow = true;
      this.scene.add(vm);
    });
  }

  _tree(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 2.6, 6), MAT.trunk);
    trunk.position.set(x, 1.3, z);
    trunk.castShadow = true;
    this.scene.add(trunk);

    // Layered canopy — two overlapping spheres for organic silhouette
    [[0, 3.8, 1.8], [0.3, 4.4, 1.3]].forEach(([ox, oy, r]) => {
      const c = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), MAT.foliage);
      c.position.set(x + ox, oy, z);
      c.castShadow = true;
      this.scene.add(c);
    });
  }

  // ── Collision ─────────────────────────────────────────────────────────────
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

  // ── Wall slots ────────────────────────────────────────────────────────────
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

  // ── Steering ──────────────────────────────────────────────────────────────
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
