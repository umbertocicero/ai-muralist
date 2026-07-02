// ===========================================================================
//  GPU wind — vertex-shader displacement for things too numerous / too batched
//  to animate from JavaScript:
//
//   • WIRES: the whole town's cables are ONE merged LineSegments (that's the
//     point — hundreds of draws collapsed to 1). Mutating its vertex buffer on
//     the CPU every frame would cost work proportional to every cable in town;
//     instead each vertex carries an aWind attribute (sway weight = sinπ along
//     the span so the ENDS STAY PINNED to the poles, plus a per-span phase) and
//     the shader bobs the middle of each span. CPU cost per frame: two uniforms.
//
//   • LEAVES: hundreds of individual foliage blobs, spherified in place with no
//     pivot groups. A tiny per-vertex wobble keyed on object-space position
//     makes every blob rustle without a single JS callback.
//
//  Both injectors CHAIN any existing onBeforeCompile (the manga hatching in
//  toon.js), so the cel/hatch pipeline is untouched. city.update drives the two
//  uniforms with the same shared gust envelope the CPU animators use — cables,
//  crowns, futons and leaves all breathe with one wind.
// ===========================================================================

export const WIND = { shaders: [] };

// Called once per frame (city.update): pushes time + gust strength to every
// wind-enabled shader. This is the entire per-frame CPU cost.
export function tickWind(t, strength) {
  for (const s of WIND.shaders) {
    s.uniforms.uTime.value = t;
    s.uniforms.uWind.value = strength;
  }
}

// Chain a wind injection after whatever onBeforeCompile the material already
// has (e.g. toon.js manga hatching) — never replace it.
function chain(mat, inject) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 1 };
    inject(shader);
    WIND.shaders.push(shader);
  };
}

// Overhead cables: vertical bob of each span's belly. aWind.x = sway weight
// (0 at the poles, 1 mid-span), aWind.y = per-span phase. Displacement runs
// along the local radial (positions are planet-centred), so the cable sags and
// lifts naturally however the span is oriented on the sphere.
export function applyWireWind(mat) {
  chain(mat, (shader) => {
    shader.vertexShader =
      ('attribute vec2 aWind;\nuniform float uTime;\nuniform float uWind;\n' + shader.vertexShader)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
    transformed += normalize(position) * (aWind.x * 0.085 * uWind * sin(uTime * 1.7 + aWind.y));`);
  });
}

// Foliage rustle: a small wobble per vertex, phase-hashed from the vertex's own
// object-space position so each face of the blob shivers slightly differently.
// Object space is the unit icosahedron, so the offset scales with each leaf's
// own size. Injected BEFORE the hatching's vTWorldPos capture, so the ink
// strokes ride the moving surface instead of swimming across it.
export function applyLeafWind(mat) {
  chain(mat, (shader) => {
    shader.vertexShader =
      ('uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
    { float wph = dot(position, vec3(12.9898, 78.233, 37.719));
      transformed += (0.028 * uWind) * vec3(sin(uTime * 2.2 + wph), 0.6 * sin(uTime * 1.8 + wph * 1.31), cos(uTime * 2.05 + wph)); }`);
  });
}
