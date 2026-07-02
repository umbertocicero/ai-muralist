import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat, inkedMesh, addInk } from '../toon.js';
import { GLASS } from './materials.js';

// ===========================================================================
//  House — everything that belongs to a building: window/shutter geometry for
//  the town-wide instancing, roofs (gable / hip / tiles / corrugated), wood
//  siding seams, the balcony (with its full-height door-window and the futon
//  draped over the rail), the shopfront + rooftop signboards, the detailed
//  genkan door and the AC outdoor unit.
//
//  city.js keeps the LAYOUT (where a house stands, how tall, which face gets
//  what); this module owns the MESH of each piece, same factory contract as the
//  other item modules: makeX(ctx, opts).
// ===========================================================================

// ── Window / shutter instancing geometry ────────────────────────────────────
// One window = pane + sash frame + muntin cross + sill, all instanced with the
// same per-window transforms so the whole town's glazing is a few draw calls.
export const WIN_GEO  = new THREE.PlaneGeometry(1.0, 1.2);
// A dark sash FRAME drawn just behind each window pane (slightly larger), so a
// border of frame shows around the glass. Less-negative polygonOffset than
// GLASS so the pane always sits in front of it.
export const FRAME_GEO = new THREE.PlaneGeometry(1.22, 1.46);
export const FRAME_MAT = new THREE.MeshBasicMaterial({ color: '#3a3631', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

// A window GRID (格子): thin muntin bars that split the pane into four lights —
// one vertical + one horizontal bar as a single flat cross, drawn just in front
// of the glass, plus top/bottom rails.
function crossGeometry(w, h, t) {
  const hw = w / 2, hh = h / 2, ht = t / 2;
  const quad = (x0, y0, x1, y1) => [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0];
  const pos = [
    ...quad(-ht, -hh, ht, hh),                 // vertical muntin
    ...quad(-hw, -0.06, hw, 0.06),             // horizontal muntin (a touch above centre)
    ...quad(-hw, hh - 0.05, hw, hh + 0.02),    // top rail
    ...quad(-hw, -hh - 0.02, hw, -hh + 0.05),  // bottom rail
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
export const MUNTIN_GEO = crossGeometry(1.0, 1.2, 0.06);
// LIGHT glazing bars (white-ish sash), so the panes read clearly against the
// dark glass — dark bars on dark glass were invisible.
export const MUNTIN_MAT = new THREE.MeshBasicMaterial({ color: '#e7e4dd', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
// a protruding concrete sill just under the sash (geometry baked below + outward)
export const SILL_GEO = new THREE.BoxGeometry(1.24, 0.08, 0.16);
SILL_GEO.translate(0, -0.78, 0.07);
export const SILL_MAT = new THREE.MeshBasicMaterial({ color: '#d7d3cb' });

// Roller shutter (シャッター) pane…
export const SHU_GEO = new THREE.PlaneGeometry(1.5, 1.9);
// …with horizontal SLATS drawn over it — the ribbed lines are what make a
// closed Japanese shop shutter read instantly in an inked manga panel. One flat
// geometry of thin dark quads, instanced with the same shutter transforms.
function slatGeometry(w, h, step, t) {
  const hw = w / 2, pos = [];
  const quad = (y) => pos.push(-hw, y - t, 0, hw, y - t, 0, hw, y + t, 0, -hw, y - t, 0, hw, y + t, 0, -hw, y + t, 0);
  for (let y = -h / 2 + step; y < h / 2 - 0.03; y += step) quad(y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
export const SLAT_GEO = slatGeometry(1.44, 1.9, 0.17, 0.012);
export const SLAT_MAT = new THREE.MeshBasicMaterial({ color: '#6e6b66', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

// ── Roof geometry helpers ───────────────────────────────────────────────────
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

// A SOFT draped cloth (futon / blanket over a balcony rail). A thin double-sided
// shell shaped so it reads as fabric, not a plank: it bellies out in the middle,
// runs in a few gentle vertical folds, rounds forward into a lip where it bends
// over the rail at the top, and has a wavy, slightly-sagging hem at the bottom.
// Local origin is the TOP centre (at the rail); +y is up, the cloth hangs to -y,
// +z is the outward (street) side. Each `seed` gives a different fold pattern.
function drapedClothGeometry(w, h, {
  depth = 0.045, nx = 18, ny = 16, nfolds = 3,
  foldAmp = 0.04, bellyAmp = 0.06, lipAmp = 0.06,
  hemSag = 0.05, hemWave = 0.028, seed = 0,
} = {}) {
  const ph = seed * 1.7;
  // outward (+z) offset of the cloth's mid-surface at (u in 0..1 across, v in 0..1 down)
  const zMid = (u, v) => {
    const belly = bellyAmp * Math.sin(Math.min(v, 1) * Math.PI);                 // bulge out mid-height
    const folds = foldAmp * Math.sin(u * Math.PI * 2 * nfolds + ph) * (0.35 + 0.65 * v); // vertical folds, fuller low
    const lip   = lipAmp * Math.exp(-(v * v) / (2 * 0.08 * 0.08));               // rounded fold-over lip at the rail
    return belly + folds + lip;
  };
  const yAt = (u, v) => {
    const hemT = Math.max(0, (v - 0.55) / 0.45);                                 // 0 until 55% down, 1 at the hem
    const s = hemT * hemT * (3 - 2 * hemT);                                      // smoothstep so the hem eases in
    // a gentle overall droop (deeper toward the centre) + a soft fold-tied ripple
    const droop  = hemSag * Math.sin(u * Math.PI) * 0.7;
    const ripple = hemWave * Math.cos(u * Math.PI * 2 * nfolds + ph);
    return -v * h - (hemSag * 0.4 + droop + ripple) * s;
  };
  const xAt = (u) => (u - 0.5) * w;

  const cols = nx + 1, rows = ny + 1;
  const id = (side, i, j) => side * cols * rows + j * cols + i;
  const pos = [];
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 0.5 : -0.5;
    for (let j = 0; j < rows; j++) {
      const v = j / ny;
      for (let i = 0; i < cols; i++) { const u = i / nx; pos.push(xAt(u), yAt(u, v), zMid(u, v) + depth * sgn); }
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = id(0, i, j), b = id(0, i + 1, j), c = id(0, i + 1, j + 1), d = id(0, i, j + 1);
    idx.push(a, c, b, a, d, c);                                                  // front (+z)
    const e = id(1, i, j), f = id(1, i + 1, j), g = id(1, i + 1, j + 1), k = id(1, i, j + 1);
    idx.push(e, f, g, e, g, k);                                                  // back (-z)
  }
  const seam = (a, b, c, d) => idx.push(a, c, b, a, d, c);                       // close the perimeter
  for (let i = 0; i < nx; i++) seam(id(0, i, 0),  id(1, i, 0),  id(1, i + 1, 0),  id(0, i + 1, 0));   // top
  for (let i = 0; i < nx; i++) seam(id(1, i, ny), id(0, i, ny), id(0, i + 1, ny), id(1, i + 1, ny));  // hem
  for (let j = 0; j < ny; j++) seam(id(1, 0, j),  id(0, 0, j),  id(0, 0, j + 1),  id(1, 0, j + 1));   // left
  for (let j = 0; j < ny; j++) seam(id(0, nx, j), id(1, nx, j), id(1, nx, j + 1), id(0, nx, j + 1));  // right

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ── Roofs ───────────────────────────────────────────────────────────────────
// Hip roof: a 4-sided cone + dark eave slab.
export function makeHipRoof(ctx, { x, z, w, d, h, rot }) {
  const oh = 0.4, rH = 0.9 + Math.min(w, d) * 0.13, dia = Math.hypot(w + oh * 2, d + oh * 2) * 0.5;
  const cone = inkedMesh(new THREE.ConeGeometry(dia, rH, 4), '#26241f', { k: 1.03 });
  cone.position.set(x, h + rH / 2, z); cone.rotation.y = rot + Math.PI / 4; ctx.scene.add(cone);
  const eave = inkedMesh(new THREE.BoxGeometry(w + oh * 2, 0.16, d + oh * 2), '#1a1814', { k: 1.04 });
  eave.position.set(x, h + 0.08, z); eave.rotation.y = rot; ctx.scene.add(eave);
}

// Gable (spioventi) roof — triangular prism + ridge beam + tiled slopes.
export function makeGableRoof(ctx, { cx, cz, hw, hd, rot, H }) {
  const oh = 0.4;
  const halfSpan = hw + oh;
  const len = hd * 2 + oh * 2;
  const rh = 0.6 + Math.min(hw, hd) * 0.42;
  const mat = toonMat('#3a3833', { side: THREE.DoubleSide });
  const roof = new THREE.Mesh(gableGeometry(halfSpan, rh, len), mat);
  roof.castShadow = true; addInk(roof, 1.02);
  roof.position.set(cx, H, cz); roof.rotation.y = rot;
  ctx.scene.add(roof);
  // ridge beam
  const ridge = inkedMesh(new THREE.BoxGeometry(0.1, 0.12, len), '#1a1814', { k: 1.06, cast: false });
  ridge.position.set(cx, H + rh, cz); ridge.rotation.y = rot; ctx.scene.add(ridge);
  makeRoofTiles(ctx, { cx, cz, rot, H, hw, hd, hip: false, rh, halfSpan, len });
}

// Parallel tile/ridge strokes down a pitched roof (batched ink strokes).
export function makeRoofTiles(ctx, { cx, cz, rot, H, hw, hd, hip, rh = 0, halfSpan = 0, len = 0 }) {
  const line = (lx0, ly0, lz0, lx1, ly1, lz1) => {
    const a = ctx._toWorld(cx, cz, rot, lx0, lz0), b = ctx._toWorld(cx, cz, rot, lx1, lz1);
    ctx._roofSeg.push(a.x, H + ly0, a.z, b.x, H + ly1, b.z);
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
export function makeCorrugated(ctx, { cx, cz, rot, y, hw, hd }) {
  const N = Math.max(4, Math.round(hw * 1.4));
  for (let i = 0; i <= N; i++) {
    const lx = -hw + (2 * hw) * (i / N);
    const a = ctx._toWorld(cx, cz, rot, lx, -hd + 0.2), b = ctx._toWorld(cx, cz, rot, lx, hd - 0.2);
    ctx._roofSeg.push(a.x, y, a.z, b.x, y, b.z);
  }
}

// Horizontal wood-siding seams on a building's four faces (板張り houses).
export function makeSidingLines(ctx, { cx, cz, rot, hw, hd, H }) {
  const faces = [[0, 1, hd, hw], [0, -1, hd, hw], [1, 0, hw, hd], [-1, 0, hw, hd]];
  for (const [nlx, nlz, half, wl] of faces) {
    const tlx = -nlz, tlz = nlx;
    const o = ctx._dir(rot, nlx, nlz);
    let c = 0;
    for (let y = 0.6; y < H - 0.2 && c < 7; y += 0.55, c++) {
      const a = ctx._toWorld(cx, cz, rot, nlx * half + tlx * (-wl + 0.15), nlz * half + tlz * (-wl + 0.15));
      const b = ctx._toWorld(cx, cz, rot, nlx * half + tlx * (wl - 0.15), nlz * half + tlz * (wl - 0.15));
      const la = ctx._datumLift(cx, cz, a.x, a.z), lb = ctx._datumLift(cx, cz, b.x, b.z);
      ctx._roofSeg.push(a.x + o.x * 0.05, y + la, a.z + o.z * 0.05, b.x + o.x * 0.05, y + lb, b.z + o.z * 0.05);
    }
  }
}

// ── Balcony ─────────────────────────────────────────────────────────────────
// A coherent concrete balcony: a floor slab + a solid 3-sided parapet + a dark
// metal rail cap. The wall behind it gets a FULL-HEIGHT door-window (a real
// porta-finestra reaching down to the balcony floor — a balcony you could step
// onto, not a shelf under a little window). Futons draped over the rail flap in
// the wind but only OUTWARD, so the cloth never swings back through the parapet.
export function makeBalcony(ctx, { cx, cz, rot, nlx, nlz, tlx, tlz, half, wallLen, rotY, y, seed }) {
  const w = Math.min(wallLen * 0.82, 4.2), out = 0.62, ph = 0.56;   // width · depth · parapet height
  // floor slab — the whole balcony rides the building's floor datum (see
  // city._datumLift), not the local sphere surface, so it lines up with the
  // porta-finestra and the facade however far from the block's centre it sits.
  const fc = ctx._toWorld(cx, cz, rot, nlx * (half + out / 2), nlz * (half + out / 2));
  y += ctx._datumLift(cx, cz, fc.x, fc.z);
  const slab = inkedMesh(new THREE.BoxGeometry(w, 0.12, out), '#c8c5bf', { k: 1.03, cast: false });
  slab.position.set(fc.x, y, fc.z); slab.rotation.y = rotY; ctx.scene.add(slab);
  // solid front parapet wall
  const pc = ctx._toWorld(cx, cz, rot, nlx * (half + out), nlz * (half + out));
  const front = inkedMesh(new THREE.BoxGeometry(w, ph, 0.1), '#b6b3ac', { k: 1.03, cast: false });
  front.position.set(pc.x, y + ph / 2, pc.z); front.rotation.y = rotY; ctx.scene.add(front);
  // two side returns → the balcony reads as a volume, not a floating shelf
  for (const s of [-1, 1]) {
    const sc = ctx._toWorld(cx, cz, rot, nlx * (half + out / 2) + tlx * (s * w / 2), nlz * (half + out / 2) + tlz * (s * w / 2));
    const side = inkedMesh(new THREE.BoxGeometry(0.09, ph, out), '#bebbb4', { k: 1.04, cast: false });
    side.position.set(sc.x, y + ph / 2, sc.z); side.rotation.y = rotY; ctx.scene.add(side);
  }
  // dark metal rail cap along the top
  const cap = inkedMesh(new THREE.BoxGeometry(w + 0.1, 0.07, 0.16), '#6e695f', { k: 1.05, cast: false });
  cap.position.set(pc.x, y + ph + 0.03, pc.z); cap.rotation.y = rotY; ctx.scene.add(cap);

  // full-height door-window(s) on the wall behind: dark glass reaching the slab,
  // split by light glazing bars (two leaves on wide balconies, one on narrow).
  // The facade skips its instanced window on this floor, so the porta-finestra
  // IS the window here — coherent with the balcony in front of it.
  const paneH = 1.75, paneW = 0.85, cy = y + 0.08 + paneH / 2;
  const offsets = w >= 2.8 ? [-0.75, 0.75] : [0];
  for (const toff of offsets) {
    const wc = ctx._toWorld(cx, cz, rot, nlx * (half + 0.1) + tlx * toff, nlz * (half + 0.1) + tlz * toff);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(paneW, paneH), GLASS);
    pane.position.set(wc.x, cy, wc.z); pane.rotation.y = rotY; ctx.scene.add(pane);
    const bar = (bw, bh, dy2, dt2) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), MUNTIN_MAT);
      const bc = ctx._toWorld(cx, cz, rot, nlx * (half + 0.11) + tlx * (toff + dt2), nlz * (half + 0.11) + tlz * (toff + dt2));
      b.position.set(bc.x, cy + dy2, bc.z); b.rotation.y = rotY; ctx.scene.add(b);
    };
    bar(0.05, paneH, 0, 0);                 // central vertical bar (two sliding leaves)
    bar(paneW, 0.05, paneH * 0.22, 0);      // transom bar
    bar(paneW, 0.07, -paneH / 2 + 0.03, 0); // bottom rail at the slab
  }

  // futon / blanket draped over the rail and hanging down the front — each one
  // flaps in the breeze. The swing is CLAMPED OUTWARD (never negative), so the
  // cloth billows away from the balcony and can't pass back through the parapet.
  const nF = ctx.rng() < 0.7 ? (ctx.rng() < 0.5 ? 2 : 1) : 0;
  for (let i = 0; i < nF; i++) {
    const toff = (i - (nF - 1) / 2) * 0.92 + ctx._rand(-0.06, 0.06);
    const lp = ctx._toWorld(cx, cz, rot, nlx * (half + out + 0.06) + tlx * toff, nlz * (half + out + 0.06) + tlz * toff);
    const fh = 0.66 + ctx.rng() * 0.22;
    const anchor = new THREE.Group();
    anchor.position.set(lp.x, y + ph + 0.05, lp.z); anchor.rotation.y = rotY; ctx.scene.add(anchor);
    const swing = new THREE.Group(); anchor.add(swing);
    // a SOFT draped cloth (folds + rounded fold-over lip + wavy hem), not a plank
    const cloth = drapedClothGeometry(0.6, fh, { seed: (seed * 3 + i) | 0, nfolds: 2 + (i % 2) });
    const futon = inkedMesh(cloth, i % 2 ? '#9c9890' : '#d7d3cb', { k: 1.03, cast: false });
    futon.position.set(0, 0, 0); swing.add(futon);
    const ph2 = ctx.rng() * 6.283, fr = 0.7 + ctx.rng() * 0.6, amp = 0.05 + ctx.rng() * 0.05;
    ctx.animators.push((t, dt, wind = 1) => {
      // 0.5+0.5·sin ∈ [0,1] → rotation.x ∈ [0.1·amp, amp]: always a positive
      // (outward) lean; gusts (wind) deepen the billow, never the backswing.
      swing.rotation.x = (0.1 + 0.9 * (0.5 + 0.5 * Math.sin(t * fr + ph2))) * amp * wind;
      swing.rotation.z = Math.cos(t * fr * 0.7 + ph2) * amp * 0.4 * wind;
    });
  }
}

// ── Shop dressing (商店街) ──────────────────────────────────────────────────
// A storefront on the street-facing ground floor: a horizontal name-board
// (kanban) with kanji-ish glyph strokes, an awning over the pavement, and a
// vertical projecting blade sign (袖看板). All greyscale so the world stays
// B&W; the signs register a night-glow point so they read as lit after dark.
export function makeShopfront(ctx, { cx, cz, rot, nlx, nlz, hw, hd, H, seed }) {
  const half = (nlx !== 0) ? hw : hd;
  const wallLen = ((nlx !== 0) ? hd : hw) * 2;
  const tlx = -nlz, tlz = nlx;                       // tangent (local)
  const n = ctx._dir(rot, nlx, nlz);
  const rotY = Math.atan2(n.x, n.z);
  const w = Math.min(wallLen * 0.92, 4.4);

  // horizontal shop name-board across the top of the storefront (all heights
  // ride the building's floor datum — see city._datumLift)
  const sc = ctx._toWorld(cx, cz, rot, nlx * (half + 0.07), nlz * (half + 0.07));
  const lift = ctx._datumLift(cx, cz, sc.x, sc.z);
  const signY = 2.9 + lift;
  const board = inkedMesh(new THREE.BoxGeometry(w, 0.52, 0.12), '#d8d5cd', { k: 1.03, cast: false });
  board.position.set(sc.x, signY, sc.z); board.rotation.y = rotY; ctx.scene.add(board);
  // a row of glyph strokes so the board reads as shop lettering (kanji-ish)
  const glyphs = 3 + (seed % 3);
  for (let gi = 0; gi < glyphs; gi++) {
    const tcen = (gi - (glyphs - 1) / 2) * (w / (glyphs + 0.6));
    const va = ctx._toWorld(cx, cz, rot, nlx * (half + 0.14) + tlx * tcen, nlz * (half + 0.14) + tlz * tcen);
    ctx._roofSeg.push(va.x, signY - 0.16, va.z, va.x, signY + 0.16, va.z);   // vertical stroke
    for (const dy of [-0.09, 0.09]) {                                          // two horizontal ticks
      const ha = ctx._toWorld(cx, cz, rot, nlx * (half + 0.14) + tlx * (tcen - 0.09), nlz * (half + 0.14) + tlz * (tcen - 0.09));
      const hb = ctx._toWorld(cx, cz, rot, nlx * (half + 0.14) + tlx * (tcen + 0.09), nlz * (half + 0.14) + tlz * (tcen + 0.09));
      ctx._roofSeg.push(ha.x, signY + dy, ha.z, hb.x, signY + dy, hb.z);
    }
  }

  // awning projecting over the pavement (some shops)
  if ((seed % 2) === 0) {
    const tone = CONFIG.shop.awningTones[seed % CONFIG.shop.awningTones.length];
    const aw = inkedMesh(new THREE.BoxGeometry(w, 0.1, 0.72), tone, { k: 1.03, cast: false });
    const ac = ctx._toWorld(cx, cz, rot, nlx * (half + 0.4), nlz * (half + 0.4));
    aw.position.set(ac.x, 2.5 + lift, ac.z); aw.rotation.y = rotY; ctx.scene.add(aw);
    // a thin valance hanging off the awning's front lip
    const val = inkedMesh(new THREE.BoxGeometry(w, 0.16, 0.04), tone, { k: 1.04, cast: false });
    const vc = ctx._toWorld(cx, cz, rot, nlx * (half + 0.76), nlz * (half + 0.76));
    val.position.set(vc.x, 2.44 + lift, vc.z); val.rotation.y = rotY; ctx.scene.add(val);
  }

  // vertical projecting blade sign at one end, perpendicular to the wall
  const bx = ctx._toWorld(cx, cz, rot, nlx * (half + 0.2) + tlx * (w / 2 - 0.3), nlz * (half + 0.2) + tlz * (w / 2 - 0.3));
  const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.5), toonMat('#cdcac2', { side: THREE.DoubleSide }));
  blade.position.set(bx.x, 3.5 + lift, bx.z); blade.rotation.y = rotY + Math.PI / 2; addInk(blade, 1.03); ctx.scene.add(blade);
  // vertical column of text on the blade sign (袖看板) — a tick per character row
  for (let gi = -1; gi <= 1; gi++) {
    const ca = ctx._toWorld(cx, cz, rot, nlx * (half + 0.2) + tlx * (w / 2 - 0.4), nlz * (half + 0.2) + tlz * (w / 2 - 0.4));
    const cb = ctx._toWorld(cx, cz, rot, nlx * (half + 0.2) + tlx * (w / 2 - 0.2), nlz * (half + 0.2) + tlz * (w / 2 - 0.2));
    ctx._roofSeg.push(ca.x, 3.5 + lift + gi * 0.42, ca.z, cb.x, 3.5 + lift + gi * 0.42, cb.z);
  }

  if (CONFIG.shop.nightGlow) ctx.lampHeads.push(sc.x + n.x * 0.12, signY, sc.z + n.z * 0.12);
}

// A rooftop billboard (屋上看板): two posts off the roof carrying a panel that
// faces the street, with stroke "lettering" rows. Optional night glow.
export function makeRoofSign(ctx, { cx, cz, rot, nlx, nlz, hw, hd, H, seed }) {
  const half = (nlx !== 0) ? hw : hd;
  const wallLen = ((nlx !== 0) ? hd : hw) * 2;
  const tlx = -nlz, tlz = nlx;
  const n = ctx._dir(rot, nlx, nlz);
  const rotY = Math.atan2(n.x, n.z);
  const w = Math.min(wallLen * 0.8, 3.6), sh = 1.3 + ctx.rng() * 0.8;
  // the roof deck is the building datum + H, so the sign must ride the datum
  // too or its posts sink into the roof near the block's edge
  const fc0 = ctx._toWorld(cx, cz, rot, nlx * (half - 0.4), nlz * (half - 0.4));
  const baseY = H + 0.2 + ctx._datumLift(cx, cz, fc0.x, fc0.z);
  for (const s of [-1, 1]) {
    const pc = ctx._toWorld(cx, cz, rot, nlx * (half - 0.4) + tlx * (s * w * 0.4), nlz * (half - 0.4) + tlz * (s * w * 0.4));
    const post = inkedMesh(new THREE.BoxGeometry(0.08, sh + 0.4, 0.08), '#2a2620', { k: 1.1, cast: false });
    post.position.set(pc.x, baseY + (sh + 0.4) / 2, pc.z); post.rotation.y = rotY; ctx.scene.add(post);
  }
  const fc = ctx._toWorld(cx, cz, rot, nlx * (half - 0.4), nlz * (half - 0.4));
  const panel = inkedMesh(new THREE.BoxGeometry(w, sh, 0.1), '#dad7cf', { k: 1.02, cast: false });
  panel.position.set(fc.x, baseY + 0.4 + sh / 2, fc.z); panel.rotation.y = rotY; ctx.scene.add(panel);
  const rows = 2 + (ctx.rng() * 2 | 0);
  for (let i = 1; i <= rows; i++) {
    const yy = baseY + 0.4 + sh * (i / (rows + 1));
    const a = ctx._toWorld(cx, cz, rot, nlx * (half - 0.34) + tlx * (-w / 2 + 0.25), nlz * (half - 0.34) + tlz * (-w / 2 + 0.25));
    const b = ctx._toWorld(cx, cz, rot, nlx * (half - 0.34) + tlx * (w / 2 - 0.25), nlz * (half - 0.34) + tlz * (w / 2 - 0.25));
    ctx._roofSeg.push(a.x, yy, a.z, b.x, yy, b.z);
  }
  if (CONFIG.shop.nightGlow) ctx.lampHeads.push(fc.x + n.x * 0.12, baseY + 0.4 + sh / 2, fc.z + n.z * 0.12);
}

// ── Facade fixtures ─────────────────────────────────────────────────────────
// An air-conditioner outdoor unit (室外機): cream box with a big circular fan
// grille on the front (a recessed dish behind a static spoked guard with the
// blades spinning behind it) and louvre slats on the flank. The fan child group
// is registered as an animator so the planet mapping is never disturbed.
export function makeAcUnit(ctx, { x, y, z, rotY }) {
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
  const dish = inkedMesh(new THREE.CylinderGeometry(R, R, 0.04, 24), '#c8c5be', { k: 1.02, cast: false });
  dish.position.set(gx, 0, front - 0.03); dish.rotation.x = Math.PI / 2; g.add(dish);
  const fan = new THREE.Group(); fan.position.set(gx, 0, front - 0.02); g.add(fan);
  const hub = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), DARK, { k: 1.05, cast: false });
  hub.rotation.x = Math.PI / 2; fan.add(hub);
  for (let b = 0; b < 3; b++) {
    const arm = new THREE.Group(); arm.rotation.z = b * (Math.PI * 2 / 3); fan.add(arm);
    const blade = inkedMesh(new THREE.BoxGeometry(R * 0.82, 0.13, 0.006), '#8d897f', { k: 1.06, cast: false });
    blade.position.set(R * 0.42, 0, 0); blade.rotation.z = 0.55; arm.add(blade);
  }
  const ringAt = (rr, tube) => {
    const ring = inkedMesh(new THREE.TorusGeometry(rr, tube, 6, 28), GUARD, { k: 1.05, cast: false });
    ring.position.set(gx, 0, front); g.add(ring);
  };
  ringAt(R, 0.016); ringAt(R * 0.66, 0.01); ringAt(R * 0.33, 0.01);
  for (let s = 0; s < 6; s++) {
    const spoke = inkedMesh(new THREE.BoxGeometry(0.009, R * 2, 0.008), GUARD, { k: 1.06, cast: false });
    spoke.position.set(gx, 0, front - 0.002); spoke.rotation.z = s * (Math.PI / 6); g.add(spoke);
  }
  ctx.scene.add(g);
  const spd = 8 + ctx.rng() * 4;
  ctx.animators.push((t) => { fan.rotation.z = t * spd; });
}

// A detailed street door (玄関): a light concrete surround (jambs + lintel), a
// dark timber slab split into two leaves with recessed panels, a frosted glass
// light near the top, a handle and a low threshold step. Built as a small group
// (doors are few) and spherified onto the planet like any prop.
export function makeDoor(ctx, { x, z, rotY, lift = 0 }) {
  // `lift` re-seats the door on the building's ground-floor datum (see
  // city._datumLift): without it the door sits on the LOCAL surface, a sagitta
  // below the sunk building's floor, and reads squashed behind the plinth.
  const g = new THREE.Group(); g.position.set(x, lift, z); g.rotation.y = rotY;
  g.userData.kind = 'door';
  const W = 0.98, H = 1.98, WOOD = '#39342c', PANEL = '#2c2822', FR = '#d0cdc6', STEP = '#c7c4bd';
  const box = (w, h, d, col, px, py, pz, k = 1.03) => {
    const m = inkedMesh(new THREE.BoxGeometry(w, h, d), col, { k, cast: false });
    m.position.set(px, py, pz); g.add(m); return m;
  };
  // concrete surround (two jambs + a lintel)
  box(0.09, H + 0.08, 0.14, FR, -W / 2 - 0.02, H / 2, 0.03);
  box(0.09, H + 0.08, 0.14, FR,  W / 2 + 0.02, H / 2, 0.03);
  box(W + 0.22, 0.11, 0.14, FR, 0, H + 0.04, 0.03);
  // the timber slab
  box(W, H, 0.07, WOOD, 0, H / 2, 0);
  // centre reveal → reads as two sliding leaves
  box(0.035, H - 0.06, 0.02, PANEL, 0, H / 2, 0.045);
  // per leaf: an upper GLAZED light, split into four panes by LIGHT glazing
  // bars (so it reads clearly against the dark glass), plus a recessed lower
  // panel — like a real genkan door.
  const lightGeo = new THREE.PlaneGeometry(W * 0.32, 0.44);
  for (const lx of [-W * 0.26, W * 0.26]) {
    const gl = new THREE.Mesh(lightGeo, GLASS);
    gl.position.set(lx, H * 0.66, 0.05); g.add(gl);
    box(0.03, 0.44, 0.02, FR, lx, H * 0.66, 0.055, 1.25);          // vertical glazing bar
    box(W * 0.32, 0.03, 0.02, FR, lx, H * 0.66, 0.055, 1.25);      // horizontal glazing bar
    box(W * 0.32, H * 0.24, 0.02, PANEL, lx, H * 0.26, 0.045, 1.06); // recessed lower panel
  }
  // handle + a low threshold step
  box(0.05, 0.18, 0.05, '#8c877d', W * 0.30, H * 0.46, 0.07, 1.12);
  box(W + 0.26, 0.09, 0.3, STEP, 0, 0.045, 0.13);
  ctx.scene.add(g);
}
