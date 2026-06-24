import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';
import { toonMat, addInk, inkedMesh } from './toon.js';

// ===========================================================================
//  A procedurally generated Setagaya-style neighbourhood.
//
//  Not a grid: an organic mesh of crooked streets of varying width, like the
//  Soshigaya reference map. Built from a jittered, non-uniform set of plots —
//  every block is a different size and is rotated a little, so the gaps between
//  them form irregular, asymmetric lanes. A couple of wider winding "main
//  roads" are carved through, and some plots are left as open lots. Buildings
//  are oriented (rotated), so collision is oriented-box and wall murals rotate
//  to match each wall's true normal.
// ===========================================================================

// deterministic RNG so the town is stable between loads
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASPHALT  = toonMat('#d4d2ce');
const ASPHALT2 = toonMat('#cbc9c5');   // main-road ribbon (slightly darker)
const CURB     = toonMat('#e6e4e0');
// polygonOffset pushes windows/shutters in front of the wall in depth so they
// never z-fight it (the cause of the "striped" windows at a distance).
const GLASS    = new THREE.MeshBasicMaterial({ color: '#2b2b2b', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const SHUTTER  = new THREE.MeshBasicMaterial({ color: '#9a9894', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const WIRE     = new THREE.LineBasicMaterial({ color: '#141210' });
const ROOFLINE = new THREE.LineBasicMaterial({ color: '#2a2824' });   // tile / corrugation strokes
const WIN_GEO  = new THREE.PlaneGeometry(1.0, 1.2);

// Triangular-prism (gable) roof geometry, flat-shaded. Base width = 2*halfSpan
// across X, ridge of height `rh` along +Y, extruded `len` along Z.
function gableGeometry(halfSpan, rh, len) {
  const z0 = -len / 2, z1 = len / 2;
  const P = [
    [-halfSpan, 0, z0], [halfSpan, 0, z0], [0, rh, z0],
    [-halfSpan, 0, z1], [halfSpan, 0, z1], [0, rh, z1],
  ];
  const faces = [[0,1,2],[3,5,4],[0,2,5],[0,5,3],[1,4,5],[1,5,2],[0,3,4],[0,4,1]];
  const pos = [];
  for (const [a, b, c] of faces) pos.push(...P[a], ...P[b], ...P[c]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const SHU_GEO  = new THREE.PlaneGeometry(1.5, 1.9);
const LEAF     = ['#2c2a26', '#363430', '#23211d', '#3c3a34'];

export class City {
  constructor(scene) {
    this.scene     = scene;
    this.buildings = [];   // {cx,cz,hw,hd,rot,top}
    this.wallSlots = [];
    this.poles     = [];
    this.rng       = mulberry32(20260623);

    this.HALF = CONFIG.world.half;
    this.mainRoads = this._genMainRoads();

    this._buildGround();
    this._generate();
    this._buildPolesAndWires();

    // a couple of rooftop water towers as landmarks
    for (let k = 0; k < 2; k++) {
      const p = this._findOpen(this._rand(-30, 30), this._rand(-30, 30));
      this._waterTower(p.x, p.z);
    }

    this.spawn = this._findOpen(0, 0);
  }

  _rand(a, b) { return a + this.rng() * (b - a); }

  // local→world offset for a plot rotated by `rot` (Three Ry convention)
  _toWorld(cx, cz, rot, lx, lz) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
  }
  _dir(rot, lx, lz) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: lx * c + lz * s, z: -lx * s + lz * c };
  }

  // ── Winding main roads (polylines) ────────────────────────────────────────
  _genMainRoads() {
    const H = this.HALF, roads = [];
    const make = (vertical) => {
      const pts = [];
      const cross = this._rand(-H * 0.4, H * 0.4);
      let perp = cross;
      const steps = 7;
      for (let i = 0; i <= steps; i++) {
        const along = -H + (2 * H) * (i / steps);
        perp += this._rand(-7, 7);
        perp = Math.max(-H * 0.7, Math.min(H * 0.7, perp));
        pts.push(vertical ? { x: perp, z: along } : { x: along, z: perp });
      }
      return { pts, half: this._rand(3.0, 3.8) };
    };
    roads.push(make(true));
    roads.push(make(false));
    if (this.rng() > 0.4) roads.push(make(this.rng() > 0.5));
    return roads;
  }

  _distToMainRoad(x, z) {
    let best = Infinity;
    for (const r of this.mainRoads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const d = segDist(x, z, r.pts[i], r.pts[i + 1]) - r.half;
        if (d < best) best = d;
      }
    }
    return best;
  }

  // ── Ground + main-road ribbons ────────────────────────────────────────────
  _buildGround() {
    const span = this.HALF * 2 + 30;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(span, span), ASPHALT);
    road.rotation.x = -Math.PI / 2; road.receiveShadow = true;
    this.scene.add(road);

    // paint the winding main roads as slightly darker ribbons
    for (const r of this.mainRoads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        const rib = new THREE.Mesh(new THREE.PlaneGeometry(r.half * 2, len + r.half), ASPHALT2);
        rib.rotation.x = -Math.PI / 2;
        rib.rotation.z = -Math.atan2(dz, dx) + Math.PI / 2;
        rib.position.set((a.x + b.x) / 2, 0.01, (a.z + b.z) / 2);
        rib.receiveShadow = true;   // else it hides KAI's shadow cast on the ground below
        this.scene.add(rib);
      }
    }
  }

  // ── Generate plots → buildings + open lots ────────────────────────────────
  _generate() {
    const H = this.HALF;
    // non-uniform column / row boundaries → variable street widths
    const axis = () => {
      const cuts = [];
      let p = -H;
      while (p < H - 6) {
        const block = this._rand(7, 14);
        const gap   = this._rand(2.4, 6.0);   // street width varies a lot
        cuts.push({ a: p, b: p + block });
        p += block + gap;
      }
      return cuts;
    };
    const cols = axis(), rows = axis();
    let idx = 0;

    for (const cxr of cols) {
      for (const czr of rows) {
        const cx = (cxr.a + cxr.b) / 2 + this._rand(-0.6, 0.6);
        const cz = (czr.a + czr.b) / 2 + this._rand(-0.6, 0.6);
        // carve the main roads: leave those plots open
        if (this._distToMainRoad(cx, cz) < 1.5) continue;
        // ~15% of plots are left as open lots / pocket gardens
        const open = this.rng() < 0.15;
        const hw = Math.max(2.4, (cxr.b - cxr.a) / 2 - this._rand(0.4, 1.1));
        const hd = Math.max(2.4, (czr.b - czr.a) / 2 - this._rand(0.4, 1.1));
        const rot = this._rand(-0.22, 0.22);   // crooked

        if (open) { this._openLot(cx, cz, hw, hd, rot); continue; }

        const H2 = 4.5 + (this.rng() * 3 | 0) * 1.4 + (this.rng() < 0.18 ? 2.4 : 0); // low, a few accents
        this._block(cx, cz, hw, hd, rot, H2, idx);
        this.buildings.push({ cx, cz, hw, hd, rot, top: H2 });
        this._addSlots(cx, cz, hw, hd, rot, idx);
        idx++;
      }
    }
  }

  _openLot(cx, cz, hw, hd, rot) {
    // a wooden plank fence or low wall around the front, + greenery
    const r = this.rng();
    if (r < 0.45) {
      this._plankFence(cx, cz, rot, hw, hd);          // 板塀 — board fence
    } else if (r < 0.7) {
      const wall = inkedMesh(new THREE.BoxGeometry(hw * 2, 0.8, 0.14), '#dedcd8', { k: 1.03 });
      const f = this._toWorld(cx, cz, rot, 0, hd);
      wall.position.set(f.x, 0.4, f.z); wall.rotation.y = rot;
      this.scene.add(wall);
    }
    const n = 2 + (this.rng() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const p = this._toWorld(cx, cz, rot, this._rand(-hw, hw), this._rand(-hd, hd));
      if (this.rng() < 0.5) this._bush(p.x, p.z, 0.7 + this.rng() * 0.4);
      else this._bigTree(p.x, p.z);
    }
  }

  // ── A building (oriented box) + roof + facades ────────────────────────────
  _block(cx, cz, hw, hd, rot, H, idx) {
    const wood = this.rng() < 0.22;     // some are wood-sided houses (板張り)
    const tone = wood ? '#d8d2c6' : CONFIG.buildingColors[idx % CONFIG.buildingColors.length];
    const body = inkedMesh(new THREE.BoxGeometry(hw * 2, H, hd * 2), tone, { k: 1.014, receive: true });
    body.position.set(cx, H / 2, cz); body.rotation.y = rot;
    this.scene.add(body);
    if (wood) this._sidingLines(cx, cz, rot, hw, hd, H);

    const curb = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.5, 0.12, hd * 2 + 0.5), CURB);
    curb.position.set(cx, 0.06, cz); curb.rotation.y = rot; curb.receiveShadow = true;
    this.scene.add(curb);

    // Roof — a mix of Japanese types (gable / hip / flat), per the reference.
    const roll = this.rng();
    if (roll < 0.42) {
      this._gableRoof(cx, cz, hw, hd, rot, H);
    } else if (roll < 0.62) {
      this._hipRoof(cx, cz, hw * 2, hd * 2, H, rot);
      this._roofTiles(cx, cz, rot, H + 0.05, hw, hd, true);
    } else {
      const cap = inkedMesh(new THREE.BoxGeometry(hw * 2 + 0.3, 0.36, hd * 2 + 0.3), '#cdcbc7', { k: 1.02 });
      cap.position.set(cx, H + 0.18, cz); cap.rotation.y = rot;
      this.scene.add(cap);
      if (this.rng() < 0.45) this._corrugated(cx, cz, rot, H + 0.37, hw, hd);  // ridged metal roof
      if (this.rng() < 0.5) {
        const a = this._toWorld(cx, cz, rot, hw * 0.5, -hd * 0.5);
        this._antenna(a.x, H, a.z);
      }
    }

    // four facades
    this._facade(cx, cz, rot, hw, hd, H,  0,  1, idx);      // +local z
    this._facade(cx, cz, rot, hw, hd, H,  0, -1, idx + 1);  // -local z
    this._facade(cx, cz, rot, hw, hd, H,  1,  0, idx + 2);  // +local x
    this._facade(cx, cz, rot, hw, hd, H, -1,  0, idx + 3);  // -local x
  }

  // wall slot per street-facing face (only if its approach is on open ground)
  _addSlots(cx, cz, hw, hd, rot, idx) {
    const py = 1.55, wh = 2.7;
    const faces = [
      { nlx: 0, nlz: 1, half: hd, len: hw },
      { nlx: 0, nlz: -1, half: hd, len: hw },
      { nlx: 1, nlz: 0, half: hw, len: hd },
      { nlx: -1, nlz: 0, half: hw, len: hd },
    ];
    for (const f of faces) {
      const fc = this._toWorld(cx, cz, rot, f.nlx * f.half, f.nlz * f.half);
      const n  = this._dir(rot, f.nlx, f.nlz);
      const ap = { x: fc.x + n.x * CONFIG.approachOffset, z: fc.z + n.z * CONFIG.approachOffset };
      if (this.isColliding(ap.x, ap.z)) continue;   // wall faces a building → skip
      this.wallSlots.push({
        px: fc.x, py, pz: fc.z, nx: n.x, nz: n.z,
        wallW: Math.min(f.len * 1.4, 4.4), wallH: wh,
        buildingIdx: idx, used: false, mesh: null,
      });
    }
  }

  _facade(cx, cz, rot, hw, hd, H, nlx, nlz, seed) {
    const half = (nlx !== 0) ? hw : hd;
    const wallLen = ((nlx !== 0) ? hd : hw) * 2;
    const tlx = -nlz, tlz = nlx;                       // tangent (local)
    const n = this._dir(rot, nlx, nlz);
    const rotY = Math.atan2(n.x, n.z);
    const floors = Math.min(3, Math.max(1, Math.round(H / 2.4)));
    const cols   = Math.min(3, Math.max(1, Math.round(wallLen / 2.8)));

    for (let f = 0; f < floors; f++) {
      const wy = 1.4 + f * 2.2;
      if (wy + 0.6 > H) continue;
      for (let c = 0; c < cols; c++) {
        const tc = (c - (cols - 1) / 2) * 2.4;
        const w = this._toWorld(cx, cz, rot, nlx * half + tlx * tc, nlz * half + tlz * tc);
        const ox = n.x * 0.09, oz = n.z * 0.09;
        if (f === 0 && (c + seed) % 3 === 0) {
          const sh = new THREE.Mesh(SHU_GEO, SHUTTER);
          sh.position.set(w.x + ox, 1.05, w.z + oz); sh.rotation.y = rotY;
          this.scene.add(sh); continue;
        }
        const win = new THREE.Mesh(WIN_GEO, GLASS);
        win.position.set(w.x + ox, wy, w.z + oz); win.rotation.y = rotY;
        this.scene.add(win);

        if (f >= 1 && (c + f + seed) % 2 === 0) {
          const b = this._toWorld(cx, cz, rot, nlx * (half + 0.26) + tlx * tc, nlz * (half + 0.26) + tlz * tc);
          const slab = inkedMesh(new THREE.BoxGeometry(0.5, 0.08, 1.5), '#d8d6d2', { k: 1.05, cast: false });
          slab.position.set(b.x, wy - 0.6, b.z); slab.rotation.y = rotY; this.scene.add(slab);
          const rail = inkedMesh(new THREE.BoxGeometry(0.46, 0.42, 0.05), '#3a3834', { k: 1.06, cast: false });
          const rb = this._toWorld(cx, cz, rot, nlx * (half + 0.48) + tlx * tc, nlz * (half + 0.48) + tlz * tc);
          rail.position.set(rb.x, wy - 0.38, rb.z); rail.rotation.y = rotY; this.scene.add(rail);
        } else if (f >= 1 && (c + seed) % 3 === 1) {
          const a = this._toWorld(cx, cz, rot, nlx * (half + 0.22) + tlx * (tc + 0.7), nlz * (half + 0.22) + tlz * (tc + 0.7));
          const ac = inkedMesh(new THREE.BoxGeometry(0.42, 0.38, 0.55), '#dcdad6', { k: 1.06, cast: false });
          ac.position.set(a.x, wy - 0.5, a.z); ac.rotation.y = rotY; this.scene.add(ac);
        }
      }
    }
    // drainpipe + base plants on the street side
    const e = this._toWorld(cx, cz, rot, nlx * half + tlx * (wallLen / 2 - 0.3), nlz * half + tlz * (wallLen / 2 - 0.3));
    const pipe = inkedMesh(new THREE.CylinderGeometry(0.06, 0.06, H, 6), '#bcbab6', { k: 1.08, cast: false });
    pipe.position.set(e.x + n.x * 0.08, H / 2, e.z + n.z * 0.08); this.scene.add(pipe);
    if ((seed % 2) === 0) {
      const pb = this._toWorld(cx, cz, rot, nlx * (half + 0.5), nlz * (half + 0.5));
      this._pottedPlant(pb.x, pb.z, 0.7 + (seed % 3) * 0.16);
      // lush overhanging greenery along the wall (the alleys are overgrown)
      if (this.rng() < 0.6) this._vine(e.x + n.x * 0.16, e.z + n.z * 0.16, 2.8 + this.rng() * 2.4);
      if (this.rng() < 0.3) this._bush(pb.x, pb.z, 0.6 + this.rng() * 0.35);
      // foliage spilling over the wall top
      if (this.rng() < 0.35) this._leaf(pb.x, H - 0.3, pb.z, 0.5 + this.rng() * 0.3, LEAF[seed % LEAF.length]);
    }
  }

  // ── Poles + organic overhead wire net ─────────────────────────────────────
  _buildPolesAndWires() {
    // poles strung along the main roads + a scatter on open ground
    for (const r of this.mainRoads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        for (let t = 0; t < 1; t += 0.5) {
          const x = a.x + (b.x - a.x) * t + r.half + 0.3;
          const z = a.z + (b.z - a.z) * t;
          if (!this.isColliding(x, z) && Math.abs(x) < this.HALF && Math.abs(z) < this.HALF)
            { this._pole(x, z, 8.6, this.rng() < 0.3); this.poles.push({ x, z }); }
        }
      }
    }
    for (let k = 0; k < 60; k++) {
      const x = this._rand(-this.HALF, this.HALF), z = this._rand(-this.HALF, this.HALF);
      if (!this.isColliding(x, z) && this._distToMainRoad(x, z) > 2) { this._pole(x, z, 8.4, this.rng() < 0.2); this.poles.push({ x, z }); }
    }
    // wire each pole to its 2 nearest neighbours → tangled net
    for (let i = 0; i < this.poles.length; i++) {
      const a = this.poles[i];
      const near = this.poles
        .map((p, j) => ({ j, d: (p.x - a.x) ** 2 + (p.z - a.z) ** 2 }))
        .filter(o => o.j !== i && o.d < 18 * 18).sort((u, v) => u.d - v.d).slice(0, 2);
      for (const o of near) {
        if (o.j < i) continue;
        const b = this.poles[o.j];
        [8.0, 7.5].forEach(h => this._wire(a.x, h, a.z, b.x, h, b.z, 0.5));
      }
    }
  }

  // ── Collision (oriented boxes) ────────────────────────────────────────────
  isColliding(x, z) {
    if (Math.abs(x) > this.HALF || Math.abs(z) > this.HALF) return true;
    const r = CONFIG.charRadius;
    for (const b of this.buildings) {
      const dx = x - b.cx, dz = z - b.cz;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + r && Math.abs(lz) < b.hd + r) return true;
    }
    return false;
  }

  // returns roof height at (x,z) inside a footprint, else 0 — for camera collision
  hitsBuilding(x, z) {
    for (const b of this.buildings) {
      const dx = x - b.cx, dz = z - b.cz;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw && Math.abs(lz) < b.hd) return b.top;
    }
    return 0;
  }

  _findOpen(x, z) {
    if (!this.isColliding(x, z)) return { x, z };
    for (let r = 2; r < this.HALF; r += 1.5) {
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        if (!this.isColliding(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: 0, z: 0 };
  }

  randomReachablePoint() {
    for (let i = 0; i < 60; i++) {
      const x = this._rand(-this.HALF + 1, this.HALF - 1);
      const z = this._rand(-this.HALF + 1, this.HALF - 1);
      if (!this.isColliding(x, z)) return { x, z };
    }
    return this.spawn || { x: 0, z: 0 };
  }

  // A far target roughly AHEAD of the current heading, so KAI commits to long,
  // straight-ish walks instead of constantly changing direction (the town is
  // big and open enough). Widens the search cone if the way ahead is blocked.
  forwardPoint(x, z, facing) {
    for (let a = 0; a < 26; a++) {
      const spread = a < 16 ? 0.8 : 2.6;
      const ang  = facing + (this.rng() - 0.5) * spread;
      const dist = 16 + this.rng() * 22;
      const px = x + Math.sin(ang) * dist, pz = z + Math.cos(ang) * dist;
      if (Math.abs(px) < this.HALF - 1.5 && Math.abs(pz) < this.HALF - 1.5 && !this.isColliding(px, pz))
        return { x: px, z: pz };
    }
    return this.randomReachablePoint();
  }

  approachPoint(slot) {
    return { x: slot.px + slot.nx * CONFIG.approachOffset, z: slot.pz + slot.nz * CONFIG.approachOffset };
  }
  isApproachFree(slot) { const p = this.approachPoint(slot); return !this.isColliding(p.x, p.z); }
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

  // ── Detail builders ───────────────────────────────────────────────────────
  _hipRoof(x, z, w, d, h, rot) {
    const oh = 0.4, rH = 0.9 + Math.min(w, d) * 0.13, dia = Math.hypot(w + oh * 2, d + oh * 2) * 0.5;
    const cone = inkedMesh(new THREE.ConeGeometry(dia, rH, 4), '#26241f', { k: 1.03 });
    cone.position.set(x, h + rH / 2, z); cone.rotation.y = rot + Math.PI / 4; this.scene.add(cone);
    const eave = inkedMesh(new THREE.BoxGeometry(w + oh * 2, 0.16, d + oh * 2), '#1a1814', { k: 1.04 });
    eave.position.set(x, h + 0.08, z); eave.rotation.y = rot; this.scene.add(eave);
  }

  // Gable (spioventi) roof — triangular prism + tiled slopes.
  _gableRoof(cx, cz, hw, hd, rot, H) {
    const oh = 0.4;
    const halfSpan = hw + oh;
    const len = hd * 2 + oh * 2;
    const rh = 0.6 + Math.min(hw, hd) * 0.42;
    const mat = toonMat('#3a3833'); mat.side = THREE.DoubleSide;
    const roof = new THREE.Mesh(gableGeometry(halfSpan, rh, len), mat);
    roof.castShadow = true; addInk(roof, 1.02);
    roof.position.set(cx, H, cz); roof.rotation.y = rot;
    this.scene.add(roof);
    // ridge beam
    const ridge = inkedMesh(new THREE.BoxGeometry(0.1, 0.12, len), '#1a1814', { k: 1.06, cast: false });
    ridge.position.set(cx, H + rh, cz); ridge.rotation.y = rot; this.scene.add(ridge);
    this._roofTiles(cx, cz, rot, H, hw, hd, false, rh, halfSpan, len);
  }

  // Parallel tile/ridge strokes down a pitched roof (cheap THREE.Line strokes).
  _roofTiles(cx, cz, rot, H, hw, hd, hip, rh = 0, halfSpan = 0, len = 0) {
    const line = (lx0, ly0, lz0, lx1, ly1, lz1) => {
      const a = this._toWorld(cx, cz, rot, lx0, lz0), b = this._toWorld(cx, cz, rot, lx1, lz1);
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, H + ly0, a.z), new THREE.Vector3(b.x, H + ly1, b.z)]);
      this.scene.add(new THREE.Line(g, ROOFLINE));
    };
    if (hip) {
      // a few rings parallel to the eaves
      const rH = 0.9 + Math.min(hw * 2, hd * 2) * 0.13;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4, e = (1 - t);
        line(-hw * e, rH * t + 0.06, -hd * e, hw * e, rH * t + 0.06, -hd * e);
        line(-hw * e, rH * t + 0.06,  hd * e, hw * e, rH * t + 0.06,  hd * e);
      }
    } else {
      // gable: lines along the ridge on both slopes
      const N = 5, zEdge = len / 2 - 0.25;
      for (let s = -1; s <= 1; s += 2) {
        for (let i = 1; i < N; i++) {
          const t = i / N;                     // ridge(0) → eave(1)
          const lx = s * t * halfSpan, ly = rh * (1 - t) + 0.05;
          line(lx, ly, -zEdge, lx, ly, zEdge);
        }
      }
    }
  }

  // Low corrugated-metal roof — parallel ribs across a flat cap.
  _corrugated(cx, cz, rot, y, hw, hd) {
    const N = Math.max(4, Math.round(hw * 1.4));
    for (let i = 0; i <= N; i++) {
      const lx = -hw + (2 * hw) * (i / N);
      const a = this._toWorld(cx, cz, rot, lx, -hd + 0.2), b = this._toWorld(cx, cz, rot, lx, hd - 0.2);
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, y, a.z), new THREE.Vector3(b.x, y, b.z)]);
      this.scene.add(new THREE.Line(g, ROOFLINE));
    }
  }

  // Wooden board fence (板塀) across the front of a plot.
  _plankFence(cx, cz, rot, hw, hd) {
    const h = 1.0 + this.rng() * 0.4, len = hw * 2;
    const f = this._toWorld(cx, cz, rot, 0, hd);
    const panel = inkedMesh(new THREE.BoxGeometry(len, h, 0.08), '#cfcabd', { k: 1.03 });
    panel.position.set(f.x, h / 2, f.z); panel.rotation.y = rot; this.scene.add(panel);
    const rail = inkedMesh(new THREE.BoxGeometry(len + 0.1, 0.1, 0.13), '#a8a294', { k: 1.05, cast: false });
    rail.position.set(f.x, h - 0.06, f.z); rail.rotation.y = rot; this.scene.add(rail);
    for (let lx = -hw + 0.3; lx < hw; lx += 0.34) {     // vertical plank seams
      const a = this._toWorld(cx, cz, rot, lx, hd + 0.05);
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, 0.05, a.z), new THREE.Vector3(a.x, h - 0.05, a.z)]);
      this.scene.add(new THREE.Line(g, ROOFLINE));
    }
    [-hw, hw].forEach(lx => {
      const p = this._toWorld(cx, cz, rot, lx, hd);
      const post = inkedMesh(new THREE.BoxGeometry(0.12, h + 0.16, 0.16), '#8f897b', { k: 1.06, cast: false });
      post.position.set(p.x, (h + 0.16) / 2, p.z); post.rotation.y = rot; this.scene.add(post);
    });
  }

  // Horizontal wood-siding seams on a building's four faces.
  _sidingLines(cx, cz, rot, hw, hd, H) {
    const faces = [[0, 1, hd, hw], [0, -1, hd, hw], [1, 0, hw, hd], [-1, 0, hw, hd]];
    for (const [nlx, nlz, half, wl] of faces) {
      const tlx = -nlz, tlz = nlx;
      const o = this._dir(rot, nlx, nlz);
      let c = 0;
      for (let y = 0.6; y < H - 0.2 && c < 7; y += 0.55, c++) {
        const a = this._toWorld(cx, cz, rot, nlx * half + tlx * (-wl + 0.15), nlz * half + tlz * (-wl + 0.15));
        const b = this._toWorld(cx, cz, rot, nlx * half + tlx * (wl - 0.15), nlz * half + tlz * (wl - 0.15));
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.x + o.x * 0.05, y, a.z + o.z * 0.05),
          new THREE.Vector3(b.x + o.x * 0.05, y, b.z + o.z * 0.05)]);
        this.scene.add(new THREE.Line(g, ROOFLINE));
      }
    }
  }

  // Elevated spherical water tank on a lattice tower — a Shōwa rooftop landmark.
  _waterTower(x, z) {
    const legH = 4.2, r = 0.95;
    const tone = '#2a2620';
    for (const [sx, sz] of [[-0.6,-0.6],[0.6,-0.6],[-0.6,0.6],[0.6,0.6]]) {
      const leg = inkedMesh(new THREE.CylinderGeometry(0.06, 0.06, legH, 5), tone, { k: 1.08, cast: false });
      leg.position.set(x + sx, legH / 2, z + sz); leg.rotation.x = sx * 0.04; leg.rotation.z = -sz * 0.04;
      this.scene.add(leg);
    }
    // cross-braces
    [1.4, 2.8].forEach(cy => {
      const b1 = inkedMesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), tone, { k: 1.1, cast: false }); b1.position.set(x, cy, z - 0.6); this.scene.add(b1);
      const b2 = b1.clone(); b2.position.set(x, cy, z + 0.6); this.scene.add(b2);
      const b3 = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, 1.5), tone, { k: 1.1, cast: false }); b3.position.set(x - 0.6, cy, z); this.scene.add(b3);
      const b4 = b3.clone(); b4.position.set(x + 0.6, cy, z); this.scene.add(b4);
    });
    const tank = inkedMesh(new THREE.SphereGeometry(r, 12, 10), '#cdcbc7', { k: 1.02 });
    tank.position.set(x, legH + r * 0.7, z); this.scene.add(tank);
    const cap = inkedMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 6), tone, { k: 1.1, cast: false });
    cap.position.set(x, legH + r * 1.7, z); this.scene.add(cap);
  }
  _pole(x, z, h, transformer = false) {
    const shaft = inkedMesh(new THREE.CylinderGeometry(0.08, 0.11, h, 6), '#2a2620', { k: 1.05 });
    shaft.position.set(x, h / 2, z); this.scene.add(shaft);
    [[h - 0.6, 1.9], [h - 1.5, 1.3]].forEach(([ay, aw]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), toonMat('#2a2620'));
      arm.position.set(x, ay, z); this.scene.add(arm);
    });
    if (transformer) {
      const tf = inkedMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8), '#34302a', { k: 1.06, cast: false });
      tf.position.set(x + 0.26, h - 2.4, z); this.scene.add(tf);
    }
  }
  _wire(x0, y0, z0, x1, y1, z1, sag) {
    const mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2 - sag, (z0 + z1) / 2);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y0, z0), mid, new THREE.Vector3(x1, y1, z1));
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(12)), WIRE));
  }
  _pottedPlant(x, z, s = 1) {
    const pot = inkedMesh(new THREE.CylinderGeometry(0.16 * s, 0.20 * s, 0.34 * s, 8), '#dcdad6', { k: 1.05 });
    pot.position.set(x, 0.17 * s, z); this.scene.add(pot);
    this._leaf(x, 0.34 * s + 0.20 * s, z, 0.30 * s, LEAF[1]);
    this._leaf(x + 0.13 * s, 0.34 * s + 0.40 * s, z - 0.05 * s, 0.20 * s, LEAF[3]);
  }
  _leaf(x, y, z, r, tone) {
    const m = inkedMesh(new THREE.IcosahedronGeometry(r, 0), tone, { k: 1.05, cast: false });
    m.position.set(x, y, z); m.rotation.set(this.rng(), this.rng(), this.rng()); this.scene.add(m); return m;
  }
  _vine(x, z, h) {
    for (let y = 0.4; y < h; y += 0.55)
      this._leaf(x + this._rand(-0.18, 0.18), y, z + this._rand(-0.4, 0.4), 0.24 + this.rng() * 0.12, LEAF[(y * 7 | 0) % LEAF.length]);
  }
  _bush(x, z, s) {
    [[0, 0.32, 0], [0.3, 0.30, 0.1], [-0.28, 0.34, -0.12], [0.05, 0.55, 0]].forEach(([ox, oy, oz], i) =>
      this._leaf(x + ox * s, oy * s + 0.1, z + oz * s, (0.28 + (i % 2) * 0.08) * s, LEAF[i % LEAF.length]));
  }
  _bigTree(x, z) {
    const trunk = inkedMesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 7), '#231d18', { k: 1.05 });
    trunk.position.set(x, 1.6, z); this.scene.add(trunk);
    [[0, 3.8, 0, 1.4], [0.7, 4.3, 0.3, 1.0], [-0.6, 4.2, -0.4, 1.05], [0.1, 4.9, 0, 0.9]].forEach(([ox, oy, oz, r], i) =>
      this._leaf(x + ox, oy, z + oz, r, LEAF[i % LEAF.length]));
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
}

// distance from point to segment
function segDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}
