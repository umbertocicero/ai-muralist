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
     96,  96,  96, 255,   // deep shade
    178, 178, 178, 255,   // mid tone
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

// ---------------------------------------------------------------------------
//  Screen-tone (retino) — manga halftone laid over shadowed faces.
//
//  Real screentone is a sheet of dots placed over the drawing in SCREEN space,
//  not wrapped on the surface. We reproduce that by patching the toon fragment
//  shader (via onBeforeCompile): after lighting + shadows are resolved, any
//  fragment whose luminance falls below `cut` (i.e. it's in shade/shadow) gets
//  black halftone dots whose radius grows as it gets darker. Lit faces stay
//  clean white. Light-agnostic — it reads the already-shaded output colour, so
//  cast shadows on the ground also turn into dot fields.
//
//  Tweakables live in this GLSL block (period, cut, dot darkness).
// ---------------------------------------------------------------------------
const SCREENTONE_GLSL = /* glsl */`
#include <dithering_fragment>
{
  float _lum = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  float _cut = 0.80;                       // luminance below this = "in shade"
  if ( _lum < _cut ) {
    vec2 _p = gl_FragCoord.xy * 0.24;      // dot frequency (screen pixels)
    _p = mat2( 0.7071, -0.7071, 0.7071, 0.7071 ) * _p;  // rotate grid 45°
    vec2 _c = fract( _p ) - 0.5;
    float _d = length( _c );
    float _shade = clamp( ( _cut - _lum ) / _cut, 0.0, 1.0 );  // 0..1 depth of shade
    float _r = 0.15 + _shade * 0.48;       // darker fragment → bigger dot
    float _dot = 1.0 - smoothstep( _r - 0.14, _r + 0.02, _d );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.09 ), _dot * 0.92 );
  }
}
`;

// Shared patch (same function reference → Three reuses one compiled program).
function screentonePatch(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    SCREENTONE_GLSL
  );
}

// Cel-shaded material (flat banded light) + manga screentone in shade.
export function toonMat(color, { transparent = false, opacity = 1, screentone = true } = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    transparent,
    opacity,
  });
  if (screentone) mat.onBeforeCompile = screentonePatch;
  return mat;
}

// Add a black ink outline to a mesh (inverted-hull). `k` is the expansion
// factor — larger geometry gets a proportionally heavier line, which reads as
// natural manga line-weight variation. Returns the outline mesh.
export function addInk(mesh, k = 1.03, color = 0x141414) {
  const ink = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
  );
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
