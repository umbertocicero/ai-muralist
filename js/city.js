import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './helpers.js';
import { toonMat, addInk, inkedMesh } from './toon.js';
import { planetPoint, planetQuat, PLANET_R } from './planet.js';
import { GLASS, SHUTTER } from './items/materials.js';
import { createItem } from './items/index.js';
import { WIN_GEO, FRAME_GEO, FRAME_MAT, MUNTIN_GEO, MUNTIN_MAT, SILL_GEO, SILL_MAT,
         SHU_GEO, SLAT_GEO, SLAT_MAT } from './items/house.js';
import { applyWireWind, tickWind } from './wind.js';

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

const ASPHALT  = toonMat('#dcdad6');
const ASPHALT2 = toonMat('#d2d0cc');   // main-road ribbon (slightly darker)
// Warm paper-grey ground — lighter than before so cel bands read as clean manga tones.
const GROUND   = toonMat('#d4cec4');
const CURB     = toonMat('#eceae6');
const PAVING   = toonMat('#e8e5df');   // flagstone sidewalk slab — lighter than road AND ground, so the strip reads
// The kerb RISER: the low vertical face between the raised sidewalk and the road.
// A touch darker so the cel shader lands it a band down from the flat top (reads
// as a shaded curb edge), and DoubleSide so it shows whichever way it's wound as
// the strip runs around the planet.
const KERBFACE = toonMat('#d0cdc7', { side: THREE.DoubleSide });
// GLASS / SHUTTER panes (shared with the item factory) and the foliage geometry
// now live in js/items/materials.js — imported above.
const WIRE     = new THREE.LineBasicMaterial({ color: '#2a2824', transparent: true, opacity: 0.72 });
applyWireWind(WIRE);   // cables bob in the GPU wind (vertex shader — no CPU cost)
const ROOFLINE = new THREE.LineBasicMaterial({ color: '#2a2824' });   // tile / corrugation strokes
// Window / shutter instancing geometry + every house piece (roofs, balcony,
// shopfront, door, AC…) now lives in js/items/house.js — imported above.

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
    this._wireWind = [];   // per-vertex (sway weight, phase) for the GPU wire wind
    this._winXf    = [];   // window transforms [x,y,z,rotY,…] → one InstancedMesh
    this._shutXf   = [];   // shutter transforms
    this.lampHeads = [];   // lamp lens positions [x,y,z,…] → night glow points
    // per-object animators: each is a fn(t, dt) that nudges a LOCAL transform of
    // a child object (a spinning AC fan, a swaying tree crown, a flapping futon).
    // They animate children of already-spherified anchors, so the planet mapping
    // is untouched. main.js drives them via city.update().
    this.animators = [];
    this.rng       = mulberry32(CONFIG.worldSeed);   // fixed seed → same town (and murals) every session

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

    // A couple of water towers as landmarks. The tank is wide (r≈0.95) and sits
    // high (~5m) with cross-braces spanning ±0.75, so a building right next to it
    // pokes into the tank/lattice. Don't just grab the first non-colliding point
    // (that can hug a wall) — sample the town and keep the spot with the MOST
    // clearance from every building, off the main road, so the tank sits free.
    for (let k = 0; k < 2; k++) {
      let chosen = null, bestClr = -Infinity;
      for (let t = 0; t < 200; t++) {
        const x = this._rand(-34, 34), z = this._rand(-34, 34);
        if (this.isColliding(x, z) || this._distToMainRoad(x, z) < 3) continue;
        const clr = this._distToNearestBuilding(x, z);
        if (clr > bestClr) { bestClr = clr; chosen = { x, z }; }
        if (clr > 1.8) break;   // comfortably clear of the tank radius + braces
      }
      if (chosen) this._waterTower(chosen.x, chosen.z);
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

    // World key for persistence: the seed ALONE is not enough — every change
    // to the generator code moves the walls, so murals saved under an older
    // build would anchor to nowhere ("N saved, 0 re-applied"). Fingerprint the
    // actual wall slots (FNV-1a over quantized anchors) and fold it into the
    // seed: town layout changed ⇒ different world ⇒ a fresh shared canvas,
    // and the old rows stay archived in the DB under the old key.
    let h = 0x811c9dc5;
    for (const s of this.wallSlots) {
      const str = `${Math.round(s.px * 100)},${Math.round(s.py * 100)},${Math.round(s.pz * 100)};`;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    }
    this.worldKey = ((CONFIG.worldSeed ^ h) >>> 0);
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

    // The mirrored dark-side town needs its own lit lamps. Transform every
    // (already spherified) north lamp position by the same flip the south group
    // uses, so a glow sits on each dark-side lamp too. atmosphere.setLamps then
    // lights lamps per hemisphere, so only the ones on the night side glow.
    const e = new THREE.Euler(south.rotation.x, south.rotation.y, south.rotation.z);
    const v = new THREE.Vector3();
    const nLamp = this.lampHeads.length;
    for (let i = 0; i < nLamp; i += 3) {
      v.set(this.lampHeads[i], this.lampHeads[i + 1], this.lampHeads[i + 2]).applyEuler(e);
      this.lampHeads.push(v.x, v.y, v.z);
    }
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

  // Drive every registered per-object animator (called once per frame by the
  // app). A shared WIND factor — a slow base breath with an occasional stronger
  // gust — is passed to every animator, so trees, futons and plants all lean
  // into the same gusts instead of each waving to its own private clock.
  update(dt, t) {
    const gust = Math.max(0, Math.sin(t * 0.23) + Math.sin(t * 0.61 + 1.7)) * 0.5;  // 0…1 gust envelope
    const wind = 0.75 + 0.25 * Math.sin(t * 0.9) + gust * 0.9;                      // ~0.5 lull … ~1.9 gust
    const a = this.animators;
    for (let i = 0; i < a.length; i++) a[i](t, dt, wind);
    tickWind(t, wind);   // same gusts drive the GPU wind (wires + leaves)
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

  // Is an oriented plot rectangle clear of every main road? Samples the OBB
  // outline (corners + edge midpoints): the old test only checked the plot
  // CENTRE against the road edge, so wide plots still hung their walls over
  // the carriageway (houses standing on the road). `margin` keeps a kerb gap.
  _obbClearOfRoads(cx, cz, hw, hd, rot, margin = 0.4) {
    for (const [lx, lz] of [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd],[0,-hd],[0,hd],[-hw,0],[hw,0]]) {
      const p = this._toWorld(cx, cz, rot, lx, lz);
      if (this._distToMainRoad(p.x, p.z) < margin) return false;
    }
    return true;
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
    const wpos = [], widx = [];   // flagstone sidewalk slabs along the kerbs
    const kpos = [], kidx = [];   // the raised kerb's vertical riser faces
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
        // wound so the face normal points OUT of the planet (up): the old order
        // faced down, so the ribbon was backface-culled from above and the road
        // paint was invisible except where the sphere curved away
        for (let s = 0; s < N; s++) {
          const o = vi + s * 2;
          idx.push(o, o + 2, o + 1,  o + 1, o + 2, o + 3);
        }
        vi += (N + 1) * 2;
        if (this.rng() < 0.5) {                          // an occasional manhole
          const t = this._rand(0.3, 0.7), off = this._rand(-hw * 0.45, hw * 0.45);
          this._manhole(a.x + dx * t + px * off, a.z + dz * t + pz * off);
        }
        if (this.rng() < 0.55) {                         // a storm-drain grate against the kerb
          const t = this._rand(0.15, 0.85), s2 = this.rng() < 0.5 ? 1 : -1;
          const gx = a.x + dx * t + px * s2 * (hw - 0.4), gz = a.z + dz * t + pz * s2 * (hw - 0.4);
          if (!this.isColliding(gx, gz)) this._drain(gx, gz, Math.atan2(dx, dz));
        }
        // a zebra crossing — only on a flat, central, long-enough straight run so
        // the stripes always land on real asphalt (never spilling onto the curved
        // ground / curb down the planet's side).
        if (painted < 2 && Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) < this.CAP * 0.4 && len > 6) {
          this._crosswalk(spos, sidx, (a.x + b.x) / 2, (a.z + b.z) / 2, dx / len, dz / len, px, pz, hw);
          painted++;
          // bollards guarding the sidewalk at both ends of the crossing
          for (const sb of [-1, 1]) {
            for (const ob of [-0.55, 0.55]) {
              const bx2 = (a.x + b.x) / 2 + px * sb * (hw + 0.36) + (dx / len) * ob;
              const bz2 = (a.z + b.z) / 2 + pz * sb * (hw + 0.36) + (dz / len) * ob;
              if (!this.isColliding(bx2, bz2)) this._bollard(bx2, bz2);
            }
          }
        }
        // a flagstone sidewalk strip along the kerb (its own raised slab + the
        // paving joints, laid only on open ground so it never runs through a building)
        if (Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) < this.CAP * 0.6)
          this._sidewalkPaving(a, dx, dz, len, px, pz, hw, wpos, widx, kpos, kidx);
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
    if (wpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      g.setIndex(widx); g.computeVertexNormals();
      const walk = new THREE.Mesh(g, PAVING);
      walk.receiveShadow = true;
      this.scene.add(walk);
    }
    if (kpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(kpos, 3));
      g.setIndex(kidx); g.computeVertexNormals();
      const kerb = new THREE.Mesh(g, KERBFACE);
      kerb.castShadow = true; kerb.receiveShadow = true;
      this.scene.add(kerb);
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
      sidx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);   // normal up (see _buildRoads)
      base += 4;
    }
  }

  // Raised concrete kerb + gutter along a road segment — modelled on the inked
  // Setagaya reference, not the old "ladder". The strip is a proper RAISED slab:
  //   • a flat top ribbon (PAVING) that sits a step above the road,
  //   • a shaded vertical RISER on the road side (and a short inner face) so the
  //     kerb reads with real depth and the cel shader darkens the face a band,
  //   • a drainage-channel groove hugging the road edge,
  //   • long concrete COVER SLABS: lengthwise edge seams + a cross joint only
  //     every ~1.6 m (wide slabs), plus fine vertical hatch ticks up the riser
  //     for the hand-inked curb shading — no more rungs.
  // Laid only where the strip sits on open ground (never under a building).
  // NOTE: consumes no rng() — geometry only — so the town layout / worldKey is
  // untouched and saved murals still restore.
  _sidewalkPaving(a, dx, dz, len, px, pz, hw, wpos, widx, kpos, kidx) {
    const inA = hw + 0.06;                 // kerb top, road side (the visible face)
    const inB = hw + 0.66;                 // inner edge, against the lots/wall
    const chan = inA + 0.16;               // gutter drainage channel, just off the kerb
    const mid  = (inA + inB) / 2;
    const yGround = 0.0, yRoad = 0.06, ySlab = 0.15;   // slab top a curb-step above the road
    const yInk = ySlab + 0.02, yFoot = yRoad + 0.012;
    const step = 0.8, N = Math.max(1, Math.floor(len / step));
    const v = new THREE.Vector3();
    const pushQuadUp = (buf, x1, z1, x2, z2, x3, z3, x4, z4, y) => {
      const o = buf === wpos ? wpos.length / 3 : 0;
      for (const [qx, qz] of [[x1, z1], [x2, z2], [x3, z3], [x4, z4]]) { planetPoint(qx, y, qz, v, this.R); buf.push(v.x, v.y, v.z); }
      return o;
    };
    // A vertical riser face between an edge line and the surface below it. Wound
    // either way is fine — KERBFACE is DoubleSide.
    const pushRiser = (x1, z1, x2, z2, yTop, yBot) => {
      const o = kpos.length / 3;
      planetPoint(x1, yTop, z1, v, this.R); kpos.push(v.x, v.y, v.z);
      planetPoint(x2, yTop, z2, v, this.R); kpos.push(v.x, v.y, v.z);
      planetPoint(x1, yBot, z1, v, this.R); kpos.push(v.x, v.y, v.z);
      planetPoint(x2, yBot, z2, v, this.R); kpos.push(v.x, v.y, v.z);
      kidx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    };
    for (const s of [-1, 1]) {
      let prev = null, seg = 0;
      for (let i = 0; i <= N; i++) {
        const t = i / N, cx = a.x + dx * t, cz = a.z + dz * t;
        const mx = cx + px * s * mid, mz = cz + pz * s * mid;
        if (this.isColliding(mx, mz)) { prev = null; continue; }
        const ax = cx + px * s * inA, az = cz + pz * s * inA;   // kerb top (road side)
        const bx = cx + px * s * inB, bz = cz + pz * s * inB;   // inner edge
        const hx = cx + px * s * chan, hz = cz + pz * s * chan; // channel line
        if (prev) {
          // flat top ribbon (winding matches the road ribbon so it faces up)
          const o = wpos.length / 3;
          if (s > 0) { pushQuadUp(wpos, prev.bx, prev.bz, prev.ax, prev.az, bx, bz, ax, az, ySlab); }
          else       { pushQuadUp(wpos, prev.ax, prev.az, prev.bx, prev.bz, ax, az, bx, bz, ySlab); }
          widx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
          // road-side riser (slab top → road) and a shorter inner riser (→ ground)
          pushRiser(prev.ax, prev.az, ax, az, ySlab, yRoad);
          pushRiser(prev.bx, prev.bz, bx, bz, ySlab, yGround);
          // lengthwise ink: kerb top edge, kerb foot (at the road), inner edge,
          // and the recessed gutter-channel groove
          this._roofSeg.push(prev.ax, yInk,  prev.az, ax, yInk,  az);
          this._roofSeg.push(prev.ax, yFoot, prev.az, ax, yFoot, az);
          this._roofSeg.push(prev.bx, yInk,  prev.bz, bx, yInk,  bz);
          this._roofSeg.push(prev.hx, yInk,  prev.hz, hx, yInk,  hz);
          // a cover-slab CROSS joint only every other step (~1.6 m) → long slabs
          if (seg % 2 === 0) this._roofSeg.push(ax, yInk, az, bx, yInk, bz);
          seg++;
        }
        prev = { ax, az, bx, bz, hx, hz };
      }
    }
  }

  // A round manhole cover lying tangent on the planet (built post-spherify).
  // A round manhole cover on the road — item factory (furniture.js).
  _manhole(x, z) { createItem(this, 'manhole', { x, z }); }

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
        let hw = Math.max(2.4, (cxr.b - cxr.a) / 2 - this._rand(0.4, 1.1));
        let hd = Math.max(2.4, (czr.b - czr.a) / 2 - this._rand(0.4, 1.1));

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

        // Keep the whole PLOT off the carriageway: shrink it toward its centre
        // until its outline clears every road (junctions included), or drop it.
        let shrink = 0;
        while (!this._obbClearOfRoads(cx, cz, hw, hd, rot) && shrink < 3) { hw *= 0.8; hd *= 0.8; shrink++; }
        if (hw < 2.2 || hd < 2.2 || !this._obbClearOfRoads(cx, cz, hw, hd, rot)) continue;

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

    // Stone kerb apron around the block: a real 3D step (taller than the old
    // 0.12 slab, with a thin lighter cap so the edge catches a highlight) plus
    // ink JOINTS — short vertical ticks down the riser and cross seams on the
    // tread — so it reads as laid stone blocks, not an extruded outline.
    const kw = hw * 2 + 0.5, kd = hd * 2 + 0.5, kh = 0.16;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(kw, kh, kd), CURB);
    curb.position.set(cx, kh / 2, cz); curb.rotation.y = rot; curb.receiveShadow = true;
    this.scene.add(curb);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(kw + 0.04, 0.025, kd + 0.04), toonMat('#f4f2ee'));
    lip.position.set(cx, kh - 0.012, cz); lip.rotation.y = rot; this.scene.add(lip);
    // stone joints along the four kerb faces (batched ink strokes)
    const khw = kw / 2, khd = kd / 2, step = 0.72;
    for (const [ex, ez, tx2, tz2, len] of [
      [0,  khd + 0.01,  1, 0, khw], [0, -khd - 0.01,  1, 0, khw],
      [ khw + 0.01, 0,  0, 1, khd], [-khw - 0.01, 0,  0, 1, khd],
    ]) {
      for (let s = -len + 0.36; s < len - 0.1; s += step) {
        const a = this._toWorld(cx, cz, rot, ex + tx2 * s, ez + tz2 * s);
        this._roofSeg.push(a.x, 0.015, a.z, a.x, kh - 0.02, a.z);          // riser joint
      }
    }

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
    this._facade(cx, cz, rot, hw, hd, H,  0,  1, idx,     shop);  // +local z
    this._facade(cx, cz, rot, hw, hd, H,  0, -1, idx + 1, shop);  // -local z
    this._facade(cx, cz, rot, hw, hd, H,  1,  0, idx + 2, shop);  // +local x
    this._facade(cx, cz, rot, hw, hd, H, -1,  0, idx + 3, shop);  // -local x

    // road-facing door on houses that line the main road, seated on the
    // building's floor datum so the full door height stays visible
    if (door) {
      const f = this._toWorld(cx, cz, rot, door * hw, hd * 0.3);
      const n = this._dir(rot, door, 0);
      this._door(f.x + n.x * 0.05, f.z + n.z * 0.05, Math.atan2(n.x, n.z),
                 this._datumLift(cx, cz, f.x, f.z));
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

  _facade(cx, cz, rot, hw, hd, H, nlx, nlz, seed, shop = false) {
    const half = (nlx !== 0) ? hw : hd;
    const wallLen = ((nlx !== 0) ? hd : hw) * 2;
    const tlx = -nlz, tlz = nlx;                       // tangent (local)
    const n = this._dir(rot, nlx, nlz);
    const rotY = Math.atan2(n.x, n.z);
    const floors = Math.min(3, Math.max(1, Math.round(H / 2.4)));
    const cols   = Math.min(3, Math.max(1, Math.round(wallLen / 2.8)));

    // Decide the balcony BEFORE laying windows: on its floor the wall gets a
    // full-height porta-finestra (built by the balcony itself), so the ordinary
    // instanced windows it would cover are skipped — the opening and the balcony
    // in front of it stay coherent.
    const balcY = 1.4 + (floors - 1) * 2.2 - 1.25;
    const hasBalcony = floors >= 2 && seed % 2 === 0 && balcY > 0.6 && balcY + 1.0 < H;
    const balcW = Math.min(wallLen * 0.82, 4.2);

    for (let f = 0; f < floors; f++) {
      const wy = 1.4 + f * 2.2;
      if (wy + 0.6 > H) continue;
      for (let c = 0; c < cols; c++) {
        const tc = (c - (cols - 1) / 2) * 2.4;
        if (hasBalcony && f === floors - 1 && Math.abs(tc) < balcW / 2) continue;  // porta-finestra instead
        const w = this._toWorld(cx, cz, rot, nlx * half + tlx * tc, nlz * half + tlz * tc);
        const ox = n.x * 0.09, oz = n.z * 0.09;
        const lift = this._datumLift(cx, cz, w.x, w.z);   // back onto the building's floor datum
        // Roller shutters belong to SHOPFRONTS (商店街). On a house they read
        // as a garage door, so residential ground floors keep windows.
        if (shop && f === 0 && (c + seed) % 3 === 0) {
          this._shutXf.push(w.x + ox, 1.05 + lift, w.z + oz, rotY); continue;   // instanced
        }
        this._winXf.push(w.x + ox, wy + lift, w.z + oz, rotY);                  // instanced

        // occasional AC outdoor unit, sitting flush against the wall — with the
        // grille ring + spinning fan blades drawn on its street-facing face
        if (f >= 1 && (c + seed) % 4 === 1) {
          const a = this._toWorld(cx, cz, rot, nlx * (half + 0.11) + tlx * (tc + 0.7), nlz * (half + 0.11) + tlz * (tc + 0.7));
          this._acUnit(a.x, wy - 0.55 + lift, a.z, rotY);
        }
      }
    }
    // one coherent concrete balcony on the upper floor (not per-window planks);
    // it brings its own full-height porta-finestra on the wall behind (the
    // instanced windows there were skipped above).
    if (hasBalcony) this._balcony(cx, cz, rot, nlx, nlz, tlx, tlz, half, wallLen, rotY, balcY, seed);
    // drainpipe + base plants on the street side (pipe rides the floor datum so
    // its top meets the eaves like the rest of the facade)
    const e = this._toWorld(cx, cz, rot, nlx * half + tlx * (wallLen / 2 - 0.3), nlz * half + tlz * (wallLen / 2 - 0.3));
    const pipe = inkedMesh(new THREE.CylinderGeometry(0.06, 0.06, H, 6), '#bcbab6', { k: 1.08, cast: false });
    pipe.position.set(e.x + n.x * 0.08, H / 2 + this._datumLift(cx, cz, e.x, e.z), e.z + n.z * 0.08); this.scene.add(pipe);
    if ((seed % 2) === 0) {
      const pb = this._toWorld(cx, cz, rot, nlx * (half + 0.5), nlz * (half + 0.5));
      this._pottedPlant(pb.x, pb.z, 0.7 + (seed % 3) * 0.16);
      // lush overhanging greenery along the wall (the alleys are overgrown)
      if (this.rng() < 0.6) this._vine(e.x + n.x * 0.16, e.z + n.z * 0.16, 2.8 + this.rng() * 2.4);
      if (this.rng() < 0.3) this._bush(pb.x, pb.z, 0.6 + this.rng() * 0.35);
    }
  }

  // A detailed street door (玄関): a light concrete surround (jambs + lintel), a
  // dark timber slab split into two leaves with recessed panels, a frosted glass
  // light near the top, a handle and a low threshold step. Built as a small group
  // (doors are few) and spherified onto the planet like any prop.
  // Detailed street door (玄関) — item factory (house.js). `lift` re-seats it
  // on the building's floor datum (see _datumLift).
  _door(x, z, rotY, lift = 0) { createItem(this, 'door', { x, z, rotY, lift }); }

  // An air-conditioner outdoor unit (室外機), modelled on a Mitsubishi Electric
  // split-system condenser: a wide, low cream box whose FRONT face is dominated
  // by one big circular fan grille — a recessed dish behind a static spoked guard
  // with concentric rings, with the fan blades spinning behind it. The left flank
  // carries the vertical louvre slats of the heat-exchanger vent. A lipped top lid
  // and two feet finish it. The body is spherified like any prop; only the fan
  // (a child group) is animated, so the planet mapping is never disturbed.
  // AC outdoor unit (室外機) — built by the item factory (js/items/props.js).
  _acUnit(x, y, z, rotY) { createItem(this, 'acUnit', { x, y, z, rotY }); }

  // Concrete balcony + porta-finestra + wind-flapped futons — item factory (house.js).
  _balcony(cx, cz, rot, nlx, nlz, tlx, tlz, half, wallLen, rotY, y, seed) {
    createItem(this, 'balcony', { cx, cz, rot, nlx, nlz, tlx, tlz, half, wallLen, rotY, y, seed });
  }

  // Shopfront (kanban + awning + blade sign) — item factory (house.js).
  _shopfront(cx, cz, rot, nlx, nlz, hw, hd, H, seed) {
    createItem(this, 'shopfront', { cx, cz, rot, nlx, nlz, hw, hd, H, seed });
  }

  // Rooftop billboard (屋上看板) — item factory (house.js).
  _roofSign(cx, cz, rot, nlx, nlz, hw, hd, H, seed) {
    createItem(this, 'roofSign', { cx, cz, rot, nlx, nlz, hw, hd, H, seed });
  }

  // ── Poles + organic overhead wire net ─────────────────────────────────────
  _buildPolesAndWires() {
    const W = CONFIG.wires ?? {};
    const neighbors = W.neighbors ?? 2;
    const maxSpan   = (W.maxSpan ?? 14) ** 2;
    const heights   = W.heights ?? [7.8];
    const scatter   = W.poleScatter ?? 28;
    const roadStep  = W.roadStep ?? 0.58;
    const shopStep  = W.shopStep ?? 0.46;
    // poles strung along the main roads + a scatter on open ground. The shopping
    // street gets a denser run of poles (finer spacing) for its tangled cable net.
    for (const r of this.mainRoads) {
      const step = (r === this.shopRoad) ? shopStep : roadStep;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        // Offset PERPENDICULAR to the road (one consistent flank), so poles line
        // the curb instead of standing in the carriageway. The old `+ r.half` on
        // x alone assumed every road ran north–south, dumping poles mid-road on
        // any east–west or diagonal stretch. `r.half` = road half-width; +0.6
        // clears the stone curb.
        const ox = (dz / len) * (r.half + 0.6), oz = (-dx / len) * (r.half + 0.6);
        for (let t = 0; t < 1; t += step) {
          const x = a.x + dx * t + ox;
          const z = a.z + dz * t + oz;
          if (Math.hypot(x, z) > this.CAP) continue;
          if (!this.isColliding(x, z) && Math.abs(x) < this.HALF && Math.abs(z) < this.HALF)
            { this._pole(x, z, 8.6, this.rng() < 0.3); this.poles.push({ x, z }); }
        }
      }
    }
    for (let k = 0; k < scatter; k++) {
      const x = this._rand(-this.HALF, this.HALF), z = this._rand(-this.HALF, this.HALF);
      if (Math.hypot(x, z) > this.CAP) continue;
      if (!this.isColliding(x, z) && this._distToMainRoad(x, z) > 2) { this._pole(x, z, 8.4, this.rng() < 0.2); this.poles.push({ x, z }); }
    }
    // wire each pole to its nearest neighbours — kept sparse so cables don't dominate the panel
    for (let i = 0; i < this.poles.length; i++) {
      const a = this.poles[i];
      const near = this.poles
        .map((p, j) => ({ j, d: (p.x - a.x) ** 2 + (p.z - a.z) ** 2 }))
        .filter(o => o.j !== i && o.d < maxSpan).sort((u, v) => u.d - v.d).slice(0, neighbors);
      for (const o of near) {
        if (o.j < i) continue;
        const b = this.poles[o.j];
        for (const h of heights) this._wire(a.x, h, a.z, b.x, h, b.z, 0.45);
      }
    }
    // Street lamps set just outside the houses (against them, by the curb —
    // never mid-lane), lighting the lanes at night. DENSE: two passes over the
    // buildings (both flanks get a chance) plus a run along the main roads, so
    // the whole town is dotted with lamps — and the mirrored dark-side copy
    // inherits every one of them, all lit.
    let lamps = 0;
    for (let pass = 0; pass < 2 && lamps < 56; pass++) {
      for (const bld of this.buildings) {
        if (lamps >= 56) break;
        if (this.rng() > 0.7) continue;
        const sgn = (pass === 0) === (this.rng() < 0.5) ? 1 : -1;
        const f = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.7), bld.hd * (this.rng() - 0.5));
        if (this.isColliding(f.x, f.z)) continue;
        const n = this._dir(bld.rot, sgn, 0);               // outward = toward the street
        this._lamppost(f.x, f.z, Math.atan2(n.x, n.z)); lamps++;
      }
    }
    // and a sparse run along the main roads (opposite flank from the poles) —
    // same perpendicular offset, negated, so they hug the OTHER curb
    for (const r of this.mainRoads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        if (this.rng() > 0.5) continue;
        const a = r.pts[i], b = r.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const t = this._rand(0.25, 0.75);
        const x = a.x + dx * t - (dz / len) * (r.half + 0.5);
        const z = a.z + dz * t - (-dx / len) * (r.half + 0.5);
        if (Math.hypot(x, z) > this.CAP || this.isColliding(x, z)) continue;
        const nr = this._nearestRoad(x, z);
        this._lamppost(x, z, Math.atan2(nr.px - x, nr.pz - z));
      }
    }
  }

  // A cobra-head street lamp: the arm + head reach OUT toward the street (along
  // `ang`) and the lamp shines down onto the lane. Lens position is recorded
  // for the night glow + ground pool.
  // Cobra-head street lamp (registers a night-glow head) — item factory.
  _lamppost(x, z, ang = 0) { createItem(this, 'lamppost', { x, z, ang }); }

  // ── Collision (buildings = OBB; props = circles; barriers = OBB) ──────────
  // `extra` widens the clearance beyond charRadius. The pilot passes ~0.14:
  // buildings are rigid boxes tangent at their own centre, so near the ground
  // their walls LEAN up to ~0.15 outside the flat footprint this test uses —
  // without the margin KAI could hug a wall at charRadius and his shoulder/arm
  // visually sank into the leaning plaster.
  // ── Torus wrap (Pac-Man) ──────────────────────────────────────────────────
  // The town's flat square has its opposite edges identified: KAI leaving one
  // side re-enters the other, so there's no wall on the little planet — he can
  // walk all the way right and come out the left. These give the SHORTEST signed
  // delta / distance across that seam, and canonicalise a point back into
  // [-HALF, HALF). Collision, steering and arrival all reckon distance this way.
  _wrapDelta(d) { const W = this.HALF * 2; return d - W * Math.round(d / W); }
  toroidalDist(ax, az, bx, bz) { return Math.hypot(this._wrapDelta(ax - bx), this._wrapDelta(az - bz)); }
  wrapPoint(p) {
    const W = this.HALF * 2;
    if (p.x >  this.HALF) p.x -= W; else if (p.x < -this.HALF) p.x += W;
    if (p.z >  this.HALF) p.z -= W; else if (p.z < -this.HALF) p.z += W;
    return p;
  }

  isColliding(x, z, extra = 0) {
    const r = CONFIG.charRadius + extra;
    const wd = d => this._wrapDelta(d);   // measure across the seam, not around the map
    for (const b of this.buildings) {
      const dx = wd(x - b.cx), dz = wd(z - b.cz);
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + r && Math.abs(lz) < b.hd + r) return true;
    }
    // round props: poles, trees, bushes, water towers
    for (const o of this.colliders) {
      const dx = wd(x - o.x), dz = wd(z - o.z), rr = o.r + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    // thin barriers: fences + low garden walls (oriented boxes)
    for (const b of this.barriers) {
      const dx = wd(x - b.cx), dz = wd(z - b.cz);
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.hw + r && Math.abs(lz) < b.hd + r) return true;
    }
    return false;
  }

  // returns roof height at (x,z) inside a footprint, else 0 — for camera collision
  hitsBuilding(x, z) {
    for (const b of this.buildings) {
      const dx = this._wrapDelta(x - b.cx), dz = this._wrapDelta(z - b.cz);
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

  // Ground-floor datum lift. A building is a RIGID box tangent to the planet at
  // its own centre (cx,cz); with the marked curvature the surface falls away
  // under its edges by the sagitta, so the base is extended downward to meet it
  // (_spherifyIndividuals). But facade fittings (doors, windows, shutters,
  // balconies, signs) are placed at heights measured from the LOCAL surface at
  // their own (x,z) — which near a wall sits that same sagitta BELOW the
  // building's ground-floor datum. Result: the whole ground floor looked
  // squashed, half-swallowed by the plinth. This returns the elevation of the
  // building's tangent datum above the local surface at (x,z): add it to any
  // facade element's flat height and it lands back on the floor it was
  // designed on.
  _datumLift(cx, cz, x, z) {
    const d = Math.min(Math.hypot(x - cx, z - cz), this.R * 0.6);
    return this.R * (1 / Math.cos(d / this.R) - 1);
  }

  // Edge distance from (x,z) to the nearest building OBB (negative if inside).
  // Used to place bulky landmarks (the water tower) well clear of every building.
  _distToNearestBuilding(x, z) {
    let best = Infinity;
    for (const b of this.buildings) {
      const dx = x - b.cx, dz = z - b.cz;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = Math.abs(dx * c - dz * s) - b.hw;
      const lz = Math.abs(dx * s + dz * c) - b.hd;
      const d = (lx > 0 && lz > 0) ? Math.hypot(lx, lz) : Math.max(lx, lz);
      if (d < best) best = d;
    }
    return best;
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
      // A point ahead can fall OFF the edge — that's fine now: wrap it back onto
      // the opposite side so "keep walking straight" carries KAI Pac-Man-style
      // across the seam instead of turning him around at an invisible wall.
      const p = this.wrapPoint({ x: x + Math.sin(ang) * dist, z: z + Math.cos(ang) * dist });
      if (!this.isColliding(p.x, p.z)) return p;
    }
    return this.randomReachablePoint();
  }

  approachPoint(slot) {
    return { x: slot.px + slot.nx * CONFIG.approachOffset, z: slot.pz + slot.nz * CONFIG.approachOffset };
  }
  isApproachFree(slot) { const p = this.approachPoint(slot); return !this.isColliding(p.x, p.z); }
  // Is the space in FRONT of this wall clear enough to frame a mural cleanly?
  // Probe a small fan out along the outward normal (and ±~17°); a neighbouring
  // building in that cone means the admire camera can't get a clean head-on shot
  // of the finished piece. (The admire cam uses the same test to decide whether
  // to stay head-on or swing past a neighbour.)
  frontageOpen(slot) {
    for (const a of [0, 0.3, -0.3]) {
      const nx = slot.nx * Math.cos(a) - slot.nz * Math.sin(a);
      const nz = slot.nx * Math.sin(a) + slot.nz * Math.cos(a);
      for (let d = 2.0; d <= 6.0; d += 1.0) {
        if (this.hitsBuilding(slot.px + nx * d, slot.pz + nz * d) > 0) return false;
      }
    }
    return true;
  }
  // Pick a free wall to paint. Prefer ones with clear frontage (the mural frames
  // cleanly when admired) and NEAR `from` (the town is big — a random wall is
  // often minutes away), with a little variety among the nearest. Falls back to
  // any free wall so KAI never runs out of things to paint.
  pickFreeSlot(from) {
    const free = this.wallSlots.filter(s => !s.used && this.isApproachFree(s));
    if (!free.length) return null;
    const open = free.filter(s => this.frontageOpen(s));
    const pool = open.length ? open : free;
    if (!from) return pool[(Math.random() * pool.length) | 0];
    pool.sort((a, b) =>
      ((a.px - from.x) ** 2 + (a.pz - from.z) ** 2) - ((b.px - from.x) ** 2 + (b.pz - from.z) ** 2));
    return pool[(Math.random() * Math.min(pool.length, 6)) | 0];
  }
  allWallsUsed() { return this.wallSlots.every(s => s.used); }

  // ── KAI's local pilot ──────────────────────────────────────────────────────
  // He KNOWS the town (buildings / props / fences through isColliding) and
  // senses it WELL ahead with whiskers at fixed world distances — not one
  // frame-step (~5cm) like before, which is why he used to walk face-first
  // into plaster and jink away at the last frame.
  //
  //   • WHISKERS: centre probes 0.8 and 1.7 out along the heading, plus a left
  //     and a right feeler at ±24° — an approaching wall registers metres early.
  //   • PERSISTENT HEADING, turned toward the target at a limited rad/s rate:
  //     course corrections are gentle continuous arcs, never snaps.
  //   • SIDE HYSTERESIS: the moment something shows up ahead he commits to
  //     rounding it on ONE side (whichever feeler is free) and keeps that side
  //     until both flanks clear — no left/right flip-flopping between frames.
  //   • the actual step stays collision-guarded: if even the corrected heading
  //     would clip, he arcs further to his chosen side — he can slide along a
  //     wall but never through it.
  //
  // `st` is the caller's persistent nav state ({h: heading, side: -1|0|1});
  // the Agent owns one and passes it every frame.
  steer(pos, target, step, st = {}) {
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const dt = Math.max(step / (CONFIG.moveSpeed || 3.2), 1e-4);   // step → seconds
    // MEANDER: a slow random drift of the desired course (a mean-reverting
    // random walk, Math.random so no two strolls ever repeat), faded out near
    // the target so arrivals stay clean. The whiskers below still guard every
    // step, so the wandering can never push him into a wall — it just makes
    // the walk read curious instead of surveyed.
    // Aim by the SHORTEST route across the torus: if the target is quicker over a
    // seam, head for the seam (and KAI Pac-Mans across) instead of trekking back
    // over the whole map.
    const tdx = this._wrapDelta(target.x - pos.x), tdz = this._wrapDelta(target.z - pos.z);
    const distT = Math.hypot(tdx, tdz);
    st.bias = clamp((st.bias ?? 0) + (Math.random() - 0.5) * 2.4 * dt, -0.6, 0.6);
    st.bias *= Math.max(0, 1 - 0.25 * dt);
    const desired = Math.atan2(tdx, tdz)
                  + st.bias * clamp((distT - 2) / 6, 0, 1);
    let h = st.h ?? desired;

    const freeAt = (a, d) => !this.isColliding(pos.x + Math.sin(a) * d, pos.z + Math.cos(a) * d, 0.14);
    const nearF  = freeAt(h, 0.8);
    const farF   = freeAt(h, 1.7);
    const leftF  = freeAt(h + 0.42, 1.15);
    const rightF = freeAt(h - 0.42, 1.15);

    // pick / release the avoidance side (hysteresis)
    if (!nearF || !farF) {
      if (!st.side) st.side = leftF === rightF ? (freeAt(h + 1.0, 1.3) ? 1 : -1) : (leftF ? 1 : -1);
    } else if (st.side && leftF && rightF) {
      st.side = 0;                       // ahead + both flanks clear → back on the goal line
    }

    // steering command: gentle pull toward the target + pushes from the whiskers
    let turn = clamp(wrap(desired - h), -2.4 * dt, 2.4 * dt);
    if (st.side) {
      if (!farF)  turn += st.side * 2.2 * dt;   // something coming up → start bending now
      if (!nearF) turn += st.side * 4.5 * dt;   // close → bend hard
    }
    if (!leftF)  turn -= 2.6 * dt;              // a flank grazing a wall → ease off it
    if (!rightF) turn += 2.6 * dt;
    h = wrap(h + clamp(turn, -5.0 * dt, 5.0 * dt));

    // collision-guarded step: arc further to the chosen side if the frame's
    // move would clip (slide along the wall, never into it)
    const side = st.side || 1;
    for (let k = 0; k < 10; k++) {
      const a = wrap(h + side * k * 0.22);
      const nx = pos.x + Math.sin(a) * step, nz = pos.z + Math.cos(a) * step;
      if (!this.isColliding(nx, nz, 0.14)) {
        pos.x = nx; pos.z = nz; this.wrapPoint(pos); st.h = a;
        return { x: Math.sin(a), z: Math.cos(a) };
      }
    }
    st.h = undefined; st.side = 0;              // boxed in — let the agent pick a new plan
    return null;
  }

  // ── Detail builders (all delegate to js/items/house.js) ───────────────────
  _hipRoof(x, z, w, d, h, rot)                { createItem(this, 'hipRoof', { x, z, w, d, h, rot }); }
  _gableRoof(cx, cz, hw, hd, rot, H)          { createItem(this, 'gableRoof', { cx, cz, hw, hd, rot, H }); }
  _roofTiles(cx, cz, rot, H, hw, hd, hip, rh = 0, halfSpan = 0, len = 0) {
    createItem(this, 'roofTiles', { cx, cz, rot, H, hw, hd, hip, rh, halfSpan, len });
  }
  _corrugated(cx, cz, rot, y, hw, hd)         { createItem(this, 'corrugated', { cx, cz, rot, y, hw, hd }); }

  // Wooden board fence (板塀) across the front of a plot.
  // Board fence (板塀) around an open lot — item factory.
  _plankFence(cx, cz, rot, hw, hd) { createItem(this, 'plankFence', { cx, cz, rot, hw, hd }); }

  // Horizontal wood-siding seams (板張り) — item factory (house.js).
  _sidingLines(cx, cz, rot, hw, hd, H) { createItem(this, 'sidingLines', { cx, cz, rot, hw, hd, H }); }

  // Elevated spherical water tank on a lattice tower — a Shōwa rooftop landmark.
  // Elevated water tank on a lattice tower (landmark) — item factory.
  _waterTower(x, z) { createItem(this, 'waterTower', { x, z }); }
  // Utility pole + cross-arms (+ transformer) — item factory (infrastructure.js).
  _pole(x, z, h, transformer = false) { createItem(this, 'pole', { x, z, h, transformer }); }
  // A sagging overhead cable (batched into _wireSeg) — item factory.
  _wire(x0, y0, z0, x1, y1, z1, sag) { createItem(this, 'wire', { x0, y0, z0, x1, y1, z1, sag }); }

  // Merge every batched stroke into a single LineSegments per material — turns
  // hundreds of one-segment Line draw calls into two.
  _finalizeLines() {
    const v = new THREE.Vector3();
    const build = (arr, mat, wind) => {
      if (!arr.length) return;
      // map every endpoint onto the planet (segments become short chords)
      for (let i = 0; i < arr.length; i += 3) {
        planetPoint(arr[i], arr[i + 1], arr[i + 2], v, this.R);
        arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      if (wind?.length) g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
      this.scene.add(new THREE.LineSegments(g, mat));
    };
    build(this._roofSeg, ROOFLINE);
    build(this._wireSeg, WIRE, this._wireWind);   // cables sway in the GPU wind
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
    make(SILL_GEO, SILL_MAT, this._winXf);     // concrete sill ledge under the sash
    make(FRAME_GEO, FRAME_MAT, this._winXf);   // sash frame behind each pane
    make(WIN_GEO, GLASS, this._winXf);
    make(MUNTIN_GEO, MUNTIN_MAT, this._winXf); // muntin cross → four panes of glass
    make(SHU_GEO, SHUTTER, this._shutXf);
    make(SLAT_GEO, SLAT_MAT, this._shutXf);    // horizontal slats → inked roller shutter
  }
  // ── Greenery: delegated to the parametric item factory (js/items/nature.js) ─
  // city.js owns LAYOUT (where things go); the factory owns the MESH of each item.
  _pottedPlant(x, z, s = 1) { createItem(this, 'plant', { x, z, scale: s }); }
  _leaf(x, y, z, r, tone)   { return createItem(this, 'leaf', { x, y, z, r, tone }); }
  _vine(x, z, h)            { createItem(this, 'vine', { x, z, height: h }); }
  _bush(x, z, s)            { createItem(this, 'bush', { x, z, scale: s }); }
  _bigTree(x, z)            { createItem(this, 'tree', { x, z }); }
  // Rooftop TV antenna — item factory.
  _antenna(x, baseY, z) { createItem(this, 'antenna', { x, baseY, z }); }

  // ── Street set dressing taken from the reference alleys ───────────────────
  // Parked bicycles by the walls, vertical shop banners (幟), concrete planter
  // boxes, and a few road signs. Counts are capped and collisions checked so
  // the lanes stay walkable.
  _buildStreetProps() {
    const S = CONFIG.shop || {};
    let bikes = 0, banners = 0, planters = 0, signs = 0,
        vending = 0, scooters = 0, cars = 0, cones = 0, mirrors = 0, benches = 0,
        crates = 0, trash = 0, postboxes = 0;
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
      // a public bench set against the wall, facing the lane
      if (benches < 6 && r > 0.52 && r < 0.74) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.7), along);
        if (!this.isColliding(p.x, p.z) && this._distToMainRoad(p.x, p.z) > 1.0) {
          this._bench(p.x, p.z, outAng + Math.PI, 1.1 + this.rng() * 0.5); benches++; continue;
        }
      }
      // stacked bottle crates against a shop flank (deliveries waiting)
      if (crates < (S.crateMax ?? 6) && isShop && r >= 0.74 && r < 0.86) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.55), along);
        if (!this.isColliding(p.x, p.z)) { this._crates(p.x, p.z, outAng); crates++; continue; }
      }
      // a refuse point (lidded bins + bags) tucked against a house flank
      if (trash < (S.trashMax ?? 5) && r >= 0.86) {
        const p = this._toWorld(bld.cx, bld.cz, bld.rot, sgn * (bld.hw + 0.55), along);
        if (!this.isColliding(p.x, p.z) && this._distToMainRoad(p.x, p.z) > 0.8) {
          this._trashPoint(p.x, p.z, outAng); trash++; continue;
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

    // a couple of round post boxes by the shopping street, slot facing the road
    const pbRoad = this.shopRoad ?? this.mainRoads[0];
    for (let k = 0; k < 60 && postboxes < 2; k++) {
      const x = this._rand(-this.HALF, this.HALF), z = this._rand(-this.HALF, this.HALF);
      if (Math.hypot(x, z) > this.CAP * 0.8) continue;
      const d = this._distToRoad(pbRoad, x, z);
      if (d < 0.5 || d > 1.8 || this.isColliding(x, z)) continue;
      const nr = this._nearestRoad(x, z);
      this._postbox(x, z, Math.atan2(nr.px - x, nr.pz - z)); postboxes++;
    }
  }

  // A parked bicycle, seen side-on (its face turned toward the street).
  _bicycle(x, z, ang) { createItem(this, 'bicycle', { x, z, ang }); }

  // A vertical shop banner (幟) on a thin pole, facing the street.
  // Vertical shop banner (幟) — item factory.
  _nobori(x, z, ang) { createItem(this, 'nobori', { x, z, ang }); }

  // A rectangular concrete planter box with shrubs, lining the lane.
  // Concrete planter box with shrubs — item factory.
  _planterBox(x, z, ang) { createItem(this, 'planterBox', { x, z, ang }); }

  // A triangular warning road sign on a pole, facing the street.
  // Triangular warning road sign — item factory.
  _roadSign(x, z, ang) { createItem(this, 'roadSign', { x, z, ang }); }

  // ── Reference street dressing: vending machines, mirrors, cones, vehicles ──

  _vendingMachine(x, z, ang) { createItem(this, 'vending', { x, z, ang }); }

  // A convex traffic mirror (カーブミラー) on a pole at a junction, facing back
  // down the road. The dark frame + pale disc read in B&W.
  // Convex traffic mirror (カーブミラー) — item factory.
  _curveMirror(x, z, ang) { createItem(this, 'curveMirror', { x, z, ang }); }

  _trafficCone(x, z) { createItem(this, 'cone', { x, z }); }

  // A low concrete bollard (車止め) at a crossing — item factory.
  _bollard(x, z) { createItem(this, 'bollard', { x, z }); }

  // A kerbside storm-drain grate — item factory.
  _drain(x, z, ang) { createItem(this, 'drain', { x, z, ang }); }

  // A cylindrical post box (郵便ポスト) — item factory.
  _postbox(x, z, ang) { createItem(this, 'postbox', { x, z, ang }); }

  // A refuse point: lidded bins + garbage bags — item factory.
  _trashPoint(x, z, ang) { createItem(this, 'trashPoint', { x, z, ang }); }

  // Stacked bottle crates by a shop — item factory.
  _crates(x, z, ang) { createItem(this, 'crates', { x, z, ang }); }

  // A public bench against a wall (length parametric).
  _bench(x, z, ang, length) { createItem(this, 'bench', { x, z, ang, length }); }

  // An A-frame barricade (single-A sawhorse) with a striped board.
  // A-frame barricade with a striped board — item factory.
  _aFrameBarrier(x, z, ang) { createItem(this, 'aFrameBarrier', { x, z, ang }); }

  // A parked kei-car (軽自動車) along the kerb, modelled on the tall, square
  // "kei box" body (e.g. the BYD RACCO). The SHAPE is smooth and rounded — the
  // whole shell is one volume, a side-profile Shape extruded across the width
  // with a generous bevel so every edge is filleted (no facets), with
  // high-segment round wheels — but it is SHADED in the manga style of the rest
  // of the town: cel banding + surface hatching (toonMat) and an inverted-hull
  // ink contour. Length runs along local X (front at +X), width along Z.
  // Parked kei-car (軽自動車) — item factory.
  _keiCar(x, z, ang) { createItem(this, 'keiCar', { x, z, ang }); }

  // A parked scooter / moped against a wall.
  // Parked scooter / moped — item factory.
  _scooter(x, z, ang) { createItem(this, 'scooter', { x, z, ang }); }

}

// distance from point to segment
function segDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}
