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

// ── Surface-locked manga screentone (網点) ──────────────────────────────────
//  A mangaka lays tone *on the surface*: the dots belong to the wall, so they
//  follow its plane and sit still as the view moves — never the screen-space
//  "shower-door" crawl. We inject this into MeshToonMaterial's shader:
//
//   • WORLD-SPACE TRIPLANAR coords → every face (wall, roof, road) gets clean,
//     correctly-oriented tone regardless of how the building is rotated.
//   • KEYED TO THE CEL BANDS → the lit band stays pure white paper, the mid
//     band gets a fixed dot density, deep shadow turns to dots+hatching, the
//     darkest goes solid — a few flat tones, exactly like adhesive tone sheets.
//   • ANTI-ALIASED & DISTANCE-FADED via surface derivatives (fwidth): dot edges
//     stay crisp up close and dissolve smoothly into flat grey far away, so the
//     tone never shimmers or moirés. This is what reads as *beautiful* print.
const TONE_SCALE = 9.0;   // halftone cells per world metre (fine print tone)
export function applyMangaTone(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uToneScale = { value: TONE_SCALE };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWorldPos;\nvarying vec3 vTWorldNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTWorldNrm = mat3(modelMatrix) * objectNormal;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n' +
        'uniform float uToneScale;\n' +
        'varying vec3 vTWorldPos;\n' +
        'varying vec3 vTWorldNrm;\n' +
        'const mat2 TROT45 = mat2(0.7071, -0.7071, 0.7071, 0.7071);')
      .replace('#include <tonemapping_fragment>',
        '{\n' +
        '  vec3 wn = abs(normalize(vTWorldNrm));\n' +
        '  vec2 huv;\n' +
        '  if (wn.y >= wn.x && wn.y >= wn.z) huv = vTWorldPos.xz;\n' +   // floors / roofs
        '  else if (wn.x >= wn.z) huv = vTWorldPos.zy;\n' +             // x-facing walls
        '  else huv = vTWorldPos.xy;\n' +                              // z-facing walls
        '  huv *= uToneScale;\n' +
        '  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
        '  float cut = 0.64;\n' +
        '  float coverage = clamp((cut - lum) / cut, 0.0, 1.0);\n' +
        '  if (coverage > 0.002) {\n' +
        '    vec2 p = TROT45 * huv;\n' +
        '    float dist = length(fract(p) - 0.5);\n' +
        '    float cells = max(fwidth(p.x), fwidth(p.y));\n' +
        '    float r = sqrt(coverage) * 0.66;\n' +
        '    float e = max(fwidth(dist), 0.001) * 1.3;\n' +
        '    float dots = 1.0 - smoothstep(r - e, r + e, dist);\n' +
        '    float hatch = 0.0;\n' +
        '    if (lum < 0.20) {\n' +                                    // deep shadow → cross-hatch
        '      float hv = abs(fract((huv.x + huv.y) * 0.5) - 0.5);\n' +
        '      float he = max(fwidth(hv), 0.001) * 1.3;\n' +
        '      hatch = 1.0 - smoothstep(0.18 - he, 0.18 + he, hv);\n' +
        '    }\n' +
        '    float ink = max(dots, hatch);\n' +
        '    float fade = clamp((cells - 0.45) / 0.6, 0.0, 1.0);\n' +  // sub-pixel → flat tone
        '    ink = mix(ink, coverage, fade);\n' +
        '    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.04), ink * 0.8);\n' +
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
