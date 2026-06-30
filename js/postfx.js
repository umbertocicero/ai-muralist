import * as THREE from 'three';
import { CONFIG } from './config.js';

// ===========================================================================
//  MangaPost — hand-rolled full-screen post-processing pass (no addons, no
//  Three.js version bump). Renders the scene into an offscreen target, then
//  draws a full-screen quad that turns the cel-shaded 3D image into an inked
//  manga panel:
//
//    1. Luminance Sobel  → ink lines at tonal boundaries (cel terminator,
//       windows, overlapping roofs) that silhouette outlines alone miss.
//    2. Screen-space halftone + cross-hatch → a tone "sheet" laid over the
//       whole panel; dots in mid shade, diagonal hatching in deep shadow.
//    3. Saturation gate → coloured murals are left untouched (no ink, no
//       tone) so they stay vivid against the B&W world.
//    4. Paper tint + vignette + fine grain → printed-page feel.
//
//  Everything runs on the colour buffer only (bounded ops), so it cannot
//  black-out the scene. Colour-managed in display space via a 1/2.2 ↔ 2.2
//  round-trip so tone thresholds stay perceptual regardless of encoding.
// ===========================================================================

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2  uResolution;
  uniform float uToneScale;   // halftone dot frequency
  uniform float uEdge;        // ink-edge strength (0 disables)
  uniform float uEdgeLow;     // Sobel threshold low
  uniform float uEdgeHigh;    // Sobel threshold high
  uniform float uGrain;       // paper grain strength
  uniform float uVigDark;     // vignette floor (1 = none)
  varying vec2 vUv;

  const mat2 ROT45 = mat2(0.7071, -0.7071, 0.7071, 0.7071);

  float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

  // sample a neighbour already converted to display space, return its luma
  float dl(vec2 uv){
    vec3 c = clamp(texture2D(tDiffuse, uv).rgb, 0.0, 1.0);
    c = pow(c, vec3(0.4545));
    return luma(c);
  }

  void main(){
    vec2 uv = vUv;
    vec2 px = 1.0 / uResolution;

    // base colour → display space
    vec3 c = clamp(texture2D(tDiffuse, uv).rgb, 0.0, 1.0);
    c = pow(c, vec3(0.4545));

    // greyscale-ness: 1 = grey (city), 0 = saturated (a mural). Protects colour.
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float grey = 1.0 - smoothstep(0.10, 0.24, mx - mn);

    // --- luminance Sobel → ink lines at tonal boundaries ---
    float l00 = dl(uv + px * vec2(-1.0, -1.0));
    float l01 = dl(uv + px * vec2( 0.0, -1.0));
    float l02 = dl(uv + px * vec2( 1.0, -1.0));
    float l10 = dl(uv + px * vec2(-1.0,  0.0));
    float l12 = dl(uv + px * vec2( 1.0,  0.0));
    float l20 = dl(uv + px * vec2(-1.0,  1.0));
    float l21 = dl(uv + px * vec2( 0.0,  1.0));
    float l22 = dl(uv + px * vec2( 1.0,  1.0));
    float gx = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float gy = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float edge = sqrt(gx * gx + gy * gy);
    edge = smoothstep(uEdgeLow, uEdgeHigh, edge) * grey * uEdge;
    c = mix(c, vec3(0.02), edge);

    // NOTE: screentone is no longer applied here. It now lives ON the surfaces
    // (see toon.js applyMangaTone) — world-locked dots that don't crawl as the
    // camera moves. This pass keeps the ink line, paper and vignette.

    // --- paper tint + vignette + grain ---
    c *= vec3(0.996, 0.994, 0.99);                     // near-white paper (barely warm)
    float vig = 1.0 - smoothstep(0.48, 0.95, length(uv - 0.5));
    c *= mix(uVigDark, 1.0, vig);
    float grain = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);
    c += grain * uGrain * grey;

    // back to linear; the renderer's sRGB output encoding finishes the job
    gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

export class MangaPost {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;

    const { x, y } = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Multisampled target keeps edge anti-aliasing (WebGL2); plain RT otherwise.
    const RT = (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget)
      ? THREE.WebGLMultisampleRenderTarget
      : THREE.WebGLRenderTarget;
    this.rt = new RT(x, y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    if (this.rt.samples !== undefined) this.rt.samples = 4;

    const v = CONFIG.visual ?? {};
    const [edgeLow, edgeHigh] = v.edgeThreshold ?? [0.16, 0.40];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:    { value: this.rt.texture },
        uResolution: { value: new THREE.Vector2(x, y) },
        uToneScale:  { value: opts.toneScale ?? 0.26 },
        uEdge:       { value: opts.edgeStrength ?? v.edgeStrength ?? 0.72 },
        uEdgeLow:    { value: edgeLow },
        uEdgeHigh:   { value: edgeHigh },
        uGrain:      { value: opts.grain ?? v.grain ?? 0.016 },
        uVigDark:    { value: opts.vignetteDark ?? v.vignetteDark ?? 0.88 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.scene  = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w, h) {
    const { x, y } = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(x, y);
    this.material.uniforms.uResolution.value.set(x, y);
  }

  render(scene, camera) {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
