import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat, inkedMesh, addInk } from '../toon.js';
import { GLASS, SHUTTER, LEAF } from './materials.js';
import { placeOnPlanet } from '../planet.js';

// ===========================================================================
//  Street furniture — the ground-level dressing of the lanes: benches, planter
//  boxes, traffic cones, A-frame barricades, board fences, entrance stairs,
//  vending machines and manhole covers.
// ===========================================================================

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

// A round manhole cover lying tangent on the planet (built post-spherify, so it
// places itself onto the sphere directly via placeOnPlanet).
export function makeManhole(ctx, { x, z }) {
  const baseQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const rim = new THREE.Mesh(new THREE.CircleGeometry(0.46, 18), toonMat('#3a3833'));
  placeOnPlanet(rim, x, 0.08, z, baseQ, ctx.R); rim.receiveShadow = true; ctx.scene.add(rim);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.36, 18), toonMat('#86837e'));
  placeOnPlanet(inner, x, 0.09, z, baseQ, ctx.R); ctx.scene.add(inner);
}
