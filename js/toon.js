import * as THREE from 'three';

// ===========================================================================
//  Manga / anime non-photorealistic rendering helpers.
//
//  Two techniques combine to make 3D geometry read as a hand-drawn B&W manga
//  panel instead of smooth-shaded polygons:
//
//   1. CEL / TOON SHADING — MeshToonMaterial with a stepped gradient map gives
//      flat banded light (white · grey · dark) instead of a smooth gradient.
//   2. INK OUTLINE — an "inverted hull": each mesh is drawn a second time,
//      slightly enlarged, with back-faces only, in near-black. The shell pokes
//      out past the silhouette → a clean black ink contour, exactly like the
//      pen lines in the reference drawings.
// ===========================================================================

let _grad = null;

// 3-band grayscale ramp. Nearest filtering = hard steps (the cel look).
export function gradientMap() {
  if (_grad) return _grad;
  const data = new Uint8Array([
     78,  78,  78, 255,   // deep shade
    168, 168, 168, 255,   // mid tone
    255, 255, 255, 255,   // lit
  ]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _grad = tex;
  return tex;
}

// Cel-shaded material (flat banded light). Screentone is applied globally by
// the MangaPost postfx pass rather than per-material, so it also covers cast
// shadows on the ground and works consistently across all geometry.
//
// Materials are CACHED by their parameters: the scene reuses one shared
// material per colour instead of allocating thousands (huge memory + GL-state
// win). Treat the result as immutable — never mutate a returned material; pass
// options (e.g. `side`) instead so distinct variants get distinct cache slots.
const _matCache = new Map();
export function toonMat(color, { transparent = false, opacity = 1, side = THREE.FrontSide } = {}) {
  const key = `${color}|${transparent ? 1 : 0}|${opacity}|${side}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), transparent, opacity, side });
    _matCache.set(key, m);
  }
  return m;
}

// Shared ink-outline materials, one per colour (default near-black).
const _inkCache = new Map();
function inkMat(color) {
  let m = _inkCache.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }); _inkCache.set(color, m); }
  return m;
}

// Add a black ink outline to a mesh (inverted-hull). `k` is the expansion
// factor — larger geometry gets a proportionally heavier line, which reads as
// natural manga line-weight variation. Returns the outline mesh.
export function addInk(mesh, k = 1.03, color = 0x141414) {
  const ink = new THREE.Mesh(mesh.geometry, inkMat(color));
  ink.scale.setScalar(k);
  ink.castShadow = false;
  ink.receiveShadow = false;
  mesh.add(ink); // child → inherits parent transform, expands around geometry centre
  return ink;
}

// Convenience: build a toon mesh + ink outline in one call.
export function inkedMesh(geometry, color, { k = 1.03, cast = true, receive = false } = {}) {
  const mesh = new THREE.Mesh(geometry, toonMat(color));
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  addInk(mesh, k);
  return mesh;
}
