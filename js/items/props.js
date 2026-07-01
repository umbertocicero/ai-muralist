import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat, inkedMesh, addInk } from '../toon.js';
import { GLASS, SHUTTER, LEAF } from './materials.js';

// ===========================================================================
//  Street-furniture item factory — PARAMETRIC props. Same contract as the
//  greenery factory: pass the City `ctx` (scene, rng, colliders, lampHeads) plus
//  opts, and the prop is built, added to the scene, and its collider registered.
// ===========================================================================

// A parked bicycle, seen side-on (its face turned toward the street). Same
// recipe as the car: SMOOTH, rounded geometry (tube-shaped frame, round rims
// with spokes) but shaded in the MANGA style — cel banding + surface hatching
// (toonMat) plus an inverted-hull ink contour — so it reads as inked, not
// realistic, like the rest of the town.
export function makeBicycle(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.45 });
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ang;
  // manga cel + hatching materials on smooth rounded geometry (same look as the
  // rest of the inked town, not realistic smooth shading)
  const TIRE  = toonMat('#1c1a17');
  const FRAME = toonMat('#3a352e');
  const RIM   = toonMat('#a6a29a');
  const SEAT  = toonMat('#262320');

  // ── round wheels: a tyre torus + a thin bright rim + a few spokes + hub ─────
  const wr = 0.3;
  const tyreGeo = new THREE.TorusGeometry(wr, 0.04, 14, 32);
  const rimGeo  = new THREE.TorusGeometry(wr - 0.05, 0.012, 8, 32);
  const spokeGeo = new THREE.CylinderGeometry(0.006, 0.006, (wr - 0.06) * 2, 6);
  const hubGeo  = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10);
  for (const wx of [-0.52, 0.52]) {
    const tyre = new THREE.Mesh(tyreGeo, TIRE); tyre.position.set(wx, wr, 0); addInk(tyre, 1.04); g.add(tyre);
    const rim = new THREE.Mesh(rimGeo, RIM); rim.position.set(wx, wr, 0); g.add(rim);
    for (let s = 0; s < 6; s++) {
      const sp = new THREE.Mesh(spokeGeo, RIM); sp.position.set(wx, wr, 0); sp.rotation.z = s * (Math.PI / 6); g.add(sp);
    }
    const hub = new THREE.Mesh(hubGeo, FRAME); hub.position.set(wx, wr, 0); hub.rotation.x = Math.PI / 2; addInk(hub, 1.06); g.add(hub);
  }

  // ── tube-shaped frame members (cylinders, lightly inked) ───────────────────
  const tube = (x1, y1, x2, y2, r = 0.024) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 0.01;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), FRAME);
    t.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    t.rotation.z = Math.atan2(-dx, dy); addInk(t, 1.07); g.add(t);
  };
  const bbx = 0.02, bby = wr, sx = -0.2, sy = 0.74, hx = 0.46, hy = 0.82;
  tube(-0.52, wr, bbx, bby);   // chain stay
  tube(bbx, bby, sx, sy);      // seat tube
  tube(sx, sy, hx, hy);        // top tube
  tube(hx, hy, bbx, bby);      // down tube
  tube(sx, sy, -0.52, wr);     // seat stay
  tube(hx, hy, 0.52, wr);      // fork

  const saddle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.06, 10), SEAT);
  saddle.scale.set(1, 1, 2.0); saddle.position.set(sx - 0.04, sy + 0.05, 0); addInk(saddle, 1.06); g.add(saddle);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 10), FRAME);
  grip.rotation.x = Math.PI / 2; grip.position.set(hx, hy + 0.04, 0); addInk(grip, 1.08); g.add(grip);
  if (ctx.rng() < 0.6) {     // the ubiquitous front basket
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.18, 12), toonMat('#bcae90'));
    basket.position.set(0.54, 0.66, 0); addInk(basket, 1.05); g.add(basket);
  }
  ctx.scene.add(g);
}

// A vending machine (自販機): the most iconic Japanese street object. Greyscale
// box with a dark display window + selection panel; registers a night glow so it
// reads as the lone lit thing in a dark lane.
export function makeVendingMachine(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.5 });
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
  const body = inkedMesh(new THREE.BoxGeometry(0.78, 1.9, 0.66), '#dedcd7', { k: 1.03 });
  body.position.set(0, 0.95, 0); g.add(body);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), GLASS);
  disp.position.set(0, 1.34, 0.34); g.add(disp);
  const sel = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.3), SHUTTER);
  sel.position.set(0, 0.82, 0.34); g.add(sel);
  const tray = inkedMesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), '#2a2824', { k: 1.05, cast: false });
  tray.position.set(0, 0.38, 0.33); g.add(tray);
  ctx.scene.add(g);
  if (CONFIG.shop?.nightGlow) {
    const dx = Math.sin(ang), dz = Math.cos(ang);
    ctx.lampHeads.push(x + dx * 0.4, 1.3, z + dz * 0.4);
  }
}

// A roadwork traffic cone with a reflective band.
export function makeTrafficCone(ctx, { x, z }) {
  ctx.colliders.push({ x, z, r: 0.18 });
  const cone = inkedMesh(new THREE.ConeGeometry(0.17, 0.5, 12), '#c9c6c0', { k: 1.05, cast: false });
  cone.position.set(x, 0.27, z); ctx.scene.add(cone);
  const base = inkedMesh(new THREE.BoxGeometry(0.34, 0.05, 0.34), '#9a968e', { k: 1.04, cast: false });
  base.position.set(x, 0.025, z); ctx.scene.add(base);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 12), toonMat('#efece6'));
  band.position.set(x, 0.33, z); ctx.scene.add(band);
}

// A slatted public bench facing the street (新規) — `length` sizes it.
export function makeBench(ctx, { x, z, ang = 0, length = 1.3 }) {
  ctx.colliders.push({ x, z, r: Math.max(0.5, length * 0.45) });
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
  const WOOD = '#cfc7b6', METAL = '#5f5b53';
  const seat = inkedMesh(new THREE.BoxGeometry(length, 0.08, 0.42), WOOD, { k: 1.04 });
  seat.position.set(0, 0.45, 0); g.add(seat);
  const back = inkedMesh(new THREE.BoxGeometry(length, 0.32, 0.07), WOOD, { k: 1.04, cast: false });
  back.position.set(0, 0.66, -0.18); g.add(back);
  for (const sx of [-length / 2 + 0.12, length / 2 - 0.12]) {
    const leg = inkedMesh(new THREE.BoxGeometry(0.07, 0.45, 0.38), METAL, { k: 1.06, cast: false });
    leg.position.set(sx, 0.225, 0.02); g.add(leg);
    const arm = inkedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.46), METAL, { k: 1.08, cast: false });
    arm.position.set(sx, 0.5, -0.02); g.add(arm);
  }
  ctx.scene.add(g);
}

// A street lamp (cobra-head) — registers a night-glow head in ctx.lampHeads.
export function makeLamppost(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.18 });
  const h = 4.2, reach = 0.95;
  const dx = Math.sin(ang), dz = Math.cos(ang);     // unit dir toward the street
  const pole = inkedMesh(new THREE.CylinderGeometry(0.055, 0.08, h, 6), '#2a2620', { k: 1.06 });
  pole.position.set(x, h / 2, z); ctx.scene.add(pole);
  const arm = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, reach), '#2a2620', { k: 1.1, cast: false });
  arm.position.set(x + dx * reach / 2, h - 0.06, z + dz * reach / 2); arm.rotation.y = ang;
  ctx.scene.add(arm);
  const hx = x + dx * reach, hz = z + dz * reach;
  const head = inkedMesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), '#1c1a17', { k: 1.05, cast: false });
  head.position.set(hx, h - 0.14, hz); head.rotation.y = ang; ctx.scene.add(head);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.16), toonMat('#fff3df'));
  lens.position.set(hx, h - 0.21, hz); lens.rotation.y = ang; ctx.scene.add(lens);
  ctx.lampHeads.push(hx, h - 0.24, hz);
}

// An over-the-roof TV antenna mast with a couple of cross-elements.
export function makeAntenna(ctx, { x, baseY, z }) {
  const mast = inkedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), '#1c1a17', { k: 1.12, cast: false });
  mast.position.set(x, baseY + 0.65, z); ctx.scene.add(mast);
  [0.95, 1.2].forEach((cy, i) => {
    const cw = 0.55 - i * 0.16;
    const bar = inkedMesh(new THREE.BoxGeometry(cw, 0.03, 0.03), '#1c1a17', { k: 1.15, cast: false });
    bar.position.set(x, baseY + cy, z); ctx.scene.add(bar);
  });
}

// An elevated spherical water tank on a lattice tower — a Shōwa rooftop landmark.
export function makeWaterTower(ctx, { x, z }) {
  ctx.colliders.push({ x, z, r: 1.05 });
  const legH = 4.2, r = 0.95;
  const tone = '#2a2620';
  // legs cast shadows (they hold the tank up — they must read on the ground)
  for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const leg = inkedMesh(new THREE.CylinderGeometry(0.06, 0.06, legH, 5), tone, { k: 1.08 });
    leg.position.set(x + sx, legH / 2, z + sz); leg.rotation.x = sx * 0.04; leg.rotation.z = -sz * 0.04;
    ctx.scene.add(leg);
  }
  [1.4, 2.8].forEach(cy => {   // cross-braces
    const b1 = inkedMesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), tone, { k: 1.1 }); b1.position.set(x, cy, z - 0.6); ctx.scene.add(b1);
    const b2 = b1.clone(); b2.position.set(x, cy, z + 0.6); ctx.scene.add(b2);
    const b3 = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, 1.5), tone, { k: 1.1 }); b3.position.set(x - 0.6, cy, z); ctx.scene.add(b3);
    const b4 = b3.clone(); b4.position.set(x + 0.6, cy, z); ctx.scene.add(b4);
  });
  const tank = inkedMesh(new THREE.SphereGeometry(r, 12, 10), '#cdcbc7', { k: 1.02 });
  tank.position.set(x, legH + r * 0.7, z); ctx.scene.add(tank);
  const cap = inkedMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 6), tone, { k: 1.1, cast: false });
  cap.position.set(x, legH + r * 1.7, z); ctx.scene.add(cap);
}

// A board fence (板塀) across the front of an open lot. Registers a thin barrier.
export function makePlankFence(ctx, { cx, cz, rot, hw, hd }) {
  const h = 1.0 + ctx.rng() * 0.4, len = hw * 2;
  const f = ctx._toWorld(cx, cz, rot, 0, hd);
  ctx.barriers.push({ cx: f.x, cz: f.z, hw, hd: 0.12, rot });
  const panel = inkedMesh(new THREE.BoxGeometry(len, h, 0.08), '#cfcabd', { k: 1.03 });
  panel.position.set(f.x, h / 2, f.z); panel.rotation.y = rot; ctx.scene.add(panel);
  const rail = inkedMesh(new THREE.BoxGeometry(len + 0.1, 0.1, 0.13), '#a8a294', { k: 1.05, cast: false });
  rail.position.set(f.x, h - 0.06, f.z); rail.rotation.y = rot; ctx.scene.add(rail);
  for (let lx = -hw + 0.3; lx < hw; lx += 0.34) {     // vertical plank seams
    const a = ctx._toWorld(cx, cz, rot, lx, hd + 0.05);
    ctx._roofSeg.push(a.x, 0.05, a.z, a.x, h - 0.05, a.z);
  }
  [-hw, hw].forEach(lx => {
    const p = ctx._toWorld(cx, cz, rot, lx, hd);
    const post = inkedMesh(new THREE.BoxGeometry(0.12, h + 0.16, 0.16), '#8f897b', { k: 1.06, cast: false });
    post.position.set(p.x, (h + 0.16) / 2, p.z); post.rotation.y = rot; ctx.scene.add(post);
  });
}

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

// A vertical shop banner (幟) on a thin pole, facing the street.
export function makeNobori(ctx, { x, z, ang }) {
  ctx.colliders.push({ x, z, r: 0.16 });
  const h = 2.3 + ctx.rng() * 0.5, dx = Math.sin(ang), dz = Math.cos(ang);
  const pole = inkedMesh(new THREE.CylinderGeometry(0.03, 0.03, h, 5), '#2a2620', { k: 1.1 });
  pole.position.set(x, h / 2, z); ctx.scene.add(pole);
  const arm = inkedMesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), '#2a2620', { k: 1.12, cast: false });
  arm.position.set(x + dx * 0.15, h - 0.1, z + dz * 0.15); arm.rotation.y = ang; ctx.scene.add(arm);
  const bh = h - 0.55;
  const tone = ctx.rng() < 0.5 ? '#3a3833' : '#45433d';
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.42, bh), toonMat(tone, { side: THREE.DoubleSide }));
  banner.position.set(x + dx * 0.3, h - 0.1 - bh / 2, z + dz * 0.3); banner.rotation.y = ang;
  addInk(banner, 1.02); ctx.scene.add(banner);
}

// A rectangular concrete planter box with shrubs, lining the lane.
export function makePlanterBox(ctx, { x, z, ang }) {
  const w = 1.1 + ctx.rng() * 0.5, d = 0.46, bh = 0.6;
  ctx.barriers.push({ cx: x, cz: z, hw: w / 2, hd: d / 2, rot: ang });
  const box = inkedMesh(new THREE.BoxGeometry(w, bh, d), '#cfccc4', { k: 1.04 });
  box.position.set(x, bh / 2, z); box.rotation.y = ang; ctx.scene.add(box);
  const rim = inkedMesh(new THREE.BoxGeometry(w + 0.08, 0.09, d + 0.08), '#b4b0a7', { k: 1.04, cast: false });
  rim.position.set(x, bh, z); rim.rotation.y = ang; ctx.scene.add(rim);
  const tlx = Math.cos(ang), tlz = -Math.sin(ang);
  const nb = 2 + (ctx.rng() * 2 | 0);
  for (let i = 0; i < nb; i++) {
    const t = (i / Math.max(1, nb - 1) - 0.5) * (w - 0.3);
    ctx._leaf(x + tlx * t, bh + 0.12, z + tlz * t, 0.3 + ctx.rng() * 0.12, LEAF[i % LEAF.length]);
    ctx._leaf(x + tlx * t + 0.08, bh + 0.3, z + tlz * t, 0.2 + ctx.rng() * 0.1, LEAF[(i + 1) % LEAF.length]);
  }
}

// A triangular warning road sign on a pole, facing the street.
export function makeRoadSign(ctx, { x, z, ang }) {
  ctx.colliders.push({ x, z, r: 0.16 });
  const h = 2.5, dx = Math.sin(ang), dz = Math.cos(ang);
  const pole = inkedMesh(new THREE.CylinderGeometry(0.04, 0.04, h, 6), '#6e6a62', { k: 1.08 });
  pole.position.set(x, h / 2, z); ctx.scene.add(pole);
  const tg = new THREE.CircleGeometry(0.34, 3); tg.rotateZ(Math.PI / 2);   // apex up
  const tri = new THREE.Mesh(tg, toonMat('#f4f1ea', { side: THREE.DoubleSide }));
  tri.position.set(x + dx * 0.06, h - 0.12, z + dz * 0.06); tri.rotation.y = ang;
  addInk(tri, 1.1, 0x141414); ctx.scene.add(tri);
}

// A convex traffic mirror (カーブミラー) on a pole at a junction, facing back
// down the road. The dark frame + pale disc read in B&W.
export function makeCurveMirror(ctx, { x, z, ang }) {
  ctx.colliders.push({ x, z, r: 0.16 });
  const dx = Math.sin(ang), dz = Math.cos(ang), h = 2.9;
  const pole = inkedMesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6), '#6e6a62', { k: 1.07 });
  pole.position.set(x, h / 2, z); ctx.scene.add(pole);
  const arm = inkedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), '#6e6a62', { k: 1.1, cast: false });
  arm.position.set(x + dx * 0.25, h - 0.12, z + dz * 0.25); arm.rotation.y = ang; ctx.scene.add(arm);
  const mx = x + dx * 0.5, mz = z + dz * 0.5;
  const frame = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), toonMat('#3a3833', { side: THREE.DoubleSide }));
  frame.position.set(mx, h - 0.06, mz); frame.rotation.y = ang + Math.PI; addInk(frame, 1.08); ctx.scene.add(frame);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), toonMat('#f2efe9', { side: THREE.DoubleSide }));
  face.position.set(mx - dx * 0.02, h - 0.06, mz - dz * 0.02); face.rotation.y = ang + Math.PI; ctx.scene.add(face);
}

// An A-frame barricade (single-A sawhorse) with a striped board.
export function makeAFrameBarrier(ctx, { x, z, ang }) {
  ctx.barriers.push({ cx: x, cz: z, hw: 0.6, hd: 0.12, rot: ang });
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
  ctx.scene.add(g);
}

// A parked scooter / moped against a wall.
export function makeScooter(ctx, { x, z, ang }) {
  ctx.colliders.push({ x, z, r: 0.4 });
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
  ctx.scene.add(g);
}

// A short flight of concrete steps (with low cheek walls). The footprint is a
// barrier so KAI walks round; the flight ASCENDS toward the building entrance
// (tall step against the wall, low step at the lane).
export function makeStairs(ctx, { x, z, rot, n = 5 }) {
  const stepW = 1.2, stepH = 0.18, stepD = 0.32;
  ctx.barriers.push({ cx: x, cz: z, hw: stepW / 2 + 0.12, hd: (n * stepD) / 2, rot });
  for (let i = 0; i < n; i++) {
    const p = ctx._toWorld(x, z, rot, 0, (i - (n - 1) / 2) * stepD);
    const sh = stepH * (n - i);
    const step = inkedMesh(new THREE.BoxGeometry(stepW, sh, stepD + 0.02), '#d2cfc8', { k: 1.02, cast: false, receive: true });
    step.position.set(p.x, sh / 2, p.z); step.rotation.y = rot; ctx.scene.add(step);
  }
  const topH = stepH * n;   // low cheek walls flanking the flight
  for (const s of [-1, 1]) {
    const cheek = inkedMesh(new THREE.BoxGeometry(0.12, topH + 0.2, n * stepD), '#cdcac3', { k: 1.03, cast: false });
    const p = ctx._toWorld(x, z, rot, s * (stepW / 2 + 0.06), 0);
    cheek.position.set(p.x, (topH + 0.2) / 2, p.z); cheek.rotation.y = rot; ctx.scene.add(cheek);
  }
}

// A parked kei-car (軽自動車) along the kerb — the tall square "kei box" body
// (BYD RACCO-ish), a side-profile Shape extruded across the width with a generous
// bevel so every edge is filleted, high-segment round wheels, but SHADED in the
// manga style (cel banding + surface hatching + inverted-hull ink). Length runs
// along local X (front at +X), width along Z.
export function makeKeiCar(ctx, { x, z, ang }) {
  ctx.barriers.push({ cx: x, cz: z, hw: 1.0, hd: 0.48, rot: ang });
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
  const BODY  = toonMat('#eceae0');
  const GLASSM = GLASS;                  // shared flat-dark manga window pane
  const BLACK = toonMat('#1f1c18');
  const TIRE  = toonMat('#1a1814');
  const ALLOY = toonMat('#bdb9b1');
  const LAMP  = toonMat('#f4f1eb');
  const TRIM  = toonMat('#2e2a25');
  const W = 0.82;

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
  const ws = panel(new THREE.BoxGeometry(0.04, 0.44, W - 0.26), GLASSM, 0.575, 1.2, 0); ws.rotation.z = -0.22; addInk(ws, 1.03);
  const rs = panel(new THREE.BoxGeometry(0.04, 0.3, W - 0.28), GLASSM, -0.88, 1.34, 0); rs.rotation.z = 0.5; addInk(rs, 1.03);
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
  const fx = 1.12;
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
  ctx.scene.add(g);
}
