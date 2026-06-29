import * as THREE from 'three';
import { toonMat, inkedMesh } from '../toon.js';
import { LEAF, LEAF_GEO } from './materials.js';

// ===========================================================================
//  Greenery item factory — every plant is PARAMETRIC. The city passes a context
//  `ctx` (the City instance: it exposes scene, rng, _rand, colliders) plus opts
//  that tune size / fullness, and gets back the mesh(es) added to the scene.
//
//  These were inline City methods; pulling them into one folder of small, self-
//  contained, parametrised builders is the shape the rest of the dressing will
//  follow (see js/items/props.js, js/items/index.js).
// ===========================================================================

// A single foliage blob. Shared geometry + cached toon material, no ink hull
// (the Sobel post-pass inks foliage), randomly tumbled so no two read alike.
export function makeLeaf(ctx, { x, y, z, r, tone }) {
  const m = new THREE.Mesh(LEAF_GEO, toonMat(tone));
  m.scale.setScalar(r);
  m.position.set(x, y, z);
  m.rotation.set(ctx.rng(), ctx.rng(), ctx.rng());
  ctx.scene.add(m);
  return m;
}

// A low bush — a clump of blobs. `scale` sets its girth (and collider radius).
export function makeBush(ctx, { x, z, scale = 1 }) {
  ctx.colliders.push({ x, z, r: 0.28 + scale * 0.12 });
  const blobs = [[0, 0.32, 0], [0.3, 0.30, 0.1], [-0.28, 0.34, -0.12], [0.05, 0.55, 0]];
  blobs.forEach(([ox, oy, oz], i) =>
    makeLeaf(ctx, { x: x + ox * scale, y: oy * scale + 0.1, z: z + oz * scale, r: (0.28 + (i % 2) * 0.08) * scale, tone: LEAF[i % LEAF.length] }));
}

// A street tree — a trunk + a stack of crown blobs. `trunkH` and a custom
// `crown` ([dx,dy,dz,r]…) parametrise its height and bushiness. The whole crown
// sways in the wind: the blobs live under a pivot group anchored at the top of
// the trunk, and a child group's LOCAL rotation is oscillated each frame (the
// anchor is spherified normally; only the child tilts, so the planet mapping is
// left intact). The trunk stays planted while the canopy nods.
export function makeTree(ctx, { x, z, trunkH = 3.2, crown } = {}) {
  ctx.colliders.push({ x, z, r: 0.45 });
  const trunk = inkedMesh(new THREE.CylinderGeometry(0.16, 0.22, trunkH, 7), '#231d18', { k: 1.05 });
  trunk.position.set(x, trunkH / 2, z); ctx.scene.add(trunk);

  const pivotY = trunkH * 0.92;                 // canopy hinges just below where it meets the trunk
  const anchor = new THREE.Group();
  anchor.position.set(x, pivotY, z); ctx.scene.add(anchor);
  const sway = new THREE.Group(); anchor.add(sway);

  const blobs = crown || [[0, 3.8, 0, 1.4], [0.7, 4.3, 0.3, 1.0], [-0.6, 4.2, -0.4, 1.05], [0.1, 4.9, 0, 0.9]];
  blobs.forEach(([ox, oy, oz, r], i) => {
    const m = new THREE.Mesh(LEAF_GEO, toonMat(LEAF[i % LEAF.length]));
    m.scale.setScalar(r);
    m.position.set(ox, oy - pivotY, oz);        // blob positions are relative to the pivot
    m.rotation.set(ctx.rng(), ctx.rng(), ctx.rng());
    sway.add(m);
  });

  if (ctx.animators) {
    const ph = ctx.rng() * 6.283, fr = 0.45 + ctx.rng() * 0.3, amp = 0.05 + ctx.rng() * 0.04;
    ctx.animators.push((t) => {
      sway.rotation.z = Math.sin(t * fr + ph) * amp;
      sway.rotation.x = Math.cos(t * fr * 0.8 + ph) * amp * 0.6;
    });
  }
}

// A potted plant — pot + several fronds. `scale` sizes the whole thing. Fuller
// than the old two-leaf version (more drawn-looking foliage).
export function makePottedPlant(ctx, { x, z, scale = 1 }) {
  const s = scale;
  const pot = inkedMesh(new THREE.CylinderGeometry(0.16 * s, 0.20 * s, 0.34 * s, 8), '#dcdad6', { k: 1.05 });
  pot.position.set(x, 0.17 * s, z); ctx.scene.add(pot);
  makeLeaf(ctx, { x, y: 0.34 * s + 0.20 * s, z, r: 0.30 * s, tone: LEAF[1] });
  makeLeaf(ctx, { x: x + 0.13 * s, y: 0.34 * s + 0.40 * s, z: z - 0.05 * s, r: 0.20 * s, tone: LEAF[3] });
  makeLeaf(ctx, { x: x - 0.12 * s, y: 0.34 * s + 0.34 * s, z: z + 0.07 * s, r: 0.18 * s, tone: LEAF[2] });
  makeLeaf(ctx, { x: x + 0.02 * s, y: 0.34 * s + 0.56 * s, z, r: 0.14 * s, tone: LEAF[0] });
}

// Overhanging ivy/vine down a wall — leaves scattered up a column. `height` sets
// how far it climbs.
export function makeVine(ctx, { x, z, height }) {
  for (let y = 0.4; y < height; y += 0.55)
    makeLeaf(ctx, { x: x + ctx._rand(-0.18, 0.18), y, z: z + ctx._rand(-0.4, 0.4), r: 0.24 + ctx.rng() * 0.12, tone: LEAF[(y * 7 | 0) % LEAF.length] });
}
