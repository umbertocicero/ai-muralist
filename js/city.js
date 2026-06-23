import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';
import { toonMat, addInk, inkedMesh } from './toon.js';

// ===========================================================================
//  A grid neighbourhood of narrow Japanese lanes.
//
//  Low apartment blocks laid out on a grid; the gaps between them are the
//  streets and cross-streets (traverse) you walk and drive the camera down —
//  a one-point-perspective corridor in every direction, with the same manga
//  dressing as the alley: overhead power-line net, gutters, balconies, AC
//  units, drainpipes, potted plants, bicycles, vending machines.
//
//  The wall-slot contract is unchanged (px/py/pz, nx/nz, wallW/wallH,
//  buildingIdx, used, mesh) so the agent + mural factory keep working.
// ===========================================================================

const N      = CONFIG.grid.n;
const S      = CONFIG.grid.spacing;
const HALF   = (N - 1) / 2;
const BOUND  = HALF * S + S / 2 + 1.5;   // world edge for wander/collision

const ASPHALT = toonMat('#d4d2ce');
const CURB    = toonMat('#e6e4e0');
const GUTTER  = new THREE.MeshBasicMaterial({ color: '#9d9b97' });
const GLASS   = new THREE.MeshBasicMaterial({ color: '#2b2b2b' });
const SHUTTER = new THREE.MeshBasicMaterial({ color: '#9a9894' });
const WIRE    = new THREE.LineBasicMaterial({ color: '#141210' });
const WIN_GEO = new THREE.PlaneGeometry(1.0, 1.2);
const SHU_GEO = new THREE.PlaneGeometry(1.5, 1.9);

export class City {
  constructor(scene) {
    this.scene     = scene;
    this.bboxes    = [];
    this.wallSlots = [];
    this.poles     = [];
    this._buildGround();
    this._buildBlocks();
    this._buildPolesAndWires();
    this._buildClutter();
  }

  // ── Ground: one big asphalt sheet; lanes are the gaps between blocks ───────
  _buildGround() {
    const span = BOUND * 2 + 24;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(span, span), ASPHALT);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    this.scene.add(road);

    // manhole covers at the lane intersections
    this._laneCoords().forEach(lx =>
      this._laneCoords().forEach(lz => { if ((lx + lz) % 2 === 0) this._manhole(lx, lz); }));
  }

  // lane centre-lines (between blocks): n-1 interior + 2 outer
  _laneCoords() {
    const c = [];
    for (let i = 0; i <= N; i++) c.push((i - HALF - 0.5) * S);
    return c;
  }

  // ── The grid of apartment blocks ──────────────────────────────────────────
  _buildBlocks() {
    let idx = 0;
    for (let ix = 0; ix < N; ix++) {
      for (let iz = 0; iz < N; iz++) {
        const cx = (ix - HALF) * S;
        const cz = (iz - HALF) * S;
        const seed = ix * 3 + iz * 7;
        const W = 9.6 + (seed % 3) * 0.4;
        const D = 9.6 + ((seed + 1) % 3) * 0.4;
        const H = 4.5 + (seed % 3) * 1.4 + ((ix + iz) % 4 === 0 ? 2.2 : 0); // lower, a few accents

        this._block(cx, cz, W, D, H, seed, idx);

        // four lane-facing ground-floor wall slots
        const py = 1.55, wh = 2.7;
        this.wallSlots.push({ px: cx, py, pz: cz + D / 2, nx: 0, nz:  1, wallW: Math.min(W * 0.7, 4.4), wallH: wh, buildingIdx: idx, used: false, mesh: null });
        this.wallSlots.push({ px: cx, py, pz: cz - D / 2, nx: 0, nz: -1, wallW: Math.min(W * 0.7, 4.4), wallH: wh, buildingIdx: idx, used: false, mesh: null });
        this.wallSlots.push({ px: cx + W / 2, py, pz: cz, nx:  1, nz: 0, wallW: Math.min(D * 0.7, 4.4), wallH: wh, buildingIdx: idx, used: false, mesh: null });
        this.wallSlots.push({ px: cx - W / 2, py, pz: cz, nx: -1, nz: 0, wallW: Math.min(D * 0.7, 4.4), wallH: wh, buildingIdx: idx, used: false, mesh: null });

        const r = CONFIG.charRadius;
        this.bboxes.push({ minX: cx - W / 2 - r, maxX: cx + W / 2 + r, minZ: cz - D / 2 - r, maxZ: cz + D / 2 + r, top: H });
        idx++;
      }
    }
  }

  _block(cx, cz, W, D, H, seed, idx) {
    const tone = CONFIG.buildingColors[idx % CONFIG.buildingColors.length];
    const body = inkedMesh(new THREE.BoxGeometry(W, H, D), tone, { k: 1.014, receive: true });
    body.position.set(cx, H / 2, cz);
    this.scene.add(body);

    // curb ring delineating the block footprint
    const curb = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.12, D + 0.5), CURB);
    curb.position.set(cx, 0.06, cz);
    curb.receiveShadow = true;
    this.scene.add(curb);

    // roof: flat parapet, or a tiled hip roof on some houses
    if (seed % 4 === 3) {
      this._hipRoof(cx, cz, W, D, H);
    } else {
      const cap = inkedMesh(new THREE.BoxGeometry(W + 0.3, 0.36, D + 0.3), '#cdcbc7', { k: 1.02 });
      cap.position.set(cx, H + 0.18, cz);
      this.scene.add(cap);
      if (seed % 2 === 0) this._antenna(cx + W * 0.25, H, cz - D * 0.25);
    }

    // facade detail on all four lane-facing walls
    this._wallDetail(cx, cz, H, 0,  1, D / 2, W, seed);
    this._wallDetail(cx, cz, H, 0, -1, D / 2, W, seed + 1);
    this._wallDetail(cx, cz, H, 1,  0, W / 2, D, seed + 2);
    this._wallDetail(cx, cz, H, -1, 0, W / 2, D, seed + 3);
  }

  // Windows · shutters · balconies · AC units · drainpipe on one wall.
  _wallDetail(cx, cz, H, nx, nz, faceHalf, wallLen, seed) {
    const fx = cx + nx * faceHalf, fz = cz + nz * faceHalf;
    const tx = -nz, tz = nx;                          // tangent along the wall
    const rotY = nz === 1 ? 0 : nz === -1 ? Math.PI : nx === 1 ? Math.PI / 2 : -Math.PI / 2;
    const floors = Math.min(3, Math.max(1, Math.round(H / 2.4)));
    const cols   = Math.min(3, Math.max(1, Math.round(wallLen / 2.8)));

    for (let f = 0; f < floors; f++) {
      const wy = 1.4 + f * 2.2;
      if (wy + 0.6 > H) continue;
      for (let c = 0; c < cols; c++) {
        const tc = (c - (cols - 1) / 2) * 2.4;
        const px = fx + nx * 0.04 + tx * tc;
        const pz = fz + nz * 0.04 + tz * tc;

        if (f === 0 && (c + seed) % 3 === 0) {
          const sh = new THREE.Mesh(SHU_GEO, SHUTTER);
          sh.position.set(px, 1.05, pz); sh.rotation.y = rotY;
          this.scene.add(sh);
          continue;
        }
        const win = new THREE.Mesh(WIN_GEO, GLASS);
        win.position.set(px, wy, pz); win.rotation.y = rotY;
        this.scene.add(win);

        if (f >= 1 && (c + f + seed) % 2 === 0) {
          const slab = inkedMesh(new THREE.BoxGeometry(0.5, 0.08, 1.5), '#d8d6d2', { k: 1.05, cast: false });
          slab.position.set(fx + nx * 0.26 + tx * tc, wy - 0.6, fz + nz * 0.26 + tz * tc);
          slab.rotation.y = rotY;
          this.scene.add(slab);
          const rail = inkedMesh(new THREE.BoxGeometry(0.46, 0.42, 0.05), '#3a3834', { k: 1.06, cast: false });
          rail.position.set(fx + nx * 0.48 + tx * tc, wy - 0.38, fz + nz * 0.48 + tz * tc);
          rail.rotation.y = rotY;
          this.scene.add(rail);
        } else if (f >= 1 && (c + seed) % 3 === 1) {
          const ac = inkedMesh(new THREE.BoxGeometry(0.42, 0.38, 0.55), '#dcdad6', { k: 1.06, cast: false });
          ac.position.set(fx + nx * 0.22 + tx * (tc + 0.7), wy - 0.5, fz + nz * 0.22 + tz * (tc + 0.7));
          ac.rotation.y = rotY;
          this.scene.add(ac);
        }
      }
    }

    // drainpipe down one edge of the wall
    const e = wallLen / 2 - 0.3;
    const pipe = inkedMesh(new THREE.CylinderGeometry(0.06, 0.06, H, 6), '#bcbab6', { k: 1.08, cast: false });
    pipe.position.set(fx + nx * 0.08 + tx * e, H / 2, fz + nz * 0.08 + tz * e);
    this.scene.add(pipe);
  }

  // ── Poles + overhead wire net along the lanes ─────────────────────────────
  _buildPolesAndWires() {
    const lanes = this._laneCoords();
    // place poles at a subset of intersections (every other one) for the net
    const poleH = 8.6;
    for (let i = 0; i < lanes.length; i++) {
      for (let j = 0; j < lanes.length; j++) {
        if ((i + j) % 2 !== 0) continue;
        const x = lanes[i], z = lanes[j];
        if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) continue;
        this._pole(x, z, poleH, (i + j) % 4 === 0);
        this.poles.push({ x, z, i, j, top: poleH });
      }
    }
    // link neighbouring poles (same lane row/col) with sagging wires
    for (const a of this.poles) {
      for (const b of this.poles) {
        if (a === b) continue;
        const sameRow = a.j === b.j && b.i === a.i + 2;
        const sameCol = a.i === b.i && b.j === a.j + 2;
        if (sameRow || sameCol) {
          [8.1, 7.5].forEach(h => this._wire(a.x, h, a.z, b.x, h, b.z, 0.55));
        }
      }
    }
    // a convex traffic mirror at a corner
    this._convexMirror(lanes[1] + 0.4, 3.0, lanes[1]);
  }

  _pole(x, z, h, transformer = false) {
    const shaft = inkedMesh(new THREE.CylinderGeometry(0.08, 0.11, h, 6), '#2a2620', { k: 1.05 });
    shaft.position.set(x, h / 2, z);
    this.scene.add(shaft);
    [[h - 0.6, 1.9], [h - 1.5, 1.3]].forEach(([ay, aw]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), toonMat('#2a2620'));
      arm.position.set(x, ay, z);
      this.scene.add(arm);
      const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, aw), toonMat('#2a2620'));
      arm2.position.set(x, ay - 0.18, z);
      this.scene.add(arm2);
    });
    if (transformer) {
      const tf = inkedMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8), '#34302a', { k: 1.06, cast: false });
      tf.position.set(x + 0.26, h - 2.4, z);
      this.scene.add(tf);
    }
  }

  _wire(x0, y0, z0, x1, y1, z1, sag) {
    const mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2 - sag, (z0 + z1) / 2);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(x0, y0, z0), mid, new THREE.Vector3(x1, y1, z1));
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(14));
    this.scene.add(new THREE.Line(geo, WIRE));
  }

  _convexMirror(x, y, z) {
    const arm = inkedMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5), '#2a2620', { k: 1.1, cast: false });
    arm.position.set(x + 0.45, y, z); arm.rotation.z = Math.PI / 2;
    this.scene.add(arm);
    const rim = inkedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18), '#c0532a', { k: 1.04, cast: false });
    rim.position.set(x + 0.95, y, z); rim.rotation.z = Math.PI / 2; rim.rotation.x = Math.PI / 2;
    this.scene.add(rim);
  }

  // ── Lane clutter ──────────────────────────────────────────────────────────
  _buildClutter() {
    let k = 0;
    for (let ix = 0; ix < N; ix++) {
      for (let iz = 0; iz < N; iz++) {
        const cx = (ix - HALF) * S, cz = (iz - HALF) * S;
        const seed = ix * 3 + iz * 7;
        const W = 9.6 + (seed % 3) * 0.4, D = 9.6 + ((seed + 1) % 3) * 0.4;
        // a couple of plants at the lane-facing base, varied per block
        this._pottedPlant(cx + W / 2 + 0.7, cz + D / 2 - 1.5, 0.8 + (seed % 3) * 0.15);
        this._pottedPlant(cx - W / 2 - 0.7, cz - D / 2 + 1.5, 0.75 + (seed % 2) * 0.2);
        if (seed % 3 === 0) this._bicycle(cx + W / 2 + 0.8, cz - D / 2 + 2.0, Math.PI / 2);
        if (seed % 4 === 1) {
          const vm = inkedMesh(new THREE.BoxGeometry(0.5, 1.9, 0.7), '#e6e4e0', { k: 1.04 });
          vm.position.set(cx - W / 2 - 0.9, 0.95, cz + D / 2 - 2.2);
          this.scene.add(vm);
        }
        if (seed % 5 === 2) this._crateStack(cx + W / 2 + 0.9, cz + 0.5);
        if (seed % 6 === 3) this._tree(cx - W / 2 - 1.4, cz + D / 2 + 1.4);
        if (seed % 7 === 0) this._lantern(cx + W / 2 + 0.5, cz + D / 2 + 0.5);
        k++;
      }
    }
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

  _tree(x, z) {
    const trunk = inkedMesh(new THREE.CylinderGeometry(0.10, 0.14, 2.6, 6), '#231d18', { k: 1.05 });
    trunk.position.set(x, 1.3, z);
    this.scene.add(trunk);
    [[0, 3.6, 1.5], [0.3, 4.2, 1.1]].forEach(([ox, oy, r]) => {
      const c = inkedMesh(new THREE.SphereGeometry(r, 7, 5), '#2e2c28', { k: 1.035 });
      c.position.set(x + ox, oy, z);
      this.scene.add(c);
    });
  }

  _bicycle(x, z, angle) {
    const g = new THREE.Group();
    const tone = '#1f1d1a';
    const wheel = (wx) => { const w = inkedMesh(new THREE.TorusGeometry(0.30, 0.045, 6, 16), tone, { k: 1.08 }); w.position.set(wx, 0.30, 0); g.add(w); };
    wheel(-0.46); wheel(0.46);
    const bar = (len, px, py, rotZ) => { const b = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), tone, { k: 1.1, cast: false }); b.position.set(px, py, 0); b.rotation.z = rotZ; g.add(b); };
    bar(0.95, 0, 0.50, Math.PI / 2); bar(0.62, -0.16, 0.42, 0.5); bar(0.58, 0.40, 0.42, -0.4);
    const seat = inkedMesh(new THREE.BoxGeometry(0.22, 0.06, 0.10), tone, { k: 1.1, cast: false }); seat.position.set(-0.34, 0.70, 0); g.add(seat);
    const handle = inkedMesh(new THREE.BoxGeometry(0.08, 0.28, 0.30), tone, { k: 1.1, cast: false }); handle.position.set(0.50, 0.68, 0); g.add(handle);
    g.position.set(x, 0, z); g.rotation.y = angle; g.rotation.z = 0.05;
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
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshBasicMaterial({ color: '#5f5d59' }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.03, z); this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.40, 18), new THREE.MeshBasicMaterial({ color: '#3a3835' }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.031, z); this.scene.add(ring);
  }

  _lantern(x, z) {
    const body = inkedMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.32, 10), '#ededed', { k: 1.06, cast: false });
    body.position.set(x, 2.3, z); this.scene.add(body);
    const cap = inkedMesh(new THREE.CylinderGeometry(0.06, 0.16, 0.06, 10), '#1a1814', { k: 1.06, cast: false });
    cap.position.set(x, 2.49, z); this.scene.add(cap);
  }

  _antenna(x, baseY, z) {
    const mast = inkedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), '#1c1a17', { k: 1.12, cast: false });
    mast.position.set(x, baseY + 0.65, z); this.scene.add(mast);
    [0.95, 1.2].forEach((cy, i) => {
      const cw = 0.55 - i * 0.16;
      const bar = inkedMesh(new THREE.BoxGeometry(cw, 0.03, 0.03), '#1c1a17', { k: 1.15, cast: false });
      bar.position.set(x, baseY + cy, z); this.scene.add(bar);
    });
  }

  _hipRoof(x, z, w, d, h) {
    const oh = 0.4, rH = 0.9 + Math.min(w, d) * 0.13, dia = Math.hypot(w + oh * 2, d + oh * 2) * 0.5;
    const cone = inkedMesh(new THREE.ConeGeometry(dia, rH, 4), '#26241f', { k: 1.03 });
    cone.position.set(x, h + rH / 2, z); cone.rotation.y = Math.PI / 4; this.scene.add(cone);
    const eave = inkedMesh(new THREE.BoxGeometry(w + oh * 2, 0.16, d + oh * 2), '#1a1814', { k: 1.04 });
    eave.position.set(x, h + 0.08, z); this.scene.add(eave);
  }

  // ── Collision / navigation ────────────────────────────────────────────────
  isColliding(x, z) {
    if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) return true;
    return this.hitsBuilding(x, z);
  }

  // building footprints only (no world-edge clamp); returns the block's roof
  // height at (x,z), or 0 if none — used for 3D camera collision.
  hitsBuilding(x, z) {
    for (const b of this.bboxes) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return b.top;
    }
    return 0;
  }

  randomReachablePoint() {
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 2 * (BOUND - 1);
      const z = (Math.random() - 0.5) * 2 * (BOUND - 1);
      if (!this.isColliding(x, z)) return { x, z };
    }
    return { x: CONFIG.charStart.x, z: CONFIG.charStart.z };
  }

  approachPoint(slot) {
    return { x: slot.px + slot.nx * CONFIG.approachOffset, z: slot.pz + slot.nz * CONFIG.approachOffset };
  }

  isApproachFree(slot) {
    const p = this.approachPoint(slot);
    return !this.isColliding(p.x, p.z);
  }

  pickFreeSlot() {
    const free = this.wallSlots.filter(s => !s.used && this.isApproachFree(s));
    return free.length ? free[(Math.random() * free.length) | 0] : null;
  }

  allWallsUsed() { return this.wallSlots.every(s => s.used); }

  steer(pos, target, dist) {
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / len, z: dz / len };
    for (let attempt = 0; attempt < 12; attempt++) {
      const sign = attempt % 2 === 0 ? 1 : -1;
      const steps = (attempt / 2) | 0;
      const rot = rotateY2D(dir, sign * steps * (Math.PI / 12));
      const nx = pos.x + rot.x * dist, nz = pos.z + rot.z * dist;
      if (!this.isColliding(nx, nz)) { pos.x = nx; pos.z = nz; return rot; }
    }
    return null;
  }
}
