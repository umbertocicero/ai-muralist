import * as THREE from 'three';
import { toonMat, inkedMesh } from '../toon.js';

// ===========================================================================
//  Infrastructure — the tall utility furniture of the neighbourhood: cobra-head
//  street lamps, timber utility poles, the overhead cable runs strung between
//  them, rooftop TV antennas and the landmark water towers.
// ===========================================================================

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

// A timber utility pole with two cross-arms and (sometimes) a transformer can.
export function makePole(ctx, { x, z, h, transformer = false }) {
  ctx.colliders.push({ x, z, r: 0.25 });
  const shaft = inkedMesh(new THREE.CylinderGeometry(0.08, 0.11, h, 6), '#2a2620', { k: 1.05 });
  shaft.position.set(x, h / 2, z); ctx.scene.add(shaft);
  [[h - 0.6, 1.9], [h - 1.5, 1.3]].forEach(([ay, aw]) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.07, 0.07), toonMat('#2a2620'));
    arm.position.set(x, ay, z); ctx.scene.add(arm);
  });
  if (transformer) {
    const tf = inkedMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8), '#34302a', { k: 1.06, cast: false });
    tf.position.set(x + 0.26, h - 2.4, z); ctx.scene.add(tf);
  }
}

// A sagging overhead cable between two poles — appended to the batched wire
// buffer (ctx._wireSeg) as short segments, merged into one LineSegments later.
// Each vertex also gets a GPU-wind pair in ctx._wireWind: a sway weight that is
// 0 at the poles and 1 mid-span (sinπ — so the ends stay pinned while the belly
// bobs) plus a per-span phase, consumed by wind.js applyWireWind in the shader.
export function makeWire(ctx, { x0, y0, z0, x1, y1, z1, sag }) {
  const mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2 - sag, (z0 + z1) / 2);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y0, z0), mid, new THREE.Vector3(x1, y1, z1));
  const pts = curve.getPoints(10);
  const phase = (Math.abs(x0 * 12.9898 + z1 * 78.233)) % 6.283;   // deterministic per span
  const N = pts.length - 1;
  for (let i = 0; i < N; i++) {
    ctx._wireSeg.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    ctx._wireWind?.push(Math.sin(Math.PI * i / N), phase, Math.sin(Math.PI * (i + 1) / N), phase);
  }
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
