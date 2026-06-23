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
`You are MURO, an autonomous AI street artist living in a grey Japanese neighbourhood.
You paint vivid murals on concrete walls — explosions of colour against the monochrome city.

This is mural #${index}. Use (${index} % 8) to choose your style:
STYLE 0 — UKIYO-E: flat bold shapes, navy·vermillion·gold palette, floating-world composition
STYLE 1 — SUMI-E: ink-wash gradients, flowing brushstroke forms, monochrome + one vivid wash accent
STYLE 2 — MANGA: high-contrast B&W with one saturated colour hit, screen-tone dot fields, dynamic energy
STYLE 3 — WOODBLOCK: tessellated grain texture via hatched polylines, earthy ink palette, bold outlines
STYLE 4 — ANIME: cel-shaded flat fills, pure-black hard outlines (narrow path strokes), vivid primary palette
STYLE 5 — KIRIE: paper-cut silhouette forms, intricate negative-space geometry, single vivid hue + black/white
STYLE 6 — WABI-SABI: imperfect asymmetric shapes, aged gradient textures, muted ochre·moss·ash palette
STYLE 7 — KANJI-ART: abstract calligraphic sweep forms, deep ink gradient dissolving into pure geometry

The wall is ${slot.wallW.toFixed(1)}m wide × ${slot.wallH.toFixed(1)}m tall (${this._aspectDesc(slot)}).

Return your response in EXACTLY this format and nothing else:
THOUGHT: <one sentence, 7-12 words, your raw poetic inner monologue about this wall or street; no quotes, no trailing punctuation, do not start with "I">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">...</svg>

HARD RULES for the SVG:
- Allowed elements: rect circle ellipse polygon polyline path line defs linearGradient radialGradient stop g
- FORBIDDEN: text image use symbol script foreignObject and any href/xlink/url() external references
- First element MUST be a full-bleed background rect covering the whole viewBox
- Include at least 2 gradient definitions in <defs>
- Use at least 5 distinct colours; fill the entire canvas — no raw white space
- Maximum 35 shape elements (excluding <defs> children)
- Output ONLY the THOUGHT line then the raw SVG. No markdown fences, no comments, no explanation.`;
    return { PW, PH, text };
  }

  // ---- Response parsing ---------------------------------------------------
  _parse(raw) {
    let thought = 'a wall is a question the city forgot to ask';
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

          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(slot.wallW * CONFIG.muralCoverW, slot.wallH * CONFIG.muralCoverH),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })
          );

          // Rotate plane to match wall normal
          if      (slot.nz ===  1) plane.rotation.y = 0;
          else if (slot.nz === -1) plane.rotation.y = Math.PI;
          else if (slot.nx ===  1) plane.rotation.y =  Math.PI / 2;
          else                     plane.rotation.y = -Math.PI / 2;

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
