import * as THREE from 'three';
import { CONFIG } from './config.js';
import { rotateY2D } from './helpers.js';
import { toonMat, addInk, inkedMesh } from './toon.js';
import { planetPoint, planetQuat, placeOnPlanet, PLANET_R } from './planet.js';
import { GLASS, SHUTTER, LEAF } from './items/materials.js';
import { createItem } from './items/index.js';

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
// The planet ground itself: a warm taupe/brown-grey, a touch darker than the
// pale building walls so the earth reads apart from the facades — still low
// saturation so it stays inside the B&W manga look (screentone + ink survive).
const GROUND   = toonMat('#c1b8a8');
const CURB     = toonMat('#e6e4e0');
// GLASS / SHUTTER panes (shared with the item factory) and the foliage geometry
// now live in js/items/materials.js — imported above.
const WIRE     = new THREE.LineBasicMaterial({ color: '#141210' });
const ROOFLINE = new THREE.LineBasicMaterial({ color: '#2a2824' });   // tile / corrugation strokes
const WIN_GEO  = new THREE.PlaneGeometry(1.0, 1.2);
// A dark sash FRAME drawn just behind each window pane (slightly larger), so a
// border of frame shows around the glass — the "cornici alle finestre" detail.
// Less-negative polygonOffset than GLASS so the pane always sits in front of it.
const FRAME_GEO = new THREE.PlaneGeometry(1.22, 1.46);
const FRAME_MAT = new THREE.MeshBasicMaterial({ color: '#3a3631', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

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
const DOOR_GEO = new THREE.PlaneGeometry(0.95, 1.9);
const DOOR     = new THREE.MeshBasicMaterial({ color: '#322e28', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

export class City {
  constructor(scene) {
    this.scene     = scene;
    this.buildings = [];   // {cx,cz,hw,hd,rot,top}
    this.wallSlots = [];
    this.poles     = [];
    this.colliders = [];   // round prop colliders {x,z,r}
    this.barriers  = [];   // thin fence/wall colliders {cx,cz,hw,hd,rot}
    this._roofSeg  = [];   // batched line segments (roof tiles / siding / seams)
    this._wireSeg  = [];   // batched overhead-wire segments
    this._winXf    = [];   // window transforms [x,y,z,rotY,…] → one InstancedMesh
    this._shutXf   = [];   // shutter transforms
    this.lampHeads = [];   // lamp lens positions [x,y,z,…] → night glow points
    // per-object animators: each is a fn(t, dt) that nudges a LOCAL transform of
    // a child object (a spinning AC fan, a swaying tree crown, a flapping futon).
    // They animate children of already-spherified anchors, so the planet mapping
    // is untouched. main.js drives them via city.update().
    this.animators = [];
    this.rng       = mulberry32(20260623);

    this.HALF = CONFIG.world.half;
    this.R    = PLANET_R;
    this.CAP  = 64;     // town radius — now reaches near the equator (mirrored below)
    this.mainRoads = this._genMainRoads();

    // One main road is dressed as a 商店街 (shopping street): plots within
    // CONFIG.shop.band of it become taller mixed-use shops with shopfronts and
    // rooftop signboards — the dense Japanese high-street of the reference photos.
    this.shopRoad = (CONFIG.shop && CONFIG.shop.enabled && this.mainRoads.length)
      ? this.mainRoads[0] : null;

    // every object City adds after this index is a city object (the scene may
    // already hold the lights); used by _spherifyIndividuals to wrap only ours.
    this._childBase = scene.children.length;

    this._buildGround();
    this._generate();
    this._buildPolesAndWires();
    this._buildStreetProps();   // bicycles, banners, planters, road signs

    // a couple of water towers as landmarks (kept off the main road)
    for (let k = 0; k < 2; k++) {
      let p;
      for (let t = 0; t < 30; t++) { p = this._findOpen(this._rand(-30, 30), this._rand(-30, 30)); if (this._distToMainRoad(p.x, p.z) > 3) break; }
      this._waterTower(p.x, p.z);
    }

    // Wrap the flat town onto the little planet: transform every individual mesh
    // added above, then build the batched lines + instanced windows already
    // mapped onto the sphere.
    this._spherifyIndividuals();
    this._buildRoads();       // curved road ribbons that hug the sphere (+ manholes)
    this._finalizeLines();    // merge all batched strokes into 2 LineSegments
    this._buildInstances();   // windows + shutters → 1 InstancedMesh each
    this._fillPlanet();       // mirror the town onto the far (dark-side) hemisphere
    this.spawn = this._findOpen(0, 0);
  }

  // Fill the rest of the little planet: the playable town is a cap on top, so we
  // mirror a decorative copy of it onto the opposite hemisphere (rotated 180°
  // about X, twisted a little so it isn't an obvious twin). It shares geometry,
  // has no collision/slots — KAI stays on the top cap — and gives the planet a
  // built-up "dark side" instead of a bare underside.
  _fillPlanet() {
    const north = new THREE.Group();
    const mine = this.scene.children.slice(this._childBase);
    for (const o of mine) north.add(o);     // reparent every city object

    const south = new THREE.Group();
    south.rotation.set(Math.PI, 0.7, 0);    // flip to the underside + a twist
    for (const o of north.children) {
      if (o === this.planet) continue;       // the sphere already spans both halves
      south.add(o.clone());
    }

    // Everything that belongs to the little planet lives under ONE root. The app
    // spins this root over the real day (the sun is FIXED), so a real day/night
    // terminator sweeps across the sphere and KAI's town sits on the lit or the
    // dark side to match Tokyo's clock. KAI and the lamp glows are reparented in
    // here too (main.js) so they rotate rigidly with the town.
    this.worldRoot = new THREE.Group();
    this.worldRoot.add(north);
    this.worldRoot.add(south);
    this.scene.add(this.worldRoot);
    this.north = north;
  }

  // Reposition + reorient every individual city mesh onto the planet. Batched
  // geometry (lines, instances) and the planet sphere itself are skipped — they
  // are built already-mapped.
  _spherifyIndividuals() {
    const base = new THREE.Quaternion();
    const kids = this.scene.children;
    for (let i = this._childBase; i < kids.length; i++) {
      const o = kids[i];
      if (o === this.planet || o.isLight || o.isCamera) continue;
      const ox = o.position.x, oy = o.position.y, oz = o.position.z;
      // A flat-bottomed box sits tangent on the curved planet, so the surface
      // curves away under its edges and it looks like it floats. Sink the base
      // by the footprint's sagitta (R·(1-cos(hr/R))) AND extend the box downward
      // by the same amount (keeping the top in place), so the wall grows into the
      // ground exactly as much as it sinks — no gap, no lost height. Tiny props
      // (poles, leaves) have ~0 sagitta and stay put.
      let yEff = oy;
      if (o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        const hx = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
        const hz = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
        const hr = Math.hypot(hx, hz);
        const h0 = (bb.max.y - bb.min.y) * 0.5;
        if (hr > 0.7 && h0 > 0.05) {
          const sink = Math.min(this.R * (1 - Math.cos(Math.min(hr, this.R) / this.R)) + 0.06, 1.2);
          o.scale.y *= (h0 + sink / 2) / h0;   // extend down, top stays put
          yEff = oy - sink / 2;
        }
      }
      base.copy(o.quaternion);                         // keep the flat orientation
      planetPoint(ox, yEff, oz, o.position, this.R);   // → world point on the sphere
      planetQuat(ox, oz, o.quaternion, this.R);        // transport rotation …
      o.quaternion.multiply(base);                     // … carrying the original heading
    }
    // map the lamp-lens positions (flat) onto the planet too, so the night glow
    // points sit on the real lamps instead of floating at the old flat coords
    const v = new THREE.Vector3();
    for (let i = 0; i < this.lampHeads.length; i += 3) {
      planetPoint(this.lampHeads[i], this.lampHeads[i + 1], this.lampHeads[i + 2], v, this.R);
      this.lampHeads[i] = v.x; this.lampHeads[i + 1] = v.y; this.lampHeads[i + 2] = v.z;
    }
  }

  // Drive every registered per-object animator (called once per frame by the app).
  update(dt, t) {
    const a = this.animators;
    for (let i = 0; i < a.length; i++) a[i](t, dt);
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

  // Edge distance to ONE specific road (used to detect plots on the shopping street).
  _distToRoad(road, x, z) {
    if (!road) return Infinity;
    let best = Infinity;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const d = segDist(x, z, road.pts[i], road.pts[i + 1]) - road.half;
      if (d < best) best = d;
    }
    return best;
  }

  // Nearest main road: edge distance, direction angle, and the closest point —
  // used to keep the road clear and to line it with road-aligned houses.
  _nearestRoad(x, z) {
    let best = Infinity, ang = 0, px = x, pz = z;
    for (const r of this.mainRoads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
        const nx = a.x + t * dx, nz = a.z + t * dz;
        const d = Math.hypot(x - nx, z - nz) - r.half;
        if (d < best) { best = d; ang = Math.atan2(dx, dz); px = nx; pz = nz; }
      }
    }
    return { dist: best, ang, px, pz };
  }

  // ── Ground = the planet itself (a sphere of radius R) ─────────────────────
  _buildGround() {
    const planet = new THREE.Mesh(new THREE.SphereGeometry(this.R, 160, 110), GROUND);
    planet.receiveShadow = true;
    this.scene.add(planet);
    this.planet = planet;
  }

  // Main roads as darker ribbons that HUG the planet: each segment is a strip
  // subdivided along its length with every vertex projected onto the sphere, so
  // the lanes follow the curve instead of floating as flat tiles (which made the
  // ground look disconnected). Built after the spherify pass, so the projected
  // vertices are used as-is. One merged mesh = one draw call.
  _buildRoads() {
    const v = new THREE.Vector3();
    const pos = [], idx = [];
    const spos = [], sidx = [];   // crosswalk / stop-line stripes (lighter paint)
    let vi = 0;
    for (const r of this.mainRoads) {
      const hw = r.half;
      let painted = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        if (Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) > this.CAP) continue;
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
        const px = -dz / len, pz = dx / len;            // perpendicular (across width)
        const N = Math.max(2, Math.ceil(len / 2.5));    // subdivide along length
        for (let s = 0; s <= N; s++) {
          const cx = a.x + dx * (s / N), cz = a.z + dz * (s / N);
          planetPoint(cx + px * hw, 0.06, cz + pz * hw, v, this.R); pos.push(v.x, v.y, v.z);
          planetPoint(cx - px * hw, 0.06, cz - pz * hw, v, this.R); pos.push(v.x, v.y, v.z);
        }
        for (let s = 0; s < N; s++) {
          const o = vi + s * 2;
          idx.push(o, o + 1, o + 2,  o + 1, o + 3, o + 2);
        }
        vi += (N + 1) * 2;
        if (this.rng() < 0.5) {                          // an occasional manhole
          const t = this._rand(0.3, 0.7), off = this._rand(-hw * 0.45, hw * 0.45);
          this._manhole(a.x + dx * t + px * off, a.z + dz * t + pz * off);
        }
        // a zebra crossing — only on a flat, central, long-enough straight run so
        // the stripes always land on real asphalt (never spilling onto the curved
        // ground / curb down the planet's side).
        if (painted < 2 && Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) < this.CAP * 0.4 && len > 6) {
          this._crosswalk(spos, sidx, (a.x + b.x) / 2, (a.z + b.z) / 2, dx / len, dz / len, px, pz, hw);
          painted++;
        }
        // a flagstone sidewalk strip along the kerb (paving joints, drawn only on
        // open ground so it never runs through a building)
        if (Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) < this.CAP * 0.6)
          this._sidewalkPaving(a, dx, dz, len, px, pz, hw);
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const road = new THREE.Mesh(g, ASPHALT2);
      road.receiveShadow = true;
      this.scene.add(road);
    }
    if (spos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
      g.setIndex(sidx); g.computeVertexNormals();
      this.scene.add(new THREE.Mesh(g, toonMat('#e9e7e2')));
    }
  }

  // Lay zebra stripes across the road at (cx,cz): stripes repeat ALONG the road
  // direction (fx,fz) and span ACROSS it (px,pz). Corners are projected onto the
  // sphere so the paint hugs the curved tarmac. Appends into shared buffers.
  _crosswalk(spos, sidx, cx, cz, fx, fz, px, pz, hw) {
    const v = new THREE.Vector3();
    // stripes span ACROSS the asphalt, kept a clear margin inside the road edge
    // (so the zebra never bleeds onto the curb/sidewalk), repeated ALONG the road.
    const n = 5, sw = 0.34, gap = 0.32, ah = Math.min(hw * 0.8, hw - 0.3), y = 0.075;
    let base = spos.length / 3;
    for (let j = 0; j < n; j++) {
      const off = (j - (n - 1) / 2) * (sw + gap);
      const mx = cx + fx * off, mz = cz + fz * off;
      const sw2 = sw / 2;
      const corners = [
        [mx + fx * sw2 + px * ah, mz + fz * sw2 + pz * ah],
        [mx + fx * sw2 - px * ah, mz + fz * sw2 - pz * ah],
        [mx - fx * sw2 + px * ah, mz - fz * sw2 + pz * ah],
        [mx - fx * sw2 - px * ah, mz - fz * sw2 - pz * ah],
      ];
      for (const [px2, pz2] of corners) { planetPoint(px2, y, pz2, v, this.R); spos.push(v.x, v.y, v.z); }
      sidx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      base += 4;
    }
  }

  // Flagstone sidewalk along a road segment's kerb: paving JOINTS (cross ties +
  // lengthwise seams) laid as ink strokes, only where the strip sits on open
  // ground (so it never runs under a building). Appends flat segments into the
  // batched roof/stroke buffer (projected onto the planet in _finalizeLines).
  _sidewalkPaving(a, dx, dz, len, px, pz, hw) {
    const inA = hw + 0.12, inB = hw + 0.55, mid = hw + 0.33, y = 0.07;
    const step = 0.95, N = Math.max(1, Math.floor(len / step));
    for (const s of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const t = i / N, cx = a.x + dx * t, cz = a.z + dz * t;
        const mx = cx + px * s * mid, mz = cz + pz * s * mid;
        if (this.isColliding(mx, mz)) { prev = null; continue; }
        const ax = cx + px * s * inA, az = cz + pz * s * inA;   // kerb edge
        const bx = cx + px * s * inB, bz = cz + pz * s * inB;   // inner edge
        this._roofSeg.push(ax, y, az, bx, y, bz);              // cross tie
        if (prev) {                                            // lengthwise seams
          this._roofSeg.push(prev.ax, y, prev.az, ax, y, az);
          this._roofSeg.push(prev.bx, y, prev.bz, bx, y, bz);
        }
        prev = { ax, az, bx, bz };
      }
    }
  }

  // A round manhole cover lying tangent on the planet (built post-spherify).
  _manhole(x, z) {
    const baseQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const rim = new THREE.Mesh(new THREE.CircleGeometry(0.46, 18), toonMat('#3a3833'));
    placeOnPlanet(rim, x, 0.08, z, baseQ, this.R); rim.receiveShadow = true; this.scene.add(rim);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.36, 18), toonMat('#86837e'));
    placeOnPlanet(inner, x, 0.09, z, baseQ, this.R); this.scene.add(inner);
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
        // The town is a round cap on the planet: drop plots outside the disc so
        // the square's corners don't wrap past the equator onto the underside.
        if (Math.hypot(cx, cz) > this.CAP) continue;
        // keep the main road itself clear of buildings
        const nr = this._nearestRoad(cx, cz);
        if (nr.dist < 2.0) continue;
        // Plots hugging the shopping street become shops (taller, squared to it).
        const isShop = this._distToRoad(this.shopRoad, cx, cz) < (CONFIG.shop?.band ?? 0);
        // ~15% of plots are left as open lots / pocket gardens (never on the
        // shopping street — a high street is a continuous wall of shopfronts).
        const open = !isShop && this.rng() < 0.15;
        const hw = Math.max(2.4, (cxr.b - cxr.a) / 2 - this._rand(0.4, 1.1));
        const hd = Math.max(2.4, (czr.b - czr.a) / 2 - this._rand(0.4, 1.1));

        // Houses lining the main road (and all shops) are squared up to it (walls
        // parallel, door/shopfront facing the road); the rest sit at little angles.
        let rot, door = 0;
        if (nr.dist < 7 || isShop) {
          rot = nr.ang;
          const f = this._dir(rot, 1, 0);                 // +x face normal
          door = (f.x * (nr.px - cx) + f.z * (nr.pz - cz)) >= 0 ? 1 : -1;
        } else {
          rot = this._rand(-0.22, 0.22);
        }

        if (open) { this._openLot(cx, cz, hw, hd, rot); continue; }

        const H2 = isShop
          ? CONFIG.shop.minTop + this.rng() * CONFIG.shop.topRange   // taller mixed-use
          : 4.5 + (this.rng() * 3 | 0) * 1.4 + (this.rng() < 0.18 ? 2.4 : 0); // low, a few accents
        this._block(cx, cz, hw, hd, rot, H2, idx, door, isShop);
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
      this.barriers.push({ cx: f.x, cz: f.z, hw, hd: 0.12, rot });
      // concrete-block (CMU) seams, like the 塀 walls in the reference
      const o = this._dir(rot, 0, 1);
      for (const yy of [0.27, 0.53]) {
        const a = this._toWorld(cx, cz, rot, -hw + 0.05, hd);
        const b = this._toWorld(cx, cz, rot,  hw - 0.05, hd);
        this._roofSeg.push(a.x + o.x * 0.08, yy, a.z + o.z * 0.08, b.x + o.x * 0.08, yy, b.z + o.z * 0.08);
      }
      for (let lx = -hw + 0.45; lx < hw - 0.1; lx += 0.5) {
        const a = this._toWorld(cx, cz, rot, lx, hd);
        this._roofSeg.push(a.x + o.x * 0.08, 0.08, a.z + o.z * 0.08, a.x + o.x * 0.08, 0.72, a.z + o.z * 0.08);
      }
    }
    const n = 2 + (this.rng() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const p = this._toWorld(cx, cz, rot, this._rand(-hw, hw), this._rand(-hd, hd));
      if (this._distToMainRoad(p.x, p.z) < 1.2) continue;   // nothing in the main road
      if (this.rng() < 0.5) this._bush(p.x, p.z, 0.7 + this.rng() * 0.4);
      else this._bigTree(p.x, p.z);
    }
  }

  // ── A building (oriented box) + roof + facades ────────────────────────────
  _block(cx, cz, hw, hd, rot, H, idx, door = 0, shop = false) {
    const wood = !shop && this.rng() < 0.22;     // some are wood-sided houses (板張り)
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

    // road-facing door on houses that line the main road
    if (door) {
      const f = this._toWorld(cx, cz, rot, door * hw, hd * 0.3);
      const n = this._dir(rot, door, 0);
      const d = new THREE.Mesh(DOOR_GEO, DOOR);
      d.position.set(f.x + n.x * 0.05, 0.96, f.z + n.z * 0.05);
      d.rotation.y = Math.atan2(n.x, n.z);
      this.scene.add(d);
    }

    // Shop dressing on the street-facing face: an awning + signboard at the
    // storefront, and (sometimes) a rooftop billboard. The ground-floor wall
    // itself stays a paintable slot (graffiti on the shutter, very manga).
    if (shop && door) {
      this._shopfront(cx, cz, rot, door, 0, hw, hd, H, idx);
      if (this.rng() < (CONFIG.shop.roofSignChance ?? 0))
        this._roofSign(cx, cz, rot, door, 0, hw, hd, H, idx);
    }
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
          this._shutXf.push(w.x + ox, 1.05, w.z + oz, rotY); continue;   // instanced
        }
        this._winXf.push(w.x + ox, wy, w.z + oz, rotY);                  // instanced

        // occasional AC outdoor unit, sitting flush against the wall — with the
        // grille ring + spinning fan blades drawn on its street-facing face
        if (f >= 1 && (c + seed) % 4 === 1) {
          const a = this._toWorld(cx, cz, rot, nlx * (half + 0.17) + tlx * (tc + 0.7), nlz * (half + 0.17) + tlz * (tc + 0.7));
          this._acUnit(a.x, wy - 0.55, a.z, rotY);
        }
      }
    }
    // one coherent concrete balcony on the upper floor (not per-window planks)
    if (floors >= 2 && seed % 2 === 0) {
      const by = 1.4 + (floors - 1) * 2.2 - 0.55;
      if (by + 1.0 < H) this._balcony(cx, cz, rot, nlx, nlz, tlx, tlz, half, wallLen, rotY, by, seed);
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
    }
  }

  // An air-conditioner outdoor unit (室外機), modelled on a Mitsubishi Electric
  // split-system condenser: a wide, low cream box whose FRONT face is dominated
  // by one big circular fan grille — a recessed dish behind a static spoked guard
  // with concentric rings, with the fan blades spinning behind it. The left flank
  // carries the vertical louvre slats of the heat-exchanger vent. A lipped top lid
  // and two feet finish it. The body is spherified like any prop; only the fan
  // (a child group) is animated, so the planet mapping is never disturbed.
  _acUnit(x, y, z, rotY) {
    const W = 0.62, Hh = 0.42, D = 0.28, front = D / 2;
    const CASE = '#dedcd7', EDGE = '#c2bfb8', GUARD = '#5d5950', DARK = '#2a2824';
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY;
    const box = (w, h, d, col, px, py, pz, k = 1.04, cast = false) => {
      const m = inkedMesh(new THREE.BoxGeometry(w, h, d), col, { k, cast });
      m.position.set(px, py, pz); g.add(m); return m;
    };

    box(W, Hh, D, CASE, 0, 0, 0, 1.04);                              // main case
    box(W + 0.03, 0.05, D + 0.03, EDGE, 0, Hh / 2 + 0.005, 0, 1.04); // lipped top lid (overhang)
    for (const fx of [-W / 2 + 0.1, W / 2 - 0.1])                    // two feet
      box(0.1, 0.05, D + 0.04, DARK, fx, -Hh / 2 - 0.02, 0, 1.05);
    // vertical louvre slats on the left flank (heat-exchanger vent)
    for (let i = 0; i < 5; i++)
      box(0.012, Hh * 0.8, D * 0.7, '#9a968e', -W / 2 - 0.002, 0, (i - 2) * 0.045, 1.1);

    // ── the big circular fan grille on the front, right of centre ─────────────
    const R = 0.165, gx = W * 0.2;                                   // grille radius · centre x
    // recessed dish so the fan reads as set INTO the case
    const dish = inkedMesh(new THREE.CylinderGeometry(R, R, 0.04, 24), '#c8c5be', { k: 1.02, cast: false });
    dish.position.set(gx, 0, front - 0.03); dish.rotation.x = Math.PI / 2; g.add(dish);
    // spinning fan: a hub + 3 broad blades, behind the guard
    const fan = new THREE.Group(); fan.position.set(gx, 0, front - 0.02); g.add(fan);
    const hub = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), DARK, { k: 1.05, cast: false });
    hub.rotation.x = Math.PI / 2; fan.add(hub);
    for (let b = 0; b < 3; b++) {
      const arm = new THREE.Group(); arm.rotation.z = b * (Math.PI * 2 / 3); fan.add(arm);
      const blade = inkedMesh(new THREE.BoxGeometry(R * 0.82, 0.13, 0.006), '#8d897f', { k: 1.06, cast: false });
      blade.position.set(R * 0.42, 0, 0); blade.rotation.z = 0.55; arm.add(blade);
    }
    // static guard: outer rim + two concentric rings + radial spokes (in front)
    const ringAt = (rr, tube) => {
      const ring = inkedMesh(new THREE.TorusGeometry(rr, tube, 6, 28), GUARD, { k: 1.05, cast: false });
      ring.position.set(gx, 0, front); g.add(ring);
    };
    ringAt(R, 0.016); ringAt(R * 0.66, 0.01); ringAt(R * 0.33, 0.01);
    for (let s = 0; s < 6; s++) {
      const spoke = inkedMesh(new THREE.BoxGeometry(0.009, R * 2, 0.008), GUARD, { k: 1.06, cast: false });
      spoke.position.set(gx, 0, front - 0.002); spoke.rotation.z = s * (Math.PI / 6); g.add(spoke);
    }
    this.scene.add(g);
    const spd = 8 + this.rng() * 4;
    this.animators.push((t) => { fan.rotation.z = t * spd; });
  }

  // A coherent concrete balcony: a floor slab + a solid 3-sided parapet (front +
  // two side returns so it reads as a real box, not a flat tray), a dark metal
  // rail cap, and sometimes a futon/blanket draped down over the front — the
  // way a mangaka draws a Tokyo apartment balcony.
  _balcony(cx, cz, rot, nlx, nlz, tlx, tlz, half, wallLen, rotY, y, seed) {
    const w = Math.min(wallLen * 0.82, 4.2), out = 0.62, ph = 0.56;   // width · depth · parapet height
    // floor slab
    const fc = this._toWorld(cx, cz, rot, nlx * (half + out / 2), nlz * (half + out / 2));
    const slab = inkedMesh(new THREE.BoxGeometry(w, 0.12, out), '#c8c5bf', { k: 1.03, cast: false });
    slab.position.set(fc.x, y, fc.z); slab.rotation.y = rotY; this.scene.add(slab);
    // solid front parapet wall
    const pc = this._toWorld(cx, cz, rot, nlx * (half + out), nlz * (half + out));
    const front = inkedMesh(new THREE.BoxGeometry(w, ph, 0.1), '#b6b3ac', { k: 1.03, cast: false });
    front.position.set(pc.x, y + ph / 2, pc.z); front.rotation.y = rotY; this.scene.add(front);
    // two side returns → the balcony reads as a volume, not a floating shelf
    for (const s of [-1, 1]) {
      const sc = this._toWorld(cx, cz, rot, nlx * (half + out / 2) + tlx * (s * w / 2), nlz * (half + out / 2) + tlz * (s * w / 2));
      const side = inkedMesh(new THREE.BoxGeometry(0.09, ph, out), '#bebbb4', { k: 1.04, cast: false });
      side.position.set(sc.x, y + ph / 2, sc.z); side.rotation.y = rotY; this.scene.add(side);
    }
    // dark metal rail cap along the top
    const cap = inkedMesh(new THREE.BoxGeometry(w + 0.1, 0.07, 0.16), '#6e695f', { k: 1.05, cast: false });
    cap.position.set(pc.x, y + ph + 0.03, pc.z); cap.rotation.y = rotY; this.scene.add(cap);
    // futon / blanket draped over the rail and hanging down the front — each one
    // flaps gently in the breeze. The cloth hangs from a pivot at the rail (a
    // spherified anchor group); a child group swings about the rail axis, so the
    // bottom of the cloth sways while the top stays pinned to the railing.
    const nF = this.rng() < 0.7 ? (this.rng() < 0.5 ? 2 : 1) : 0;
    for (let i = 0; i < nF; i++) {
      const toff = (i - (nF - 1) / 2) * 0.92 + this._rand(-0.06, 0.06);
      const lp = this._toWorld(cx, cz, rot, nlx * (half + out + 0.06) + tlx * toff, nlz * (half + out + 0.06) + tlz * toff);
      const fh = 0.66 + this.rng() * 0.22;
      const anchor = new THREE.Group();
      anchor.position.set(lp.x, y + ph + 0.05, lp.z); anchor.rotation.y = rotY; this.scene.add(anchor);
      const swing = new THREE.Group(); anchor.add(swing);
      const futon = inkedMesh(new THREE.BoxGeometry(0.6, fh, 0.05), i % 2 ? '#9c9890' : '#d7d3cb', { k: 1.04, cast: false });
      futon.position.set(0, -fh / 2, 0); swing.add(futon);
      const ph2 = this.rng() * 6.283, fr = 0.7 + this.rng() * 0.6, amp = 0.05 + this.rng() * 0.05;
      this.animators.push((t) => {
        swing.rotation.x = Math.sin(t * fr + ph2) * amp;          // flap toward / away from the wall
        swing.rotation.z = Math.cos(t * fr * 0.7 + ph2) * amp * 0.5;
      });
    }
  }

  // ── Shop dressing (商店街) ────────────────────────────────────────────────
  // A storefront on the street-facing ground floor: a horizontal name-board
  // (kanban) across the top of the shopfront, an awning over the pavement, and
  // a vertical projecting blade sign (袖看板). All greyscale so the world stays
  // B&W; the signs register a night-glow point so they read as lit after dark.
  _shopfront(cx, cz, rot, nlx, nlz, hw, hd, H, seed) {
    const half = (nlx !== 0) ? hw : hd;
    const wallLen = ((nlx !== 0) ? hd : hw) * 2;
    const tlx = -nlz, tlz = nlx;                       // tangent (local)
    const n = this._dir(rot, nlx, nlz);
    const rotY = Math.atan2(n.x, n.z);
    const w = Math.min(wallLen * 0.92, 4.4);

    // horizontal shop name-board across the top of the storefront
    const signY = 2.9;
    const sc = this._toWorld(cx, cz, rot, nlx * (half + 0.07), nlz * (half + 0.07));
    const board = inkedMesh(new THREE.BoxGeometry(w, 0.52, 0.12), '#d8d5cd', { k: 1.03, cast: false });
    board.position.set(sc.x, signY, sc.z); board.rotation.y = rotY; this.scene.add(board);
    // a row of glyph strokes so the board reads as shop lettering (kanji-ish)
    const glyphs = 3 + (seed % 3);
    for (let gi = 0; gi < glyphs; gi++) {
      const tcen = (gi - (glyphs - 1) / 2) * (w / (glyphs + 0.6));
      const va = this._toWorld(cx, cz, rot, nlx * (half + 0.14) + tlx * tcen, nlz * (half + 0.14) + tlz * tcen);
      this._roofSeg.push(va.x, signY - 0.16, va.z, va.x, signY + 0.16, va.z);   // vertical stroke
      for (const dy of [-0.09, 0.09]) {                                          // two horizontal ticks
        const ha = this._toWorld(cx, cz, rot, nlx * (half + 0.14) + tlx * (tcen - 0.09), nlz * (half + 0.14) + tlz * (tcen - 0.09));
        const hb = this._toWorld(cx, cz, rot, nlx * (half + 0.14) + tlx * (tcen + 0.09), nlz * (half + 0.14) + tlz * (tcen + 0.09));
        this._roofSeg.push(ha.x, signY + dy, ha.z, hb.x, signY + dy, hb.z);
      }
    }

    // awning projecting over the pavement (some shops)
    if ((seed % 2) === 0) {
      const tone = CONFIG.shop.awningTones[seed % CONFIG.shop.awningTones.length];
      const aw = inkedMesh(new THREE.BoxGeometry(w, 0.1, 0.72), tone, { k: 1.03, cast: false });
      const ac = this._toWorld(cx, cz, rot, nlx * (half + 0.4), nlz * (half + 0.4));
      aw.position.set(ac.x, 2.5, ac.z); aw.rotation.y = rotY; this.scene.add(aw);
      // a thin valance hanging off the awning's front lip
      const val = inkedMesh(new THREE.BoxGeometry(w, 0.16, 0.04), tone, { k: 1.04, cast: false });
      const vc = this._toWorld(cx, cz, rot, nlx * (half + 0.76), nlz * (half + 0.76));
      val.position.set(vc.x, 2.44, vc.z); val.rotation.y = rotY; this.scene.add(val);
    }

    // vertical projecting blade sign at one end, perpendicular to the wall
    const bx = this._toWorld(cx, cz, rot, nlx * (half + 0.2) + tlx * (w / 2 - 0.3), nlz * (half + 0.2) + tlz * (w / 2 - 0.3));
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.5), toonMat('#cdcac2', { side: THREE.DoubleSide }));
    blade.position.set(bx.x, 3.5, bx.z); blade.rotation.y = rotY + Math.PI / 2; addInk(blade, 1.03); this.scene.add(blade);
    // vertical column of text on the blade sign (袖看板) — a tick per character row
    for (let gi = -1; gi <= 1; gi++) {
      const ca = this._toWorld(cx, cz, rot, nlx * (half + 0.2) + tlx * (w / 2 - 0.4), nlz * (half + 0.2) + tlz * (w / 2 - 0.4));
      const cb = this._toWorld(cx, cz, rot, nlx * (half + 0.2) + tlx * (w / 2 - 0.2), nlz * (half + 0.2) + tlz * (w / 2 - 0.2));
      this._roofSeg.push(ca.x, 3.5 + gi * 0.42, ca.z, cb.x, 3.5 + gi * 0.42, cb.z);
    }

    if (CONFIG.shop.nightGlow) this.lampHeads.push(sc.x + n.x * 0.12, signY, sc.z + n.z * 0.12);
  }

  // A rooftop billboard (屋上看板): two posts off the roof carrying a panel that
  // faces the street, with stroke "lettering" rows. Optional night glow.
  _roofSign(cx, cz, rot, nlx, nlz, hw, hd, H, seed) {
    const half = (nlx !== 0) ? hw : hd;
    const wallLen = ((nlx !== 0) ? hd : hw) * 2;
    const tlx = -nlz, tlz = nlx;
    const n = this._dir(rot, nlx, nlz);
    const rotY = Math.atan2(n.x, n.z);
    const w = Math.min(wallLen * 0.8, 3.6), sh = 1.3 + this.rng() * 0.8;
    const baseY = H + 0.2;
    for (const s of [-1, 1]) {
      const pc = this._toWorld(cx, cz, rot, nlx * (half - 0.4) + tlx * (s * w * 0.4), nlz * (half - 0.4) + tlz * (s * w * 0.4));
      const post = inkedMesh(new THREE.BoxGeometry(0.08, sh + 0.4, 0.08), '#2a2620', { k: 1.1, cast: false });
      post.position.set(pc.x, baseY + (sh + 0.4) / 2, pc.z); post.rotation.y = rotY; this.scene.add(post);
    }
    const fc = this._toWorld(cx, cz, rot, nlx * (half - 0.4), nlz * (half - 0.4));
    const panel = inkedMesh(new THREE.BoxGeometry(w, sh, 0.1), '#dad7cf', { k: 1.02, cast: false });
    panel.position.set(fc.x, baseY + 0.4 + sh / 2, fc.z); panel.rotation.y = rotY; this.scene.add(panel);
    const rows = 2 + (this.rng() * 2 | 0);
    for (let i = 1; i <= rows; i++) {
      const yy = baseY + 0.4 + sh * (i / (rows + 1));
      const a = this._toWorld(cx, cz, rot, nlx * (half - 0.34) + tlx * (-w / 2 + 0.25), nlz * (half - 0.34) + tlz * (-w / 2 + 0.25));
      const b = this._toWorld(cx, cz, rot, nlx * (half - 0.34) + tlx * (w / 2 - 0.25), nlz * (half - 0.34) + tlz * (w / 2 - 0.25));
      this._roofSeg.push(a.x, yy, a.z, b.x, yy, b.z);
    }
    if (CONFIG.shop.nightGlow) this.lampHeads.push(fc.x + n.x * 0.12, baseY + 0.4 + sh / 2, fc.z + n.z * 0.12);
  }

  // ── Poles + organic overhead wire net ─────────────────────────────────────
  _buildPolesAndWires() {
    // poles strung along the main roads + a scatter on open ground. The shopping
    // street gets a denser run of poles (finer spacing) for its tangled cable net.
    for (const r of this.mainRoads) {
      const step = (r === this.shopRoad) ? 0.34 : 0.5;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        for (let t = 0; t < 1; t += step) {
          const x = a.x + (b.x - a.x) * t + r.half + 0.3;
          const z = a.z + (b.z - a.z) * t;
          if (Math.hypot(x, z) > this.CAP) continue;
          if (!this.isColliding(x, z) && Math.abs(x) < this.HALF && Math.abs(z) < this.HALF)
            { this._pole(x, z, 8.6, this.rng() < 0.3); this.poles.push({ x, z }); }
        }
      }
    }
    for (let k = 0; k < 60; k++) {
      const x = this._rand(-this.HALF, this.HALF), z = this._rand(-this.HALF, this.HALF);
      if (Math.hypot(x, z) > this.CAP) continue;
      if (!this.isColliding(x, z) && this._distToMainRoad(x, z) > 2) { this._pole(x, z, 8.4, this.rng() < 0.2); this.poles.push({ x, z }); }
    }
    // wire each pole to its 3 nearest neighbours → a denser tangled net
    for (let i = 0; i < this.poles.length; i++) {
      const a = this.poles[i];
      const near = this.poles
        .map((p, j) => ({ j, d: (p.x - a.x) ** 2 + (p.z - a.z) ** 2 }))
        .filter(o => o.j !== i && o.d < 18 * 18).sort((u, v) => u.d - v.d).slice(0, 3);
      for (const o of near) {
        if (o.j < i) continue;
        const b = this.poles[o.j];
        [8.0, 7.5].forEach(h => this._wire(a.x, h, a.z, b.x, h, b.z, 0.5));
      }
    }
    // street lamps set just outside the houses (against them, by the curb —
    // never mid-lane), lighting the lanes at night and kept off the main road
    let lamps = 0;
    for (const bld of this.buildings) {
      if (lamps >= 24) break;
      if (this.rng() > 0.45) continue;
      const sgn = this.rng() < 0.5 ? 1 : -1;
      const f = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.7), bld.hd * (this.rng() - 0.5));
      if (this.isColliding(f.x, f.z) || this._distToMainRoad(f.x, f.z) < 1.0) continue;
      const n = this._dir(bld.rot, sgn, 0);               // outward = toward the street
      this._lamppost(f.x, f.z, Math.atan2(n.x, n.z)); lamps++;
    }
  }

  // A cobra-head street lamp: the arm + head reach OUT toward the street (along
  // `ang`) and the lamp shines down onto the lane. Lens position is recorded
  // for the night glow + ground pool.
  _lamppost(x, z, ang = 0) {
    this.colliders.push({ x, z, r: 0.18 });
    const h = 4.2, reach = 0.95;
    const dx = Math.sin(ang), dz = Math.cos(ang);     // unit dir toward the street
    const pole = inkedMesh(new THREE.CylinderGeometry(0.055, 0.08, h, 6), '#2a2620', { k: 1.06 });
    pole.position.set(x, h / 2, z); this.scene.add(pole);
    const arm = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, reach), '#2a2620', { k: 1.1, cast: false });
    arm.position.set(x + dx * reach / 2, h - 0.06, z + dz * reach / 2); arm.rotation.y = ang;
    this.scene.add(arm);
    const hx = x + dx * reach, hz = z + dz * reach;
    const head = inkedMesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), '#1c1a17', { k: 1.05, cast: false });
    head.position.set(hx, h - 0.14, hz); head.rotation.y = ang; this.scene.add(head);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.16), toonMat('#fff3df'));
    lens.position.set(hx, h - 0.21, hz); lens.rotation.y = ang; this.scene.add(lens);
    this.lampHeads.push(hx, h - 0.24, hz);
  }

  // ── Collision (buildings = OBB; props = circles; barriers = OBB) ──────────
  isColliding(x, z) {
    if (Math.abs(x) > this.HALF || Math.abs(z) > this.HALF) return true;
    const r = CONFIG.charRadius;
    for (const b of this.buildings) {
      const dx = x - b.cx, dz = z - b.cz;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + r && Math.abs(lz) < b.hd + r) return true;
    }
    // round props: poles, trees, bushes, water towers
    for (const o of this.colliders) {
      const dx = x - o.x, dz = z - o.z, rr = o.r + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    // thin barriers: fences + low garden walls (oriented boxes)
    for (const b of this.barriers) {
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
  // Pick a free wall to paint. Prefer ones NEAR `from` (the town is big — a
  // random wall is often minutes away), with a little variety among the nearest.
  pickFreeSlot(from) {
    const free = this.wallSlots.filter(s => !s.used && this.isApproachFree(s));
    if (!free.length) return null;
    if (!from) return free[(Math.random() * free.length) | 0];
    free.sort((a, b) =>
      ((a.px - from.x) ** 2 + (a.pz - from.z) ** 2) - ((b.px - from.x) ** 2 + (b.pz - from.z) ** 2));
    return free[(Math.random() * Math.min(free.length, 6)) | 0];
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
    const mat = toonMat('#3a3833', { side: THREE.DoubleSide });
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
      this._roofSeg.push(a.x, H + ly0, a.z, b.x, H + ly1, b.z);
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
      this._roofSeg.push(a.x, y, a.z, b.x, y, b.z);
    }
  }

  // Wooden board fence (板塀) across the front of a plot.
  _plankFence(cx, cz, rot, hw, hd) {
    const h = 1.0 + this.rng() * 0.4, len = hw * 2;
    const f = this._toWorld(cx, cz, rot, 0, hd);
    this.barriers.push({ cx: f.x, cz: f.z, hw, hd: 0.12, rot });
    const panel = inkedMesh(new THREE.BoxGeometry(len, h, 0.08), '#cfcabd', { k: 1.03 });
    panel.position.set(f.x, h / 2, f.z); panel.rotation.y = rot; this.scene.add(panel);
    const rail = inkedMesh(new THREE.BoxGeometry(len + 0.1, 0.1, 0.13), '#a8a294', { k: 1.05, cast: false });
    rail.position.set(f.x, h - 0.06, f.z); rail.rotation.y = rot; this.scene.add(rail);
    for (let lx = -hw + 0.3; lx < hw; lx += 0.34) {     // vertical plank seams
      const a = this._toWorld(cx, cz, rot, lx, hd + 0.05);
      this._roofSeg.push(a.x, 0.05, a.z, a.x, h - 0.05, a.z);
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
        this._roofSeg.push(a.x + o.x * 0.05, y, a.z + o.z * 0.05, b.x + o.x * 0.05, y, b.z + o.z * 0.05);
      }
    }
  }

  // Elevated spherical water tank on a lattice tower — a Shōwa rooftop landmark.
  _waterTower(x, z) {
    this.colliders.push({ x, z, r: 1.05 });
    const legH = 4.2, r = 0.95;
    const tone = '#2a2620';
    // legs cast shadows (they're what holds the tank up — they must read on the
    // ground), like the rest of the lattice
    for (const [sx, sz] of [[-0.6,-0.6],[0.6,-0.6],[-0.6,0.6],[0.6,0.6]]) {
      const leg = inkedMesh(new THREE.CylinderGeometry(0.06, 0.06, legH, 5), tone, { k: 1.08 });
      leg.position.set(x + sx, legH / 2, z + sz); leg.rotation.x = sx * 0.04; leg.rotation.z = -sz * 0.04;
      this.scene.add(leg);
    }
    // cross-braces
    [1.4, 2.8].forEach(cy => {
      const b1 = inkedMesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), tone, { k: 1.1 }); b1.position.set(x, cy, z - 0.6); this.scene.add(b1);
      const b2 = b1.clone(); b2.position.set(x, cy, z + 0.6); this.scene.add(b2);
      const b3 = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, 1.5), tone, { k: 1.1 }); b3.position.set(x - 0.6, cy, z); this.scene.add(b3);
      const b4 = b3.clone(); b4.position.set(x + 0.6, cy, z); this.scene.add(b4);
    });
    const tank = inkedMesh(new THREE.SphereGeometry(r, 12, 10), '#cdcbc7', { k: 1.02 });
    tank.position.set(x, legH + r * 0.7, z); this.scene.add(tank);
    const cap = inkedMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 6), tone, { k: 1.1, cast: false });
    cap.position.set(x, legH + r * 1.7, z); this.scene.add(cap);
  }
  _pole(x, z, h, transformer = false) {
    this.colliders.push({ x, z, r: 0.25 });
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
    const pts = curve.getPoints(10);
    for (let i = 0; i < pts.length - 1; i++)
      this._wireSeg.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
  }

  // Merge every batched stroke into a single LineSegments per material — turns
  // hundreds of one-segment Line draw calls into two.
  _finalizeLines() {
    const v = new THREE.Vector3();
    const build = (arr, mat) => {
      if (!arr.length) return;
      // map every endpoint onto the planet (segments become short chords)
      for (let i = 0; i < arr.length; i += 3) {
        planetPoint(arr[i], arr[i + 1], arr[i + 2], v, this.R);
        arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      this.scene.add(new THREE.LineSegments(g, mat));
    };
    build(this._roofSeg, ROOFLINE);
    build(this._wireSeg, WIRE);
  }

  // All windows (and all shutters) share one geometry + material, so each set
  // collapses to a single InstancedMesh draw call instead of hundreds.
  _buildInstances() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion(),
          p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const make = (geo, mat, arr) => {
      const n = arr.length / 4; if (!n) return;
      const im = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        const x = arr[i * 4], y = arr[i * 4 + 1], z = arr[i * 4 + 2];
        planetPoint(x, y, z, p, this.R);                 // onto the sphere
        planetQuat(x, z, q, this.R);                     // transport rotation …
        yaw.setFromAxisAngle(up, arr[i * 4 + 3]);
        q.multiply(yaw);                                 // … carrying the wall's facing
        im.setMatrixAt(i, m.compose(p, q, s));
      }
      im.instanceMatrix.needsUpdate = true;
      this.scene.add(im);
    };
    make(FRAME_GEO, FRAME_MAT, this._winXf);   // sash frame behind each pane
    make(WIN_GEO, GLASS, this._winXf);
    make(SHU_GEO, SHUTTER, this._shutXf);
  }
  // ── Greenery: delegated to the parametric item factory (js/items/nature.js) ─
  // city.js owns LAYOUT (where things go); the factory owns the MESH of each item.
  _pottedPlant(x, z, s = 1) { createItem(this, 'plant', { x, z, scale: s }); }
  _leaf(x, y, z, r, tone)   { return createItem(this, 'leaf', { x, y, z, r, tone }); }
  _vine(x, z, h)            { createItem(this, 'vine', { x, z, height: h }); }
  _bush(x, z, s)            { createItem(this, 'bush', { x, z, scale: s }); }
  _bigTree(x, z)            { createItem(this, 'tree', { x, z }); }
  _antenna(x, baseY, z) {
    const mast = inkedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), '#1c1a17', { k: 1.12, cast: false });
    mast.position.set(x, baseY + 0.65, z); this.scene.add(mast);
    [0.95, 1.2].forEach((cy, i) => {
      const cw = 0.55 - i * 0.16;
      const bar = inkedMesh(new THREE.BoxGeometry(cw, 0.03, 0.03), '#1c1a17', { k: 1.15, cast: false });
      bar.position.set(x, baseY + cy, z); this.scene.add(bar);
    });
  }

  // ── Street set dressing taken from the reference alleys ───────────────────
  // Parked bicycles by the walls, vertical shop banners (幟), concrete planter
  // boxes, and a few road signs. Counts are capped and collisions checked so
  // the lanes stay walkable.
  _buildStreetProps() {
    const S = CONFIG.shop || {};
    let bikes = 0, banners = 0, planters = 0, signs = 0,
        vending = 0, scooters = 0, cars = 0, cones = 0, mirrors = 0, stairs = 0, benches = 0;
    for (const bld of this.buildings) {
      const r = this.rng();
      const sgn = this.rng() < 0.5 ? 1 : -1;
      const n = this._dir(bld.rot, sgn, 0);                 // outward (toward street)
      const outAng = Math.atan2(n.x, n.z);
      const along = bld.hd * this._rand(-0.55, 0.55);
      const f = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.5), along);
      if (Math.abs(f.x) > this.HALF - 1 || Math.abs(f.z) > this.HALF - 1) continue;
      const isShop = this._distToRoad(this.shopRoad, bld.cx, bld.cz) < (S.band ?? 0);

      // Vending machines cluster on the shopping street, rarer elsewhere.
      if (vending < (S.vendingMax ?? 0) && (isShop ? r < 0.36 : r < 0.06)) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.6), along);
        if (!this.isColliding(p.x, p.z)) { this._vendingMachine(p.x, p.z, outAng); vending++; continue; }
      }
      // a parked kei-car a little further off the wall, clear of the main road
      if (cars < (S.carMax ?? 0) && r < 0.12) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 1.2), along);
        if (!this.isColliding(p.x, p.z) && this._distToMainRoad(p.x, p.z) > 0.9) {
          this._keiCar(p.x, p.z, outAng + Math.PI / 2); cars++; continue;
        }
      }
      if (scooters < (S.scooterMax ?? 0) && r < 0.2) {
        if (!this.isColliding(f.x, f.z)) { this._scooter(f.x, f.z, outAng + Math.PI / 2); scooters++; continue; }
      }
      if (bikes < 12 && r < 0.32) {
        if (!this.isColliding(f.x, f.z)) { this._bicycle(f.x, f.z, outAng); bikes++; continue; }
      }
      if (banners < 14 && r < 0.5) {
        const b = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.4), along);
        if (!this.isColliding(b.x, b.z)) { this._nobori(b.x, b.z, outAng); banners++; continue; }
      }
      if (planters < 16 && r < 0.68) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.6), along);
        if (!this.isColliding(p.x, p.z)) { this._planterBox(p.x, p.z, outAng); planters++; continue; }
      }
      // a staircase up to some residential entrances (not on the high street)
      if (!isShop && stairs < 8 && r < 0.78) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.85), along);
        if (!this.isColliding(p.x, p.z) && this._distToMainRoad(p.x, p.z) > 1.2) {
          this._stairs(p.x, p.z, outAng, 4 + (this.rng() * 3 | 0)); stairs++; continue;
        }
      }
      // a public bench set against the wall, facing the lane
      if (benches < 6 && r > 0.52 && r < 0.74) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.7), along);
        if (!this.isColliding(p.x, p.z) && this._distToMainRoad(p.x, p.z) > 1.0) {
          this._bench(p.x, p.z, outAng + Math.PI, 1.1 + this.rng() * 0.5); benches++; continue;
        }
      }
    }

    // Convex mirrors, cones and barriers at/near road junctions.
    for (let k = 0; k < 80 && (mirrors < (S.mirrorMax ?? 0) || cones < (S.coneMax ?? 0)); k++) {
      const x = this._rand(-this.HALF, this.HALF), z = this._rand(-this.HALF, this.HALF);
      const d = this._distToMainRoad(x, z);
      if (d <= 0.4 || d >= 2.0 || this.isColliding(x, z)) continue;
      const nr = this._nearestRoad(x, z);
      const ang = Math.atan2(nr.px - x, nr.pz - z);
      if (mirrors < (S.mirrorMax ?? 0) && this.rng() < 0.4) { this._curveMirror(x, z, ang); mirrors++; }
      else if (cones < (S.coneMax ?? 0)) {
        this._trafficCone(x, z); cones++;
        if (this.rng() < 0.3 && cones < (S.coneMax ?? 0)) {
          const p = this._toWorld(x, z, ang, 0.55, 0);
          if (!this.isColliding(p.x, p.z)) { this._trafficCone(p.x, p.z); cones++; }
        }
        if (this.rng() < 0.25) this._aFrameBarrier(x, z, ang + Math.PI / 2);
      }
    }

    // a few road signs at open spots just off the main roads
    for (let k = 0; k < 50 && signs < 8; k++) {
      const x = this._rand(-this.HALF, this.HALF), z = this._rand(-this.HALF, this.HALF);
      const d = this._distToMainRoad(x, z);
      if (d > 0.6 && d < 2.2 && !this.isColliding(x, z)) {
        const nr = this._nearestRoad(x, z);
        this._roadSign(x, z, Math.atan2(nr.px - x, nr.pz - z)); signs++;
      }
    }
  }

  // A parked bicycle, seen side-on (its face turned toward the street).
  _bicycle(x, z, ang) { createItem(this, 'bicycle', { x, z, ang }); }

  // A vertical shop banner (幟) on a thin pole, facing the street.
  _nobori(x, z, ang) {
    this.colliders.push({ x, z, r: 0.16 });
    const h = 2.3 + this.rng() * 0.5, dx = Math.sin(ang), dz = Math.cos(ang);
    const pole = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, h, 5), '#2a2620', { k: 1.1 });
    pole.position.set(x, h / 2, z); this.scene.add(pole);
    const arm = inkedMesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), '#2a2620', { k: 1.12, cast: false });
    arm.position.set(x + dx * 0.15, h - 0.1, z + dz * 0.15); arm.rotation.y = ang; this.scene.add(arm);
    const bh = h - 0.55;
    const tone = this.rng() < 0.5 ? '#3a3833' : '#45433d';
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.42, bh), toonMat(tone, { side: THREE.DoubleSide }));
    banner.position.set(x + dx * 0.3, h - 0.1 - bh / 2, z + dz * 0.3); banner.rotation.y = ang;
    addInk(banner, 1.02); this.scene.add(banner);
  }

  // A rectangular concrete planter box with shrubs, lining the lane.
  _planterBox(x, z, ang) {
    const w = 1.1 + this.rng() * 0.5, d = 0.46, bh = 0.6;
    this.barriers.push({ cx: x, cz: z, hw: w / 2, hd: d / 2, rot: ang });
    const box = inkedMesh(new THREE.BoxGeometry(w, bh, d), '#cfccc4', { k: 1.04 });
    box.position.set(x, bh / 2, z); box.rotation.y = ang; this.scene.add(box);
    const rim = inkedMesh(new THREE.BoxGeometry(w + 0.08, 0.09, d + 0.08), '#b4b0a7', { k: 1.04, cast: false });
    rim.position.set(x, bh, z); rim.rotation.y = ang; this.scene.add(rim);
    const tlx = Math.cos(ang), tlz = -Math.sin(ang);
    const nb = 2 + (this.rng() * 2 | 0);
    for (let i = 0; i < nb; i++) {
      const t = (i / Math.max(1, nb - 1) - 0.5) * (w - 0.3);
      this._leaf(x + tlx * t, bh + 0.12, z + tlz * t, 0.3 + this.rng() * 0.12, LEAF[i % LEAF.length]);
      this._leaf(x + tlx * t + 0.08, bh + 0.3, z + tlz * t, 0.2 + this.rng() * 0.1, LEAF[(i + 1) % LEAF.length]);
    }
  }

  // A triangular warning road sign on a pole, facing the street.
  _roadSign(x, z, ang) {
    this.colliders.push({ x, z, r: 0.16 });
    const h = 2.5, dx = Math.sin(ang), dz = Math.cos(ang);
    const pole = inkedMesh(new THREE.CylinderGeometry(0.04, 0.04, h, 6), '#6e6a62', { k: 1.08 });
    pole.position.set(x, h / 2, z); this.scene.add(pole);
    const tg = new THREE.CircleGeometry(0.34, 3); tg.rotateZ(Math.PI / 2);   // apex up
    const tri = new THREE.Mesh(tg, toonMat('#f4f1ea', { side: THREE.DoubleSide }));
    tri.position.set(x + dx * 0.06, h - 0.12, z + dz * 0.06); tri.rotation.y = ang;
    addInk(tri, 1.1, 0x141414); this.scene.add(tri);
  }

  // ── Reference street dressing: vending machines, mirrors, cones, vehicles ──

  _vendingMachine(x, z, ang) { createItem(this, 'vending', { x, z, ang }); }

  // A convex traffic mirror (カーブミラー) on a pole at a junction, facing back
  // down the road. The dark frame + pale disc read in B&W.
  _curveMirror(x, z, ang) {
    this.colliders.push({ x, z, r: 0.16 });
    const dx = Math.sin(ang), dz = Math.cos(ang), h = 2.9;
    const pole = inkedMesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6), '#6e6a62', { k: 1.07 });
    pole.position.set(x, h / 2, z); this.scene.add(pole);
    const arm = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), '#6e6a62', { k: 1.1, cast: false });
    arm.position.set(x + dx * 0.25, h - 0.12, z + dz * 0.25); arm.rotation.y = ang; this.scene.add(arm);
    const mx = x + dx * 0.5, mz = z + dz * 0.5;
    const frame = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), toonMat('#3a3833', { side: THREE.DoubleSide }));
    frame.position.set(mx, h - 0.06, mz); frame.rotation.y = ang + Math.PI; addInk(frame, 1.08); this.scene.add(frame);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), toonMat('#f2efe9', { side: THREE.DoubleSide }));
    face.position.set(mx - dx * 0.02, h - 0.06, mz - dz * 0.02); face.rotation.y = ang + Math.PI; this.scene.add(face);
  }

  _trafficCone(x, z) { createItem(this, 'cone', { x, z }); }

  // A public bench against a wall (length parametric).
  _bench(x, z, ang, length) { createItem(this, 'bench', { x, z, ang, length }); }

  // An A-frame barricade (single-A sawhorse) with a striped board.
  _aFrameBarrier(x, z, ang) {
    this.barriers.push({ cx: x, cz: z, hw: 0.6, hd: 0.12, rot: ang });
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
    const board = inkedMesh(new THREE.BoxGeometry(1.2, 0.22, 0.06), '#dcd9d2', { k: 1.04, cast: false });
    board.position.set(0, 0.78, 0); g.add(board);
    for (let i = -1; i <= 1; i++) {                         // diagonal hazard stripes
      const st = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), SHUTTER);
      st.position.set(i * 0.34, 0.78, 0.035); g.add(st);
    }
    for (const s of [-1, 1]) {
      const leg = inkedMesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), '#6e6a62', { k: 1.08, cast: false });
      leg.position.set(s * 0.45, 0.47, 0); leg.rotation.z = s * 0.16; g.add(leg);
    }
    this.scene.add(g);
  }

  // A parked kei-car (軽自動車) along the kerb, modelled on the tall, square
  // "kei box" body (e.g. the BYD RACCO). Unlike the boxy props around it, this
  // is built REALISTIC and SMOOTH: the whole shell is one rounded volume — a
  // side-profile Shape extruded across the width with a generous bevel so every
  // edge is filleted (no facets) — finished with smoothly-shaded MeshStandard
  // materials (no manga hatching / ink hull) and high-segment round wheels.
  // Length runs along local X (front at +X), width along Z.
  _keiCar(x, z, ang) {
    this.barriers.push({ cx: x, cz: z, hw: 1.0, hd: 0.48, rot: ang });
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0, ...o });
    const BODY  = std('#edebe6', { roughness: 0.45 });
    const GLASSM = std('#222428', { roughness: 0.12 });
    const BLACK = std('#1b1916', { roughness: 0.75 });
    const TIRE  = std('#161410', { roughness: 0.95 });
    const ALLOY = std('#b4b0a8', { roughness: 0.35, metalness: 0.55 });
    const LAMP  = std('#f5f2ec', { roughness: 0.25 });
    const TRIM  = std('#2e2a25', { roughness: 0.5 });
    const W = 0.82;

    // rounded smooth panel (no ink, no toon) — flat detail pieces (glass, trim…)
    const panel = (geo, mat, px, py, pz, cast = false) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz);
      m.castShadow = cast; g.add(m); return m;
    };

    // ── one rounded body shell: a kei-box side profile, extruded + bevelled ───
    const P = [
      [-0.98, 0.22], [0.98, 0.22], [1.02, 0.48], [1.00, 0.78], [0.94, 0.95],
      [0.60, 1.03], [0.50, 1.50], [0.30, 1.57], [-0.80, 1.57], [-0.94, 1.36],
      [-1.01, 0.95], [-1.01, 0.48],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) shape.lineTo(P[i][0], P[i][1]);
    shape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
      depth: W - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08,
      bevelSegments: 4, steps: 1, curveSegments: 8,
    });
    bodyGeo.translate(0, 0, -(W - 0.16) / 2);
    bodyGeo.computeVertexNormals();
    // recentre the geometry on its own centroid so the inverted-hull ink shell
    // expands evenly all round (the profile's origin sits at the body's foot)
    bodyGeo.computeBoundingBox();
    const bc = new THREE.Vector3(); bodyGeo.boundingBox.getCenter(bc);
    bodyGeo.translate(-bc.x, -bc.y, -bc.z);
    const body = new THREE.Mesh(bodyGeo, BODY);
    body.position.copy(bc); body.castShadow = true;
    addInk(body, 1.015);                                              // light manga ink contour
    g.add(body);

    // ── tinted wrap-around glazing (flat panels hugging the cabin) ────────────
    const sideWin = new THREE.BoxGeometry(1.16, 0.5, 0.02);
    for (const sz of [W / 2 + 0.005, -(W / 2 + 0.005)]) addInk(panel(sideWin, GLASSM, -0.06, 1.22, sz), 1.025);
    // raked windscreen + rear screen — inset from the flanks and kept under the
    // roofline so they don't poke through the silhouette
    const ws = panel(new THREE.BoxGeometry(0.04, 0.44, W - 0.26), GLASSM, 0.575, 1.2, 0); ws.rotation.z = -0.22; addInk(ws, 1.03);
    const rs = panel(new THREE.BoxGeometry(0.04, 0.3, W - 0.28), GLASSM, -0.88, 1.34, 0); rs.rotation.z = 0.5; addInk(rs, 1.03);
    // black roof, wrapping just over the cant-rail for the two-tone look
    addInk(panel(new THREE.BoxGeometry(1.2, 0.1, W + 0.015), BLACK, -0.25, 1.55, 0), 1.02);

    // ── doors: seams + smooth recessed handles, both flanks ───────────────────
    for (const sz of [W / 2 + 0.006, -(W / 2 + 0.006)]) {
      panel(new THREE.BoxGeometry(0.016, 0.46, 0.012), TRIM, -0.02, 0.62, sz);   // sliding-door seam
      panel(new THREE.BoxGeometry(0.016, 0.46, 0.012), TRIM,  0.52, 0.62, sz);   // front-door seam
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 12), TRIM);
      handle.rotation.x = Math.PI / 2; handle.position.set(-0.2, 0.82, sz); g.add(handle);
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12), TRIM);
      fh.rotation.x = Math.PI / 2; fh.position.set(0.36, 0.82, sz); g.add(fh);
    }

    // ── front: LED light bar, rounded headlamps, bumper intake, plate, fogs ───
    const fx = 1.12;   // proud of the rounded nose so the lamps/bar sit on the surface
    panel(new THREE.BoxGeometry(0.03, 0.05, W - 0.12), TRIM, fx, 0.84, 0);
    panel(new THREE.BoxGeometry(0.04, 0.02, W - 0.18), LAMP, fx + 0.006, 0.84, 0);   // glowing strip
    const lamp = new THREE.SphereGeometry(0.075, 16, 12);
    for (const sz of [W / 2 - 0.14, -(W / 2 - 0.14)]) {
      const h = new THREE.Mesh(lamp, LAMP); h.scale.set(0.55, 0.8, 1.0); h.position.set(fx - 0.02, 0.8, sz); g.add(h);
    }
    addInk(panel(new THREE.BoxGeometry(0.05, 0.16, W - 0.2), BLACK, fx - 0.01, 0.5, 0), 1.04);   // lower intake
    for (const sz of [W / 2 - 0.18, -(W / 2 - 0.18)]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), LAMP); f.position.set(fx + 0.01, 0.47, sz); g.add(f);
    }
    panel(new THREE.BoxGeometry(0.02, 0.1, 0.24), LAMP, fx + 0.015, 0.62, 0);        // number plate

    // ── rear: tall corner tail-lights + plate ─────────────────────────────────
    for (const sz of [W / 2 - 0.05, -(W / 2 - 0.05)]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.1), TRIM); t.position.set(-fx + 0.01, 0.8, sz); g.add(t);
    }
    panel(new THREE.BoxGeometry(0.02, 0.1, 0.22), LAMP, -fx - 0.005, 0.52, 0);

    // ── wing mirrors (rounded) ────────────────────────────────────────────────
    for (const sz of [W / 2 + 0.06, -(W / 2 + 0.06)]) {
      const mir = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), BODY);
      mir.scale.set(1.1, 0.8, 0.7); mir.position.set(0.6, 0.96, sz); g.add(mir);
    }

    // ── smooth round 5-spoke alloy wheels in black arch flares ────────────────
    const tireGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.16, 32);
    const discGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.02, 28);   // recessed (dark) alloy face
    const lipGeo  = new THREE.TorusGeometry(0.15, 0.022, 10, 28);       // bright rim lip
    const spokeGeo = new THREE.BoxGeometry(0.032, 0.24, 0.02);          // light alloy spokes
    const capGeo  = new THREE.CylinderGeometry(0.035, 0.035, 0.025, 12);
    const archGeo = new THREE.TorusGeometry(0.25, 0.03, 8, 20, Math.PI);// half-ring fender eyebrow
    for (const wx of [-0.6, 0.62]) for (const wz of [W / 2 - 0.05, -(W / 2 - 0.05)]) {
      const sgn = wz > 0 ? 1 : -1, face = wz + sgn * 0.085;
      const tire = new THREE.Mesh(tireGeo, TIRE); tire.position.set(wx, 0.21, wz); tire.rotation.x = Math.PI / 2; addInk(tire, 1.05); g.add(tire);
      const disc = new THREE.Mesh(discGeo, TRIM); disc.position.set(wx, 0.21, face - sgn * 0.012); disc.rotation.x = Math.PI / 2; g.add(disc);
      const spokes = new THREE.Group();                                  // 5 light spokes on the dark face
      for (let s = 0; s < 5; s++) { const sp = new THREE.Mesh(spokeGeo, ALLOY); sp.rotation.z = s * (Math.PI * 2 / 5); spokes.add(sp); }
      spokes.position.set(wx, 0.21, face); g.add(spokes);
      const lip = new THREE.Mesh(lipGeo, ALLOY); lip.position.set(wx, 0.21, face); g.add(lip);
      const cap = new THREE.Mesh(capGeo, ALLOY); cap.position.set(wx, 0.21, face + sgn * 0.008); cap.rotation.x = Math.PI / 2; g.add(cap);
      const arch = new THREE.Mesh(archGeo, BLACK); arch.position.set(wx, 0.21, sgn * (W / 2 + 0.01)); g.add(arch);
    }
    this.scene.add(g);
  }

  // A parked scooter / moped against a wall.
  _scooter(x, z, ang) {
    this.colliders.push({ x, z, r: 0.4 });
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
    const FRAME = '#34302a', TIRE = '#1c1a17', SHELL = '#cfccc4';
    const wheelGeo = new THREE.TorusGeometry(0.22, 0.06, 6, 14);
    for (const wx of [-0.42, 0.42]) {
      const wheel = inkedMesh(wheelGeo, TIRE, { k: 1.05 });
      wheel.position.set(wx, 0.22, 0); g.add(wheel);
    }
    const body = inkedMesh(new THREE.BoxGeometry(0.72, 0.26, 0.26), SHELL, { k: 1.03, cast: false });
    body.position.set(-0.05, 0.5, 0); g.add(body);
    const front = inkedMesh(new THREE.BoxGeometry(0.16, 0.5, 0.22), SHELL, { k: 1.03, cast: false });
    front.position.set(0.42, 0.56, 0); g.add(front);
    const seat = inkedMesh(new THREE.BoxGeometry(0.42, 0.1, 0.22), '#262320', { k: 1.05, cast: false });
    seat.position.set(-0.2, 0.66, 0); g.add(seat);
    const hb = inkedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.42), FRAME, { k: 1.1, cast: false });
    hb.position.set(0.46, 0.84, 0); g.add(hb);
    this.scene.add(g);
  }

  // A short flight of concrete steps (with low cheek walls) — the level-change
  // cue of the reference backstreets. Footprint is a barrier so KAI walks round.
  _stairs(x, z, rot, n = 5) {
    const stepW = 1.2, stepH = 0.18, stepD = 0.32;
    this.barriers.push({ cx: x, cz: z, hw: stepW / 2 + 0.12, hd: (n * stepD) / 2, rot });
    for (let i = 0; i < n; i++) {
      const p = this._toWorld(x, z, rot, 0, (i - (n - 1) / 2) * stepD);
      const step = inkedMesh(new THREE.BoxGeometry(stepW, stepH * (i + 1), stepD + 0.02), '#d2cfc8', { k: 1.02, cast: false, receive: true });
      step.position.set(p.x, stepH * (i + 1) / 2, p.z); step.rotation.y = rot; this.scene.add(step);
    }
    // low cheek walls flanking the flight
    const topH = stepH * n;
    for (const s of [-1, 1]) {
      const cheek = inkedMesh(new THREE.BoxGeometry(0.12, topH + 0.2, n * stepD), '#cdcac3', { k: 1.03, cast: false });
      const p = this._toWorld(x, z, rot, s * (stepW / 2 + 0.06), 0);
      cheek.position.set(p.x, (topH + 0.2) / 2, p.z); cheek.rotation.y = rot; this.scene.add(cheek);
    }
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
