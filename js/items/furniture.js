import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMat, inkedMesh, addInk } from '../toon.js';
import { GLASS, SHUTTER, LEAF } from './materials.js';
import { placeOnPlanet } from '../planet.js';

// ===========================================================================
//  Street furniture — the ground-level dressing of the lanes: benches, planter
//  boxes, traffic cones, A-frame barricades, board fences, vending machines and
//  manhole covers. (Entrance steps belong to the genkan door in house.js —
//  free-standing stair flights leading nowhere made no sense.)
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

// A low concrete bollard (車止め) — pairs of them guard the sidewalk where the
// zebra crossings meet it. Built AFTER the spherify pass (the crosswalks that
// anchor them only exist then), so it seats itself via placeOnPlanet.
export function makeBollard(ctx, { x, z }) {
  ctx.colliders.push({ x, z, r: 0.14 });
  const g = new THREE.Group();
  const post = inkedMesh(new THREE.CylinderGeometry(0.085, 0.10, 0.52, 10), '#cfccc4', { k: 1.06 });
  post.position.y = 0.26; g.add(post);
  const dome = inkedMesh(new THREE.SphereGeometry(0.085, 10, 8), '#cfccc4', { k: 1.06, cast: false });
  dome.position.y = 0.52; dome.scale.y = 0.6; g.add(dome);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.06, 10), toonMat('#3a3833'));
  band.position.y = 0.42; g.add(band);
  placeOnPlanet(g, x, 0, z, undefined, ctx.R);
  ctx.scene.add(g);
}

// A cylindrical Japanese post box (郵便ポスト), the classic round pillar type:
// pedestal, drum body, collar, domed cap and a hooded mail slot facing the
// street. (Red in life; it stays in the town's greyscale so the murals keep
// the only colour.)
export function makePostbox(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.32 });
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
  const TONE = '#b6b2aa', TRIM = '#8f8b84';
  const base = inkedMesh(new THREE.CylinderGeometry(0.24, 0.27, 0.16, 12), TRIM, { k: 1.04, cast: false });
  base.position.y = 0.08; g.add(base);
  const body = inkedMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.85, 14), TONE, { k: 1.03 });
  body.position.y = 0.58; g.add(body);
  const collar = inkedMesh(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 14), TRIM, { k: 1.05, cast: false });
  collar.position.y = 1.02; g.add(collar);
  const dome = inkedMesh(new THREE.SphereGeometry(0.21, 14, 10), TONE, { k: 1.04, cast: false });
  dome.position.y = 1.05; dome.scale.y = 0.55; g.add(dome);
  const hood = inkedMesh(new THREE.BoxGeometry(0.26, 0.05, 0.10), TRIM, { k: 1.08, cast: false });
  hood.position.set(0, 0.92, 0.19); g.add(hood);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.035), GLASS);
  slot.position.set(0, 0.88, 0.215); g.add(slot);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), SHUTTER);   // collection-times plate
  plate.position.set(0, 0.62, 0.212); g.add(plate);
  ctx.scene.add(g);
}

// A refuse point (ゴミ置き場): a pair of lidded bins with a couple of tied
// garbage bags slumped beside them — the everyday clutter of a back lane.
export function makeTrashPoint(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.5 });
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
  for (const [ox, oz, s] of [[-0.24, 0.02, 1], [0.2, -0.06, 0.9]]) {
    const body = inkedMesh(new THREE.CylinderGeometry(0.17 * s, 0.15 * s, 0.48 * s, 10), '#c6c3bc', { k: 1.05 });
    body.position.set(ox, 0.24 * s, oz); g.add(body);
    const lid = inkedMesh(new THREE.CylinderGeometry(0.19 * s, 0.19 * s, 0.06, 10), '#a8a49c', { k: 1.06, cast: false });
    lid.position.set(ox, 0.5 * s, oz); g.add(lid);
    const knob = inkedMesh(new THREE.SphereGeometry(0.035, 8, 6), '#a8a49c', { k: 1.1, cast: false });
    knob.position.set(ox, 0.55 * s, oz); g.add(knob);
  }
  for (const [ox, oz, r, sy] of [[0.05, 0.3, 0.16, 0.75], [0.34, 0.22, 0.13, 0.7], [-0.08, 0.36, 0.11, 0.8]]) {
    const bag = inkedMesh(new THREE.SphereGeometry(r, 9, 7), '#55524b', { k: 1.05, cast: false });
    bag.position.set(ox, r * sy * 0.9, oz); bag.scale.set(1, sy, 1);
    bag.rotation.y = ctx.rng() * 6.28; g.add(bag);
  }
  ctx.scene.add(g);
}

// A stack of bottle crates (ビールケース) by a shop wall — two on the ground,
// one on top, each with a dark open mouth so the stack reads at a glance.
export function makeCrates(ctx, { x, z, ang = 0 }) {
  ctx.colliders.push({ x, z, r: 0.45 });
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang;
  const tones = ['#9c988f', '#8f8b82', '#a8a49b'];
  const spots = [[-0.26, 0.15, 0, 0.06], [0.24, 0.15, 0.04, -0.1], [-0.03, 0.45, 0.02, 0.22]];
  spots.forEach(([ox, oy, oz, ry], i) => {
    const c = inkedMesh(new THREE.BoxGeometry(0.46, 0.3, 0.34), tones[i % 3], { k: 1.05 });
    c.position.set(ox, oy, oz); c.rotation.y = ry; g.add(c);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.28), toonMat('#3a3833'));
    mouth.position.set(ox, oy + 0.14, oz); mouth.rotation.y = ry; g.add(mouth);
  });
  ctx.scene.add(g);
}

// A kerbside storm-drain grate (雨水枡) lying flat against the road edge.
// Built AFTER the spherify pass (from _buildRoads, like the manholes), so the
// frame seats itself on the sphere; the grate bars still batch into _roofSeg
// in flat coords, which is finalized (and projected) later.
export function makeStreetDrain(ctx, { x, z, ang = 0 }) {
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang - Math.PI / 2);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), toonMat('#4a4842'));
  placeOnPlanet(frame, x, 0.075, z, yaw.multiply(tilt), ctx.R);
  frame.receiveShadow = true; ctx.scene.add(frame);
  const dxu = Math.sin(ang), dzu = Math.cos(ang);      // long axis, along the kerb
  const pxu = Math.cos(ang), pzu = -Math.sin(ang);     // short axis
  for (let i = -2; i <= 2; i++) {
    const ox = x + dxu * i * 0.11, oz = z + dzu * i * 0.11;
    ctx._roofSeg.push(ox + pxu * 0.15, 0.095, oz + pzu * 0.15, ox - pxu * 0.15, 0.095, oz - pzu * 0.15);
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
