import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';
import { toonMat, addInk, inkedMesh } from './toon.js';

// ===========================================================================
//  A narrow Japanese alley — one-point perspective corridor.
//
//  Modelled directly on the reference photos: a tight paved lane running
//  toward a blown-out bright end, hemmed in by tall concrete apartment blocks
//  packed wall-to-wall, a dense net of overhead power-lines, side gutters,
//  AC units, balconies, drainpipes, and rows of potted plants and bicycles
//  cluttering the base of every wall.
//
//  KAI walks the lane and paints the lower (ground-floor) walls. The slot
//  contract is unchanged (px/py/pz, nx/nz, wallW/wallH, buildingIdx, used,
//  mesh) so the agent + mural factory keep working untouched.
// ===========================================================================

const CW   = 3.2;     // corridor half-width (lane is ~6.4m wide — tight)
const FAR  = -60;     // far (bright) end of the alley
const NEAR = 30;      // near (open) end

const ASPHALT = toonMat('#d4d2ce');
const GUTTER  = new THREE.MeshBasicMaterial({ color: '#9d9b97' });
const CURB    = toonMat('#e6e4e0');
const GLASS   = new THREE.MeshBasicMaterial({ color: '#2b2b2b' });
const SHUTTER = new THREE.MeshBasicMaterial({ color: '#9a9894' });
const WIRE    = new THREE.LineBasicMaterial({ color: '#141210' });

export class City {
  constructor(scene) {
    this.scene     = scene;
    this.bboxes    = [];
    this.wallSlots = [];
    this.poles     = [];   // {x, z, top} for wiring
    this._buildLane();
    this._buildRows();
    this._buildEndWall();
    this._buildPolesAndWires();
    this._buildClutter();
  }

  // ── The lane: asphalt + side gutters + curbs ──────────────────────────────
  _buildLane() {
    const len = NEAR - FAR;
    const cz  = (NEAR + FAR) / 2;

    const road = new THREE.Mesh(new THREE.PlaneGeometry(CW * 2 + 1.4, len), ASPHALT);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, cz);
    road.receiveShadow = true;
    this.scene.add(road);

    // U-drain gutters running down each side of the lane
    [-1, 1].forEach(s => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(0.34, len), GUTTER);
      g.rotation.x = -Math.PI / 2;
      g.position.set(s * (CW - 0.25), 0.012, cz);
      this.scene.add(g);
      // thin curb strip against the wall
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, len), CURB);
      c.position.set(s * (CW - 0.02), 0.06, cz);
      c.receiveShadow = true;
      this.scene.add(c);
    });

    // a few manhole / drain plates down the centre
    for (let z = NEAR - 6; z > FAR + 6; z -= 11) this._manhole(0.0, z);
  }

  // ── The two facing rows of apartment blocks ───────────────────────────────
  _buildRows() {
    let idx = 0;
    [-1, 1].forEach(side => {
      // deterministic-ish jitter per side so the two walls differ
      let z = NEAR - 1;
      let n = 0;
      const seed = side > 0 ? 7 : 3;
      while (z > FAR + 7) {
        const depth = 6 + ((n * 2 + seed) % 4);          // z-extent
        const W     = 7 + ((n + seed) % 4);              // outward depth
        const H     = 6.5 + ((n * 3 + seed) % 4) * 2.0;  // height (2–4 floors)
        const zc    = z - depth / 2;
        const innerX = side * CW;          // wall facing the lane
        const cx     = side * (CW + W / 2);

        this._block(side, cx, innerX, zc, depth, W, H, n, idx);

        // ground-floor paintable wall slot (graffiti goes low, not full facade)
        this.wallSlots.push({
          px: innerX, py: 1.7, pz: zc,
          nx: -side, nz: 0,
          wallW: Math.min(depth * 0.78, 4.4), wallH: 2.9,
          buildingIdx: idx, used: false, mesh: null,
        });

        // collision: block everything outside the lane on this side
        const r = CONFIG.charRadius;
        this.bboxes.push({
          minX: Math.min(innerX, cx + side * W / 2) - r,
          maxX: Math.max(innerX, cx + side * W / 2) + r,
          minZ: zc - depth / 2 - r, maxZ: zc + depth / 2 + r,
        });

        z -= depth + (n % 3 === 0 ? 0.5 : 0.05);  // occasional setback gap
        n++; idx++;
      }
    });
  }

  // One apartment block + its lane-facing facade detail.
  _block(side, cx, innerX, zc, depth, W, H, n, idx) {
    const tone = CONFIG.buildingColors[idx % CONFIG.buildingColors.length];
    const body = inkedMesh(new THREE.BoxGeometry(W, H, depth), tone, { k: 1.012, receive: true });
    body.position.set(cx, H / 2, zc);
    this.scene.add(body);

    // Roof: flat parapet cap (concrete block) — or a tiled hip roof for a house
    if ((n + (side > 0 ? 1 : 0)) % 4 === 3) {
      this._hipRoof(cx, zc, W, depth, H);
    } else {
      const cap = inkedMesh(new THREE.BoxGeometry(W + 0.3, 0.4, depth + 0.3), '#cdcbc7', { k: 1.02 });
      cap.position.set(cx, H + 0.2, zc);
      this.scene.add(cap);
      // foliage spilling over the parapet on some roofs
      if (n % 2 === 0) {
        const f = inkedMesh(new THREE.SphereGeometry(0.6, 7, 5), '#2c2a26', { k: 1.04 });
        f.position.set(innerX - side * 0.3, H + 0.5, zc + depth * 0.2);
        this.scene.add(f);
      }
    }

    this._facade(side, innerX, zc, depth, H, n);
  }

  // Windows · balconies · AC units · drainpipe · meter · ground shutter, all
  // on the lane-facing wall. Rotations: left wall faces +x, right faces −x.
  _facade(side, innerX, zc, depth, H, n) {
    const faceX = innerX - side * 0.04;             // just in front of the wall
    const rotY  = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const floors = Math.max(2, Math.round(H / 2.6));
    const cols   = Math.max(1, Math.round(depth / 2.6));

    for (let f = 0; f < floors; f++) {
      const wy = 1.5 + f * 2.4;
      if (wy + 0.7 > H) continue;
      for (let c = 0; c < cols; c++) {
        const wz = zc + (c - (cols - 1) / 2) * 2.2;
        // ground floor of some bays is a closed metal shutter, not a window
        if (f === 0 && (c + n) % 3 === 0) {
          const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), SHUTTER);
          sh.position.set(faceX, 1.1, wz); sh.rotation.y = rotY;
          this.scene.add(sh);
          continue;
        }
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.2), GLASS);
        win.position.set(faceX, wy, wz); win.rotation.y = rotY;
        this.scene.add(win);

        // upper-floor balcony slab + railing on some bays
        if (f >= 1 && (c + f + n) % 2 === 0) {
          const slab = inkedMesh(new THREE.BoxGeometry(0.55, 0.08, 1.6), '#d8d6d2', { k: 1.05, cast: false });
          slab.position.set(innerX - side * 0.28, wy - 0.62, wz);
          this.scene.add(slab);
          const rail = inkedMesh(new THREE.BoxGeometry(0.5, 0.46, 0.05), '#3a3834', { k: 1.06, cast: false });
          rail.position.set(innerX - side * 0.52, wy - 0.38, wz);
          this.scene.add(rail);
        } else if (f >= 1 && (c + n) % 3 === 1) {
          // AC outdoor unit clinging to the wall (室外機)
          const ac = inkedMesh(new THREE.BoxGeometry(0.45, 0.4, 0.6), '#dcdad6', { k: 1.06, cast: false });
          ac.position.set(innerX - side * 0.24, wy - 0.5, wz + 0.7);
          this.scene.add(ac);
        }
      }
    }

    // drainpipe down a corner of the inner face
    const pipe = inkedMesh(new THREE.CylinderGeometry(0.07, 0.07, H, 6), '#bcbab6', { k: 1.08, cast: false });
    pipe.position.set(innerX - side * 0.1, H / 2, zc + depth / 2 - 0.3);
    this.scene.add(pipe);

    // electric meter box near the ground
    const meter = inkedMesh(new THREE.BoxGeometry(0.3, 0.4, 0.16), '#cfcdc9', { k: 1.07, cast: false });
    meter.position.set(innerX - side * 0.12, 1.4, zc - depth / 2 + 0.5);
    this.scene.add(meter);
  }

  // ── Building capping the far end (backlit silhouette against the glow) ─────
  _buildEndWall() {
    const W = CW * 2 + 14, H = 9, d = 6;
    const m = inkedMesh(new THREE.BoxGeometry(W, H, d), '#dad8d4', { k: 1.012, receive: true });
    m.position.set(0, H / 2, FAR - d / 2);
    this.scene.add(m);
    const cap = inkedMesh(new THREE.BoxGeometry(W + 0.3, 0.4, d + 0.3), '#c9c7c3', { k: 1.02 });
    cap.position.set(0, H + 0.2, FAR - d / 2);
    this.scene.add(cap);

    // it faces +z (down the lane) → a paintable end wall
    this.wallSlots.push({
      px: 0, py: 1.8, pz: FAR, nx: 0, nz: 1,
      wallW: 4.4, wallH: 3.0, buildingIdx: 999, used: false, mesh: null,
    });
    const r = CONFIG.charRadius;
    this.bboxes.push({ minX: -W / 2 - r, maxX: W / 2 + r, minZ: FAR - d - r, maxZ: FAR + r });

    // a couple of dark windows + foliage so it reads as a real building end
    for (let c = -1; c <= 1; c++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.3), GLASS);
      win.position.set(c * 2.2, 4.6, FAR + 0.04);
      this.scene.add(win);
    }
    this._tree(-CW - 3.5, FAR + 1.5);
  }

  // ── Utility poles + the dense overhead wire net ───────────────────────────
  _buildPolesAndWires() {
    // poles march down the lane edges, alternating sides
    let side = -1;
    for (let z = NEAR - 4; z > FAR + 4; z -= 9) {
      const x = side * (CW - 0.06);
      this._pole(x, z, 8.6, (z | 0) % 2 === 0);
      this.poles.push({ x, z, top: 8.6 });
      side *= -1;
    }
    // convex traffic mirror near the far bend
    this._convexMirror(CW - 0.1, 3.0, FAR + 12);

    // along-side catenary wires linking consecutive same-side poles
    const bySide = { '-1': [], '1': [] };
    this.poles.forEach(p => bySide[p.x < 0 ? -1 : 1].push(p));
    Object.values(bySide).forEach(list => {
      list.sort((a, b) => b.z - a.z);
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], b = list[i + 1];
        [8.1, 7.6, 7.1].forEach(h => this._wire(a.x, h, a.z, b.x, h, b.z, 0.5));
      }
    });

    // a thick net of cross-lane wires (this is what makes the photos read)
    for (let z = NEAR - 6; z > FAR + 6; z -= 3.2) {
      const h = 7.0 + Math.sin(z * 0.7) * 0.9;
      this._wire(-CW + 0.1, h, z, CW - 0.1, h + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 1.5, 0.7);
    }
    // a few long diagonal runs for depth
    for (let i = 0; i < 6; i++) {
      const z0 = NEAR - 6 - i * 8;
      this._wire(-CW + 0.1, 7.8, z0, CW - 0.1, 6.6, z0 - 7, 0.9);
    }
  }

  _pole(x, z, h, transformer = false) {
    const shaft = inkedMesh(new THREE.CylinderGeometry(0.08, 0.11, h, 6), '#2a2620', { k: 1.05 });
    shaft.position.set(x, h / 2, z);
    this.scene.add(shaft);
    const inward = x < 0 ? 1 : -1;
    [[h - 0.6, 1.9], [h - 1.5, 1.3]].forEach(([ay, aw]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), toonMat('#2a2620'));
      arm.position.set(x + inward * aw * 0.3, ay, z);
      this.scene.add(arm);
    });
    if (transformer) {
      const tf = inkedMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8), '#34302a', { k: 1.06, cast: false });
      tf.position.set(x + inward * 0.26, h - 2.4, z);
      this.scene.add(tf);
    }
  }

  // sagging wire (catenary-ish) between two points
  _wire(x0, y0, z0, x1, y1, z1, sag) {
    const mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2 - sag, (z0 + z1) / 2);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(x0, y0, z0), mid, new THREE.Vector3(x1, y1, z1));
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
    this.scene.add(new THREE.Line(geo, WIRE));
  }

  _convexMirror(x, y, z) {
    const inward = x < 0 ? 1 : -1;
    const arm = inkedMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5), '#2a2620', { k: 1.1, cast: false });
    arm.position.set(x + inward * 0.45, y, z); arm.rotation.z = Math.PI / 2;
    this.scene.add(arm);
    const rim = inkedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18), '#c0532a', { k: 1.04, cast: false });
    rim.position.set(x + inward * 0.95, y, z); rim.rotation.z = Math.PI / 2; rim.rotation.x = Math.PI / 2;
    this.scene.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.44, 18),
      new THREE.MeshBasicMaterial({ color: '#9a9894' }));
    face.position.set(x + inward * (0.95 - 0.07), y, z);
    face.rotation.y = inward > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.scene.add(face);
  }

  // ── Lane clutter: plants, bikes, crates, vending machines ─────────────────
  _buildClutter() {
    // potted plants line the base of both walls (the alleys are full of them)
    let i = 0;
    for (let z = NEAR - 3; z > FAR + 5; z -= 2.4) {
      const side = (i % 2 === 0) ? -1 : 1;
      this._pottedPlant(side * (CW - 0.45), z, 0.75 + (i % 3) * 0.22);
      if (i % 3 === 1) this._pottedPlant(-side * (CW - 0.4), z + 0.7, 0.7 + (i % 2) * 0.2);
      i++;
    }

    // bicycles leaning on the walls
    this._bicycle(-CW + 0.55, NEAR - 8,  Math.PI * 0.5 + 0.1);
    this._bicycle( CW - 0.55, NEAR - 20, -Math.PI * 0.5 - 0.1);
    this._bicycle(-CW + 0.55, NEAR - 33,  Math.PI * 0.5);
    this._bicycle( CW - 0.6,  NEAR - 46, -Math.PI * 0.5 + 0.15);

    // crate stacks tucked against walls
    this._crateStack(-CW + 0.6, NEAR - 14);
    this._crateStack( CW - 0.6, NEAR - 27);

    // vending machines glowing in the lane
    [[ CW - 0.55, NEAR - 4], [-CW + 0.55, NEAR - 40]].forEach(([x, z]) => {
      const vm = inkedMesh(new THREE.BoxGeometry(0.5, 1.9, 0.7), '#e6e4e0', { k: 1.04 });
      vm.position.set(x, 0.95, z);
      this.scene.add(vm);
    });

    // a paper lantern hanging at a shop corner near the entrance
    this._lantern(CW - 0.4, NEAR - 6);
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
    [[0, 3.8, 1.6], [0.3, 4.4, 1.2]].forEach(([ox, oy, r]) => {
      const c = inkedMesh(new THREE.SphereGeometry(r, 7, 5), '#2e2c28', { k: 1.035 });
      c.position.set(x + ox, oy, z);
      this.scene.add(c);
    });
  }

  _bicycle(x, z, angle) {
    const g = new THREE.Group();
    const tone = '#1f1d1a';
    const wheel = (wx) => {
      const w = inkedMesh(new THREE.TorusGeometry(0.30, 0.045, 6, 16), tone, { k: 1.08 });
      w.position.set(wx, 0.30, 0); g.add(w);
    };
    wheel(-0.46); wheel(0.46);
    const bar = (len, px, py, rotZ) => {
      const b = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), tone, { k: 1.1, cast: false });
      b.position.set(px, py, 0); b.rotation.z = rotZ; g.add(b);
    };
    bar(0.95, 0, 0.50, Math.PI / 2);
    bar(0.62, -0.16, 0.42, 0.5);
    bar(0.58, 0.40, 0.42, -0.4);
    const seat = inkedMesh(new THREE.BoxGeometry(0.22, 0.06, 0.10), tone, { k: 1.1, cast: false });
    seat.position.set(-0.34, 0.70, 0); g.add(seat);
    const handle = inkedMesh(new THREE.BoxGeometry(0.08, 0.28, 0.30), tone, { k: 1.1, cast: false });
    handle.position.set(0.50, 0.68, 0); g.add(handle);
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
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: '#5f5d59' }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.03, z);
    this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.40, 20),
      new THREE.MeshBasicMaterial({ color: '#3a3835' }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.031, z);
    this.scene.add(ring);
  }

  _lantern(x, z) {
    const body = inkedMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.32, 10), '#ededed', { k: 1.06, cast: false });
    body.position.set(x, 2.3, z); this.scene.add(body);
    const cap = inkedMesh(new THREE.CylinderGeometry(0.06, 0.16, 0.06, 10), '#1a1814', { k: 1.06, cast: false });
    cap.position.set(x, 2.49, z); this.scene.add(cap);
    const pts = [new THREE.Vector3(x, 2.52, z), new THREE.Vector3(x, 3.4, z)];
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), WIRE));
  }

  _hipRoof(x, z, w, d, h) {
    const oh  = 0.4;
    const rH  = 0.9 + Math.min(w, d) * 0.13;
    const dia = Math.hypot(w + oh * 2, d + oh * 2) * 0.5;
    const cone = inkedMesh(new THREE.ConeGeometry(dia, rH, 4), '#26241f', { k: 1.03 });
    cone.position.set(x, h + rH / 2, z); cone.rotation.y = Math.PI / 4;
    this.scene.add(cone);
    const eave = inkedMesh(new THREE.BoxGeometry(w + oh * 2, 0.16, d + oh * 2), '#1a1814', { k: 1.04 });
    eave.position.set(x, h + 0.08, z);
    this.scene.add(eave);
  }

  // ── Collision ─────────────────────────────────────────────────────────────
  isColliding(x, z) {
    if (x < -CW + CONFIG.charRadius || x > CW - CONFIG.charRadius) return true; // walls
    if (z > NEAR || z < FAR + 0.5) return true;                                 // ends
    for (const b of this.bboxes) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  randomReachablePoint() {
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() - 0.5) * (CW - 0.6) * 2;
      const z = FAR + 4 + Math.random() * (NEAR - FAR - 6);
      if (!this.isColliding(x, z)) return { x, z };
    }
    return { x: 0, z: NEAR - 6 };
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

  // ── Steering (with wall-sliding) ──────────────────────────────────────────
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
