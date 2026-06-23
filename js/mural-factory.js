import * as THREE from 'three';
import { CONFIG, SVG_FORBIDDEN } from './config.js';
import { rand } from './helpers.js';
import { DEMO_THOUGHTS, demoSVG } from './demo.js';

export class MuralFactory {
  constructor(scene, renderer) {
    this.scene    = scene;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  // ---- Prompt building ----------------------------------------------------
  _aspectDesc(slot) {
    const r = slot.wallH / slot.wallW;
    if (r > 1.3)     return 'tall portrait';
    if (1/r > 1.3)   return 'wide landscape';
    return 'roughly square';
  }

  _buildPrompt(slot, index) {
    const PW = 512;
    const PH = Math.round(512 * (slot.wallH / slot.wallW));
    const text =
`You are KAI, a teenage street artist wandering a grey Japanese neighbourhood.
You paint vivid murals on concrete walls — bursts of colour in a monochrome world.
Your painting style is expressive and hand-drawn, never rigid or geometric.

This is mural #${index}. Use (${index} % 8) to choose your style:

STYLE 0 — UKIYO-E
Flowing organic waves, mountains, wind. Flat colour washes in navy·vermillion·gold.
Use <path d="M...C...C...Z"> with smooth bezier curves for every major shape.

STYLE 1 — SUMI-E
Ink-wash meditation. Sweeping brushstroke paths, varying stroke-width (1–18px),
monochrome grey-black washes with one vivid accent colour bleeding through.
Heavy use of <path> with stroke-linecap="round" and opacity layers.

STYLE 2 — MANGA
Dynamic energy. Speed-line paths radiating from a focal point.
High contrast: near-black ground with electric colour pop (one hue).
Use <path> for motion blur lines, <circle>/<ellipse> for focal elements.

STYLE 3 — WOODBLOCK
Hand-printed feel. Bold organic outlines (stroke-width 3–6) on flat colour fields.
Earth tones: indigo·rust·tan·charcoal. Paths with slightly imperfect curves.

STYLE 4 — ANIME
Cel-shaded scene. Hard contour <path> strokes outlining coloured areas.
Primary palette — red, yellow, blue, white, black — no gradients in fills,
but dramatic gradient sky/background behind the composition.

STYLE 5 — KIRIE (paper cut)
Intricate silhouette work cut from a single vivid colour field.
Organic paper-cut <path> shapes: leaves, waves, birds, branches —
delicate negative space. One accent colour + stark black/white.

STYLE 6 — WABI-SABI
Imperfect beauty. Asymmetric brushed shapes, aged textures.
Overlapping semi-transparent washes in ochre·moss·ash·umber.
Let shapes be irregular, "unfinished", with visible layering.

STYLE 7 — KANJI-ART
Abstract calligraphic forms — not letters, but shapes inspired by brushed kanji.
Thick-to-thin <path> strokes (stroke-width varies 1px to 30px along path),
deep ink gradients, bold sweep gestures across the full canvas.

The wall is ${slot.wallW.toFixed(1)}m wide × ${slot.wallH.toFixed(1)}m tall (${this._aspectDesc(slot)}).

Return your response in EXACTLY this format and nothing else:
THOUGHT: <one sentence, 7-12 words, KAI's raw poetic inner monologue; no quotes, no trailing punctuation, do not start with "I">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">...</svg>

SVG RULES — follow exactly:
TECHNIQUE: Use <path d="..."> with Bezier curve commands (C, Q, S, A) as your PRIMARY drawing tool.
           Avoid using <rect> and <polygon> as main design elements — they produce flat, geometric results.
           Create organic, painted-looking forms with curved paths and expressive strokes.
ALLOWED elements: path circle ellipse line polyline defs linearGradient radialGradient stop g
FORBIDDEN: rect polygon text image use symbol script foreignObject and any href/xlink/url() references
BACKGROUND: first element must be a <rect> or large <path> covering the full viewBox as background only
GRADIENTS: at least 2 gradient definitions in <defs> — use them for depth and painterly washes
COLOUR: at least 5 distinct colours; fill the entire canvas — no bare white areas
STROKES: use stroke attributes on <path> to simulate ink lines and brushwork
LIMIT: maximum 40 elements (not counting <defs> children)
OUTPUT: ONLY the THOUGHT line then the raw SVG. No markdown, no code fences, no comments.`;
    return { PW, PH, text };
  }

  // ---- Response parsing ---------------------------------------------------
  _parse(raw) {
    let thought = 'this grey wall has been waiting for someone like me';
    const tm = raw.match(/THOUGHT:\s*(.+)/i);
    if (tm) thought = tm[1].split('\n')[0].trim().replace(/^["']|["']$/g, '');

    const start = raw.indexOf('<svg');
    const end   = raw.lastIndexOf('</svg>');
    const svg   = (start !== -1 && end !== -1) ? raw.slice(start, end + 6) : null;
    return { thought, svg };
  }

  _validateSvg(svg) {
    if (!svg)                       throw new Error('no_svg');
    if (svg.length > CONFIG.maxSvgBytes) throw new Error('svg_too_large');
    if (SVG_FORBIDDEN.test(svg))    throw new Error('svg_unsafe');
    return svg;
  }

  // ---- Generation ---------------------------------------------------------
  async generate(slot, index) {
    const { PW, PH, text } = this._buildPrompt(slot, index);

    if (!CONFIG.workerUrl) {
      await new Promise(r => setTimeout(r, rand(700, 1300)));
      return { thought: DEMO_THOUGHTS[index % DEMO_THOUGHTS.length], svg: demoSVG(PW, PH, index), PW, PH };
    }

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
    try {
      const res = await fetch(CONFIG.workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CONFIG.model,
          max_tokens: CONFIG.maxTokens,
          temperature: 1,
          messages: [{ role: 'user', content: text }],
        }),
        signal: ctrl.signal,
      });
      if (res.status === 429) throw new Error('rate_limited');
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'api_error');
      const raw = data?.content?.[0]?.text;
      if (!raw) throw new Error('empty_response');
      const parsed = this._parse(raw);
      this._validateSvg(parsed.svg);
      return { ...parsed, PW, PH };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- SVG → CanvasTexture → PlaneGeometry --------------------------------
  apply(slot, result) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([result.svg], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();

      const fail = err => { URL.revokeObjectURL(url); reject(err instanceof Error ? err : new Error('render_failed')); };
      img.onerror = fail;
      img.onload  = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = result.PW;
          canvas.height = result.PH;
          canvas.getContext('2d').drawImage(img, 0, 0, result.PW, result.PH);
          URL.revokeObjectURL(url);

          const tex        = new THREE.CanvasTexture(canvas);
          tex.encoding     = THREE.sRGBEncoding;
          tex.needsUpdate  = true;
          tex.anisotropy   = this.maxAniso;

          // Unlit material — the mural keeps its full vivid colour regardless
          // of the B&W scene lighting, so it reads as a burst of paint on a
          // grey wall (the only colour in the world).
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(slot.wallW * CONFIG.muralCoverW, slot.wallH * CONFIG.muralCoverH),
            new THREE.MeshBasicMaterial({ map: tex })
          );

          // Rotate plane so its +z (normal) aligns with the wall's outward
          // normal — works for any orientation (the town's buildings are
          // rotated, so normals are not axis-aligned).
          plane.rotation.y = Math.atan2(slot.nx, slot.nz);

          // Offset slightly outward along normal to avoid z-fighting
          plane.position.set(
            slot.px + slot.nx * 0.02,
            slot.py,
            slot.pz + slot.nz * 0.02
          );

          this.scene.add(plane);
          slot.mesh = plane;
          resolve();
        } catch (e) { fail(e); }
      };
      img.src = url;
    });
  }
}
