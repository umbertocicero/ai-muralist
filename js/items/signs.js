import * as THREE from 'three';
import { toonMat, inkedMesh, addInk } from '../toon.js';

// ===========================================================================
//  Signage — the pole-mounted markers of the streets: vertical shop banners
//  (幟), triangular warning road signs and the convex junction mirrors (カーブ
//  ミラー).
// ===========================================================================

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
