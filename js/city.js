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
    this._buildDetails();
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
      // Drainpipe down a back corner (sits in the wall margin, clear of murals)
      this._drainpipe(x - w/2 + 0.14, z - d/2 + 0.14, h);
      // Rooftop TV antenna on some buildings
      if (idx % 2 === 0) this._antenna(x + w * 0.24, h, z - d * 0.24);

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
      posX.forEach((px, i) => this._pole(px, rz, PH, Math.abs(rz) < 6 && i % 2 === 0));
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

  _pole(x, z, h, transformer = false) {
    const shaft = inkedMesh(new THREE.CylinderGeometry(0.07, 0.10, h, 6), '#2a2620', { k: 1.06 });
    shaft.position.set(x, h / 2, z);
    this.scene.add(shaft);
    [[h - 0.55, 1.7], [h - 1.55, 1.1]].forEach(([ay, aw]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), toonMat('#2a2620'));
      arm.position.set(x, ay, z);
      this.scene.add(arm);
    });
    // Cylindrical transformer can — a constant of Japanese utility poles
    if (transformer) {
      const tf = inkedMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.55, 8), '#34302a', { k: 1.07, cast: false });
      tf.position.set(x + 0.22, h - 2.5, z);
      this.scene.add(tf);
    }
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

  // ── Alley clutter (bikes, plants, crates, manholes, lanterns…) ────────────
  _buildDetails() {
    // Potted plants line the alleys — the references are full of greenery
    const plantSpots = [
      [4.7, -8], [4.7, -2], [4.7, 6], [4.7, 16], [4.7, 28],
      [-4.7, -6], [-4.7, 4], [-4.7, 13], [-4.7, 24],
      [-8, 4.7], [2, 4.7], [14, 4.7], [26, 4.7],
      [-14, -4.7], [6, -4.7], [20, -4.7],
    ];
    plantSpots.forEach(([x, z], i) => this._pottedPlant(x, z, 0.82 + (i % 3) * 0.20));

    // Bicycles leaning here and there
    this._bicycle(6.3, -9, -0.35);
    this._bicycle(-6.3, 7, Math.PI * 0.9);
    this._bicycle(9, 5.3, Math.PI * 0.5);
    this._bicycle(-5.6, -17, 0.15);

    // Stacked crates against the walls
    this._crateStack(5.1, 20);
    this._crateStack(-5.3, -11);
    this._crateStack(13, -5.2);

    // Manhole covers on the roads
    [[0, -9], [0, 13], [8, 0], [-16, 0], [0, 27]].forEach(([x, z]) => this._manhole(x, z));

    // Paper lanterns hanging at shop corners
    [[8.4, 8.4], [-8.4, 8.4], [8.4, -8.4]].forEach(([x, z]) => this._lantern(x, z));
  }

  _pottedPlant(x, z, s = 1) {
    const pot = inkedMesh(new THREE.CylinderGeometry(0.16 * s, 0.20 * s, 0.34 * s, 8), '#dcdad6', { k: 1.05 });
    pot.position.set(x, 0.17 * s, z);
    this.scene.add(pot);
    const f1 = inkedMesh(new THREE.SphereGeometry(0.30 * s, 7, 6), '#2c2a26', { k: 1.04 });
    f1.position.set(x, 0.34 * s + 0.20 * s, z);
    this.scene.add(f1);
    const f2 = inkedMesh(new THREE.SphereGeometry(0.20 * s, 7, 6), '#363430', { k: 1.04 });
    f2.position.set(x + 0.13 * s, 0.34 * s + 0.40 * s, z - 0.05 * s);
    this.scene.add(f2);
  }

  _bicycle(x, z, angle) {
    const g = new THREE.Group();
    const tone = '#1f1d1a';
    const wheel = (wx) => {
      const w = inkedMesh(new THREE.TorusGeometry(0.30, 0.045, 6, 16), tone, { k: 1.08 });
      w.position.set(wx, 0.30, 0);
      g.add(w);
    };
    wheel(-0.46); wheel(0.46);
    const bar = (len, px, py, rotZ) => {
      const b = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), tone, { k: 1.1, cast: false });
      b.position.set(px, py, 0);
      b.rotation.z = rotZ;
      g.add(b);
    };
    bar(0.95, 0, 0.50, Math.PI / 2);   // top tube
    bar(0.62, -0.16, 0.42, 0.5);       // seat tube
    bar(0.58, 0.40, 0.42, -0.4);       // fork
    const seat = inkedMesh(new THREE.BoxGeometry(0.22, 0.06, 0.10), tone, { k: 1.1, cast: false });
    seat.position.set(-0.34, 0.70, 0);
    g.add(seat);
    const handle = inkedMesh(new THREE.BoxGeometry(0.08, 0.28, 0.30), tone, { k: 1.1, cast: false });
    handle.position.set(0.50, 0.68, 0);
    g.add(handle);
    g.position.set(x, 0, z);
    g.rotation.y = angle;
    g.rotation.z = 0.05;               // slight lean
    this.scene.add(g);
  }

  _crateStack(x, z) {
    const tones = ['#d2ccc0', '#c8c2b6', '#d8d2c6'];
    const n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const s = 0.5;
      const c = inkedMesh(new THREE.BoxGeometry(s, s, s), tones[i % 3], { k: 1.04 });
      c.position.set(x + (i % 2 ? 0.12 : -0.1), s / 2 + i * s, z + (i % 2 ? -0.08 : 0.06));
      c.rotation.y = (Math.random() - 0.5) * 0.3;
      this.scene.add(c);
    }
  }

  _manhole(x, z) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: '#5f5d59' })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.03, z);
    this.scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.30, 0.40, 20),
      new THREE.MeshBasicMaterial({ color: '#3a3835' })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.031, z);
    this.scene.add(ring);
  }

  _lantern(x, z) {
    const body = inkedMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.32, 10), '#ededed', { k: 1.06, cast: false });
    body.position.set(x, 2.3, z);
    this.scene.add(body);
    const cap = inkedMesh(new THREE.CylinderGeometry(0.06, 0.16, 0.06, 10), '#1a1814', { k: 1.06, cast: false });
    cap.position.set(x, 2.49, z);
    this.scene.add(cap);
    const pts = [new THREE.Vector3(x, 2.52, z), new THREE.Vector3(x, 3.1, z)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#161412' })));
  }

  _drainpipe(cx, cz, h) {
    const pipe = inkedMesh(new THREE.CylinderGeometry(0.07, 0.07, h, 6), '#bcbab6', { k: 1.08, cast: false });
    pipe.position.set(cx, h / 2, cz);
    this.scene.add(pipe);
  }

  _antenna(x, baseY, z) {
    const mast = inkedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), '#1c1a17', { k: 1.12, cast: false });
    mast.position.set(x, baseY + 0.65, z);
    this.scene.add(mast);
    [0.95, 1.2].forEach((cy, i) => {
      const cw = 0.55 - i * 0.16;
      const bar = inkedMesh(new THREE.BoxGeometry(cw, 0.03, 0.03), '#1c1a17', { k: 1.15, cast: false });
      bar.position.set(x, baseY + cy, z);
      this.scene.add(bar);
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
