import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat, inkedMesh, addInk } from '../toon.js';
import { GLASS, SHUTTER } from './materials.js';

// ===========================================================================
//  Street-furniture item factory — PARAMETRIC props. Same contract as the
//  greenery factory: pass the City `ctx` (scene, rng, colliders, lampHeads) plus
//  opts, and the prop is built, added to the scene, and its collider registered.
// ===========================================================================

// A parked bicycle, seen side-on (its face turned toward the street). Same
// compromise as the car: SMOOTH, rounded geometry (tube-shaped frame, round
// rims with spokes) shaded with MeshStandardMaterial — but kept tied to the
// manga scene with a LIGHT inverted-hull ink contour on every part.
export function makeBicycle(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.45 });
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ang;
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.25, ...o });
  const TIRE  = std('#1c1a17', { roughness: 0.9, metalness: 0.0 });
  const FRAME = std('#3a352e', { roughness: 0.4, metalness: 0.45 });
  const RIM   = std('#a6a29a', { roughness: 0.35, metalness: 0.6 });
  const SEAT  = std('#262320', { roughness: 0.6 });

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
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.18, 12), std('#bcae90', { roughness: 0.7, metalness: 0.0 }));
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
