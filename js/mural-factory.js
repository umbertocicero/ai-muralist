import * as THREE from 'three';
import { CONFIG, SVG_FORBIDDEN } from './config.js';
import { rand } from './helpers.js';
import { DEMO_THOUGHTS, demoSVG } from './demo.js';
import { buildMuralPrompt } from './mural-prompt.js';
import { placeOnPlanet, planetPoint, planetQuat } from './planet.js';

const _UP = new THREE.Vector3(0, 1, 0);
const _yawQ = new THREE.Quaternion();

export class MuralFactory {
  constructor(scene, renderer, city) {
    this.scene    = scene;
    this.city     = city;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
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
  // Three paths, chosen by the resolved settings (js/settings.js):
  //   demo mode (or nothing configured) → procedural offline murals;
  //   a Worker URL → POST to the proxy, adding the visitor's own key as
  //     x-user-api-key when they set one in the Settings panel;
  //   a key but NO Worker → straight to the Anthropic API from the browser
  //     (their CORS opt-in header), so anyone can run the app with just a key.
  async generate(slot, index) {
    const { PW, PH, text } = buildMuralPrompt(slot, index);

    const demo = CONFIG.mode === 'demo' || (!CONFIG.workerUrl && !CONFIG.userApiKey);
    if (demo) {
      await new Promise(r => setTimeout(r, rand(700, 1300)));
      return { thought: DEMO_THOUGHTS[index % DEMO_THOUGHTS.length], svg: demoSVG(PW, PH, index), PW, PH, model: 'demo', prompt: null };
    }

    const direct  = !CONFIG.workerUrl;
    const url     = direct ? 'https://api.anthropic.com/v1/messages' : CONFIG.workerUrl;
    const headers = { 'Content-Type': 'application/json' };
    if (direct) {
      headers['x-api-key'] = CONFIG.userApiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (CONFIG.userApiKey) {
      headers['x-user-api-key'] = CONFIG.userApiKey;   // proxy bills the visitor's key
    }

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
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
      return { ...parsed, PW, PH, model: CONFIG.model, prompt: text };   // provenance for the detail view
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
          const c2d = canvas.getContext('2d');
          c2d.drawImage(img, 0, 0, result.PW, result.PH);
          URL.revokeObjectURL(url);

          // Bake a PRIMER CASING into the texture: a paper-light margin ring
          // with a dark ink line outside it — like the primed edge of a real
          // piece. This is what keeps the mural readable in EVERY light: on a
          // near-black shaded wall the light margin pops, in a blown-out
          // white zone the ink line still draws the frame. Baked in the
          // texture, so it costs nothing at render time.
          const mSz = Math.min(result.PW, result.PH);
          const ink = Math.max(2, Math.round(mSz * 0.018));   // outer ink line
          const mar = Math.max(3, Math.round(mSz * 0.03));    // paper margin
          c2d.strokeStyle = '#f4f1ea';
          c2d.lineWidth = mar * 2;
          c2d.strokeRect(ink + mar * 0.5, ink + mar * 0.5, result.PW - ink * 2 - mar, result.PH - ink * 2 - mar);
          c2d.strokeStyle = '#141414';
          c2d.lineWidth = ink;
          c2d.strokeRect(ink * 0.5, ink * 0.5, result.PW - ink, result.PH - ink);

          const tex        = new THREE.CanvasTexture(canvas);
          tex.encoding     = THREE.sRGBEncoding;
          tex.needsUpdate  = true;
          tex.anisotropy   = this.maxAniso;

          // Unlit material — the mural keeps its full vivid colour regardless
          // of the B&W scene lighting, so it reads as a burst of paint on a
          // grey wall (the only colour in the world).
          //
          // It's also a slightly TRANSPARENT overlay: KAI paints right across the
          // doors and windows, and at this opacity the dark glass/door panes
          // beneath show through faintly — so you can still read that there's a
          // window or a doorway under the paint, like spray on a real shutter.
          // Drawn in the transparent pass (after the opaque facade) so the panes
          // it covers are already there to bleed through.
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(slot.wallW * CONFIG.muralCoverW, slot.wallH * CONFIG.muralCoverH),
            new THREE.MeshBasicMaterial({
              map: tex, transparent: true, opacity: CONFIG.muralOpacity ?? 0.85,
              // fog:false — the scene fog would grey the paint out at distance,
              // and the mural must stay the one vivid thing in the world no
              // matter how under- or over-lit its wall is. Unlit + fogless =
              // constant full colour from every angle and range.
              fog: false,
              polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
            })
          );

          // Place the mural in the BUILDING'S RIGID FRAME, not the local
          // surface frame. The building is one rigid box tangent at its own
          // centre; a mural spherified at its own (x,z) gets the LOCAL tangent
          // orientation, which diverges from the wall plane by the arc angle
          // between the two anchors (~5° here). Over a tall wall that lean
          // reaches ±0.3–0.5 — enough for the wall to lean OVER the paint and
          // swallow it (murals that "disappeared" on some walls). Building the
          // transform from the building's own transport quaternion keeps the
          // plane EXACTLY parallel to the wall with a uniform OUT gap, clear of
          // panes/sills (≤0.15) and the redesigned door (≤0.2), and lands it on
          // the same floor datum as the lifted facade fittings. At 0.30 the
          // translucent paint sits IN FRONT of every flush fitting, so windows
          // and doors ghost through the mural instead of piercing it.
          // Seat the mural on the building's RIGID box exactly like the windows
          // (city._seatFlatPoint replicates the box's centre-radial orientation +
          // footprint sink/stretch). The old build used planetPoint(cx,0,cz)+raw
          // slot.py, which ignored the sink/stretch and left the paint up to ~0.35 m
          // too far out radially — floating off the wall, worse low on tall blocks.
          // OUT is small now that fittings sit flush: just clear of the panes/sills.
          const OUT = 0.13;
          const yaw = Math.atan2(slot.nx, slot.nz);
          _yawQ.setFromAxisAngle(_UP, yaw);
          const bld = this.city?.buildings?.[slot.buildingIdx];
          if (bld && this.city._seatFlatPoint) {
            const q = planetQuat(bld.cx, bld.cz, new THREE.Quaternion());
            this.city._seatFlatPoint(
              slot.px + slot.nx * OUT, slot.py, slot.pz + slot.nz * OUT,
              bld.cx, bld.cz, bld.top, bld.hw, bld.hd, plane.position);
            plane.quaternion.copy(q).multiply(_yawQ);
          } else {
            placeOnPlanet(plane,
              slot.px + slot.nx * OUT, slot.py, slot.pz + slot.nz * OUT, _yawQ);
          }

          // Murals must live under city.north (inside worldRoot) so they rotate
          // with the planet — adding to scene would leave them fixed in world
          // space while the planet spins underneath them.
          const parent = this.city?.north ?? this.scene;
          parent.add(plane);
          slot.mesh = plane;

          // Shadow veil: a coplanar shadow-catcher a hair in FRONT of the mural.
          // The mural itself is unlit (always vivid), so building shadows that
          // fall across the wall would otherwise skip it — leaving a bright
          // "sticker" floating on a shaded wall. This transparent ShadowMaterial
          // plane lays those cast shadows over the mural as a LIGHT veil — just a
          // hint of shade. It is deliberately weak: the scene's raking key light
          // now throws deep, near-black wall shadows, and a heavy veil there
          // sank the mural into the wall so you couldn't see it. Kept faint, the
          // mural stays the vivid focal point (the only colour in the world) even
          // on the shaded side of the street.
          const shadowMesh = new THREE.Mesh(
            plane.geometry,
            new THREE.ShadowMaterial({
              opacity: 0.16, transparent: true, depthWrite: false,
              polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
            })
          );
          shadowMesh.receiveShadow = true;
          if (bld && this.city._seatFlatPoint) {
            const q = planetQuat(bld.cx, bld.cz, new THREE.Quaternion());
            this.city._seatFlatPoint(
              slot.px + slot.nx * (OUT + 0.01), slot.py, slot.pz + slot.nz * (OUT + 0.01),
              bld.cx, bld.cz, bld.top, bld.hw, bld.hd, shadowMesh.position);
            shadowMesh.quaternion.copy(q).multiply(_yawQ);
          } else {
            placeOnPlanet(shadowMesh,
              slot.px + slot.nx * (OUT + 0.01), slot.py, slot.pz + slot.nz * (OUT + 0.01), _yawQ);
          }
          parent.add(shadowMesh);
          slot.shadowMesh = shadowMesh;
          resolve();
        } catch (e) { fail(e); }
      };
      img.src = url;
    });
  }
}
