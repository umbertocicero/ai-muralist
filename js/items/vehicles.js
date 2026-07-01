import * as THREE from 'three';
import { toonMat, inkedMesh, addInk } from '../toon.js';
import { GLASS } from './materials.js';

// ===========================================================================
//  Vehicles — parked bikes, kei-cars and scooters. Same factory contract as the
//  other item modules: makeX(ctx, opts) builds the mesh, adds it to ctx.scene
//  and registers its collider/barrier.
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
