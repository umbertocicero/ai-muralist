import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';
import { toonMat, addInk, inkedMesh } from './toon.js';

// Flat materials for ground/roads — receive shadows as hard cel bands.
const GROUND = {
  base:     toonMat('#eae8e4'),
  road:     toonMat('#dad8d4'),
  road2:    toonMat('#d2d0cc'),
  sidewalk: toonMat('#f1efeb'),
};
const DASH = new THREE.MeshBasicMaterial({ color: '#3a3a3a' });

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
    const flat = (w, d, mat, x = 0, y = 0.01, z = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };

    flat(200, 200, GROUND.base, 0, 0, 0);
    flat(7,   200, GROUND.road);
    flat(200, 7,   GROUND.road);
    [-21, 21].forEach(c => {
      flat(5, 200, GROUND.road2, c, 0.011, 0);
      flat(200, 5, GROUND.road2, 0, 0.011, c);
    });
    [-4.2, 4.2].forEach(o => {
      flat(1.4, 200, GROUND.sidewalk, o, 0.05, 0);
      flat(200, 1.4, GROUND.sidewalk, 0, 0.05, o);
    });
    // Centre-line road dashes (flat ink marks)
    for (let v = -88; v < 90; v += 8) {
      const d1 = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 3.2), DASH);
      d1.rotation.x = -Math.PI / 2; d1.position.set(v, 0.02, 0); this.scene.add(d1);
      const d2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.25), DASH);
      d2.rotation.x = -Math.PI / 2; d2.position.set(0, 0.02, v); this.scene.add(d2);
    }
  }

  // ── Buildings ─────────────────────────────────────────────────────────────
  _buildBuildings() {
    CONFIG.buildingPositions.forEach(([x, z], idx) => {
      const w = 6 + (idx % 4);
      const d = 5 + ((idx + 1) % 4);
      const h = 2.8 + (idx % 4) * 1.3;
      const color = CONFIG.buildingColors[idx % CONFIG.buildingColors.length];

      const mesh = inkedMesh(new THREE.BoxGeometry(w, h, d), color, { k: 1.022, receive: true });
      mesh.position.set(x, h / 2, z);
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

  // Japanese hip roof — dark pyramid + eave band, with ink outline
  _hipRoof(x, z, w, d, h) {
    const oh  = 0.4;
    const rH  = 0.9 + Math.min(w, d) * 0.13;
    const dia = Math.hypot(w + oh * 2, d + oh * 2) * 0.5;

    const cone = inkedMesh(new THREE.ConeGeometry(dia, rH, 4), '#26241f', { k: 1.03 });
    cone.position.set(x, h + rH / 2, z);
    cone.rotation.y = Math.PI / 4;
    this.scene.add(cone);

    const eave = inkedMesh(new THREE.BoxGeometry(w + oh * 2, 0.16, d + oh * 2), '#1a1814', { k: 1.04 });
    eave.position.set(x, h + 0.08, z);
    this.scene.add(eave);
  }

  // Dark manga windows, flat (no outline — kept as small detail)
  _addWindows(x, z, w, d, h, idx) {
    const glass  = new THREE.MeshBasicMaterial({ color: '#2c2c2c' });
    const floors = Math.max(1, Math.round(h / 2.8));
    const cols   = 1 + (idx % 2);

    for (let fl = 0; fl < floors; fl++) {
      const wy = 1.1 + fl * 2.6;
      if (wy + 0.6 > h) continue;
      for (let c = 0; c < cols; c++) {
        const ox = (c - (cols - 1) / 2) * 2.0;
        const wN = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), glass);
        wN.position.set(x + ox, wy, z + d / 2 + 0.02);
        this.scene.add(wN);
        const wS = wN.clone();
        wS.position.set(x + ox, wy, z - d / 2 - 0.02);
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
    const wireMat = new THREE.LineBasicMaterial({ color: '#161412' });

    rowZ.forEach(rz => {
      posX.forEach(px => this._pole(px, rz, PH));
      for (let i = 0; i < posX.length - 1; i++) {
        const x0 = posX[i], x1 = posX[i + 1], mx = (x0 + x1) / 2;
        [PH - 0.5, PH - 1.0, PH - 1.6].forEach(wh => {
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(x0, wh, rz),
            new THREE.Vector3(mx, wh - 0.42, rz),
            new THREE.Vector3(x1, wh, rz)
          );
          const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(14));
          this.scene.add(new THREE.Line(geo, wireMat));
        });
      }
    });

    [-26, -15, -4, 4, 15, 26].forEach(px => {
      const z0 = 4.9, z1 = -4.9, mz = 0;
      [PH - 0.5, PH - 1.2].forEach(wh => {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(px, wh, z0),
          new THREE.Vector3(px, wh - 0.5, mz),
          new THREE.Vector3(px, wh, z1)
        );
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(12));
        this.scene.add(new THREE.Line(geo, wireMat));
      });
    });
  }

  _pole(x, z, h) {
    const shaft = inkedMesh(new THREE.CylinderGeometry(0.07, 0.10, h, 6), '#2a2620', { k: 1.06 });
    shaft.position.set(x, h / 2, z);
    this.scene.add(shaft);
    [[h - 0.55, 1.7], [h - 1.55, 1.1]].forEach(([ay, aw]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), toonMat('#2a2620'));
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
      const m = inkedMesh(new THREE.BoxGeometry(w, h, d), '#dedcd8', { k: 1.03 });
      m.position.set(x, h / 2, z);
      this.scene.add(m);
    });

    // Trees — dark silhouettes typical of manga street scenes
    [
      [ 8,  8], [-8, -8], [ 8, -8], [-8,  8],
      [20,  6], [-20, -6], [6,  20], [-6, -20],
      [24, -18], [-24, 18],
    ].forEach(([tx, tz]) => this._tree(tx, tz));

    // Vending machines — flat light boxes
    [
      [-10, -14], [10, 14], [-14, 10],
    ].forEach(([x, z]) => {
      const vm = inkedMesh(new THREE.BoxGeometry(0.7, 1.8, 0.4), '#e6e4e0', { k: 1.04 });
      vm.position.set(x, 0.9, z);
      this.scene.add(vm);
    });
  }

  _tree(x, z) {
    const trunk = inkedMesh(new THREE.CylinderGeometry(0.10, 0.14, 2.6, 6), '#231d18', { k: 1.05 });
    trunk.position.set(x, 1.3, z);
    this.scene.add(trunk);
    [[0, 3.8, 1.8], [0.3, 4.4, 1.3]].forEach(([ox, oy, r]) => {
      const c = inkedMesh(new THREE.SphereGeometry(r, 7, 5), '#2e2c28', { k: 1.035 });
      c.position.set(x + ox, oy, z);
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
