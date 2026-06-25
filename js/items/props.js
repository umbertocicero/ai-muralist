import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat, inkedMesh } from '../toon.js';
import { GLASS, SHUTTER } from './materials.js';

// ===========================================================================
//  Street-furniture item factory — PARAMETRIC props. Same contract as the
//  greenery factory: pass the City `ctx` (scene, rng, colliders, lampHeads) plus
//  opts, and the prop is built, added to the scene, and its collider registered.
// ===========================================================================

// A parked bicycle, seen side-on (its face turned toward the street).
export function makeBicycle(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.45 });
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ang;
  const TIRE = '#1c1a17', FRAME = '#34302a', SEAT = '#262320';
  const wr = 0.3, wheelGeo = new THREE.TorusGeometry(wr, 0.035, 5, 14);
  for (const wx of [-0.52, 0.52]) {
    const wheel = inkedMesh(wheelGeo, TIRE, { k: 1.05 });
    wheel.position.set(wx, wr, 0); g.add(wheel);
  }
  const bar = (x1, y1, x2, y2, th = 0.045) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 0.01;
    const b = inkedMesh(new THREE.BoxGeometry(th, len, th), FRAME, { k: 1.12 });
    b.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    b.rotation.z = Math.atan2(-dx, dy); g.add(b);
  };
  const bbx = 0.02, bby = wr, sx = -0.2, sy = 0.74, hx = 0.46, hy = 0.82;
  bar(-0.52, wr, bbx, bby);   // chain stay
  bar(bbx, bby, sx, sy);      // seat tube
  bar(sx, sy, hx, hy);        // top tube
  bar(hx, hy, bbx, bby);      // down tube
  bar(sx, sy, -0.52, wr);     // seat stay
  bar(hx, hy, 0.52, wr);      // fork
  const saddle = inkedMesh(new THREE.BoxGeometry(0.28, 0.06, 0.12), SEAT, { k: 1.06, cast: false });
  saddle.position.set(sx - 0.04, sy + 0.03, 0); g.add(saddle);
  const grip = inkedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), FRAME, { k: 1.1, cast: false });
  grip.position.set(hx, hy + 0.02, 0); g.add(grip);
  if (ctx.rng() < 0.6) {     // the ubiquitous front basket
    const basket = inkedMesh(new THREE.BoxGeometry(0.22, 0.18, 0.26), '#bcae90', { k: 1.05, cast: false });
    basket.position.set(0.54, 0.66, 0); g.add(basket);
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
