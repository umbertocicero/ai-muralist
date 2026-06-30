import * as THREE from 'three';
import { CONFIG } from './config.js';

const vis = () => CONFIG.visual ?? {};

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
  const [deep, mid, lit] = vis().celShade ?? [48, 175, 255];
  const data = new Uint8Array([
    deep, deep, deep, 255,
    mid,  mid,  mid,  255,
    lit,  lit,  lit,  255,
  ]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _grad = tex;
  return tex;
}

// Cel-shaded material (flat banded light) with SURFACE-LOCKED manga screentone
// injected into the shader (see applyMangaTone). Materials are CACHED by their
// parameters: the scene reuses one shared material per colour instead of
// allocating thousands (huge memory + GL-state win). Treat the result as
// immutable — never mutate a returned material; pass options (e.g. `side`)
// instead so distinct variants get distinct cache slots.
const _matCache = new Map();
export function toonMat(color, { transparent = false, opacity = 1, side = THREE.FrontSide } = {}) {
  const key = `${color}|${transparent ? 1 : 0}|${opacity}|${side}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), transparent, opacity, side });
    applyMangaTone(m);
    _matCache.set(key, m);
  }
  return m;
}

// ── Surface-locked manga hatching (ハッチング) ───────────────────────────────
//  A mangaka shades with INK STROKES, not dot screens: parallel pen lines laid
//  on the surface, crossing into cross-hatch where the shadow deepens. We lay
//  those strokes *on the surface* (world-space triplanar) so they belong to the
//  wall and sit still as the view moves — never a screen-space "shower-door"
//  crawl. Injected into MeshToonMaterial's shader:
//
//   • WORLD-SPACE TRIPLANAR coords → every face (wall, roof, road) gets clean,
//     correctly-oriented strokes regardless of how the building is rotated.
//   • KEYED TO THE CEL BANDS → lit band stays pure white paper, mid shade gets
//     thin single-direction hatching, deep shadow crosses into cross-hatch, the
//     darkest fills toward solid — exactly like hand-inked manga shading.
//   • ANTI-ALIASED & DISTANCE-FADED via surface derivatives (fwidth): stroke
//     edges stay crisp up close and dissolve smoothly into flat grey far away,
//     so the hatching never shimmers or moirés.
export function applyMangaTone(mat) {
  mat.onBeforeCompile = (shader) => {
    const v = vis();
    shader.uniforms.uToneScale     = { value: v.toneScale      ?? 4.2 };
    shader.uniforms.uHatchCut      = { value: v.hatchCut       ?? 0.58 };
    shader.uniforms.uCrossHatchAt  = { value: v.crossHatchAt   ?? 0.72 };
    shader.uniforms.uHatchStrength = { value: v.hatchStrength  ?? 0.28 };
    shader.uniforms.uSkipHoriz     = { value: (v.skipHorizHatch ?? true) ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWorldPos;\nvarying vec3 vTWorldNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTWorldNrm = mat3(modelMatrix) * objectNormal;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n' +
        'uniform float uToneScale;\n' +
        'uniform float uHatchCut;\n' +
        'uniform float uCrossHatchAt;\n' +
        'uniform float uHatchStrength;\n' +
        'uniform float uSkipHoriz;\n' +
        'varying vec3 vTWorldPos;\n' +
        'varying vec3 vTWorldNrm;\n' +
        'const mat2 TROT45 = mat2(0.7071, -0.7071, 0.7071, 0.7071);')
      .replace('#include <tonemapping_fragment>',
        '{\n' +
        '  vec3 wn = abs(normalize(vTWorldNrm));\n' +
        '  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
        '  float cut = uHatchCut;\n' +
        '  float coverage = clamp((cut - lum) / cut, 0.0, 1.0);\n' +
        '  bool horiz = wn.y >= wn.x && wn.y >= wn.z;\n' +
        '  if (coverage > 0.004 && !(uSkipHoriz > 0.5 && horiz)) {\n' +
        '  vec2 huv;\n' +
        '  if (horiz) huv = vTWorldPos.xz;\n' +
        '  else if (wn.x >= wn.z) huv = vTWorldPos.zy;\n' +
        '  else huv = vTWorldPos.xy;\n' +
        // rotate into a 45° stroke frame; .x runs across the first hatch set,
        // .y across the perpendicular (cross-hatch) set
        '    vec2 p = TROT45 * huv * uToneScale;\n' +
        '    float ax = abs(fract(p.x) - 0.5);\n' +                    // dist to nearest stroke (set 1)
        // stroke half-width grows with shade: thin in mid shadow, fat (→solid)
        // in the darkest. Capped so deep shade reads as dense hatch, not a blob.
        '    float w1 = clamp(coverage, 0.0, 1.0) * 0.26;\n' +
        '    float e1 = max(fwidth(p.x), 0.0009) * 1.2;\n' +
        '    float ink = 1.0 - smoothstep(w1 - e1, w1 + e1, ax);\n' +
        '    if (coverage > uCrossHatchAt) {\n' +                                // deep shadow only → cross-hatch
        '      float ay = abs(fract(p.y) - 0.5);\n' +
        '      float w2 = (coverage - uCrossHatchAt) / max(1.0 - uCrossHatchAt, 0.001) * 0.55;\n' +
        '      float e2 = max(fwidth(p.y), 0.0009) * 1.2;\n' +
        '      ink = max(ink, 1.0 - smoothstep(w2 - e2, w2 + e2, ay));\n' +
        '    }\n' +
        '    float cells = max(fwidth(p.x), fwidth(p.y));\n' +
        '    float fade = clamp((cells - 0.5) / 0.6, 0.0, 1.0);\n' +   // sub-pixel strokes → flat tone
        '    ink = mix(ink, coverage, fade);\n' +
        '    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.05), ink * uHatchStrength);\n' +
        '  }\n' +
        '}\n' +
        '#include <tonemapping_fragment>');
  };
}

// Shared ink-outline materials, one per colour (default near-black).
const _inkCache = new Map();
function inkMat(color) {
  let m = _inkCache.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }); _inkCache.set(color, m); }
  return m;
}

function inkScale(k) {
  const v = vis();
  const base = k ?? v.inkDefault ?? 1.012;
  const w = v.inkWeight ?? 0.58;
  return 1 + (base - 1) * w;
}

// Add a black ink outline to a mesh (inverted-hull). `k` is the expansion
// factor — larger geometry gets a proportionally heavier line, which reads as
// natural manga line-weight variation. Returns the outline mesh.
export function addInk(mesh, k, color = 0x141414) {
  const ink = new THREE.Mesh(mesh.geometry, inkMat(color));
  ink.scale.setScalar(inkScale(k));
  ink.castShadow = false;
  ink.receiveShadow = false;
  mesh.add(ink); // child → inherits parent transform, expands around geometry centre
  return ink;
}

// Convenience: build a toon mesh + ink outline in one call.
export function inkedMesh(geometry, color, { k, cast = true, receive = false } = {}) {
  const mesh = new THREE.Mesh(geometry, toonMat(color));
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  addInk(mesh, k);
  return mesh;
}
