import * as THREE from 'three';
import { inkedMesh } from '../toon.js';
import { GLASS } from './materials.js';

// ===========================================================================
//  Building fixtures — self-contained objects mounted on the facades: the
//  air-conditioner outdoor units (室外機) and the detailed street doors (玄関).
//  (The building SHELL — walls, roofs, balconies, shopfronts — is generated in
//  city.js; these are the discrete objects hung on it.)
// ===========================================================================

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
export function makeDoor(ctx, { x, z, rotY }) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY;
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
