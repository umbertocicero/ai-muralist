import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerpAngle } from './helpers.js';
import { planetPoint, PLANET_R } from './planet.js';

// ===========================================================================
//  Camera rig — Apple-grade feel, Google-Street-View navigation.
//
//  • ORBIT  : drag (or one finger) rotates around the focus, with momentum
//             that decays smoothly after you let go. Orbiting keeps the focus
//             centred, so it keeps following KAI.
//  • ZOOM   : wheel / pinch eases the distance toward a target (never a hard
//             jump) and zooms *toward the cursor* when you've taken manual
//             control, the way Apple Maps / trackpad pinch behaves.
//  • PAN    : two-finger drag, or shift / middle-drag, slides the focus along
//             the ground.
//  • TRAVEL : double-click / double-tap the pavement to glide to that spot,
//             like clicking the arrows in Street View. Won't enter buildings.
//
//  Everything is frame-rate independent (exponential smoothing on dt).
// ===========================================================================

export class CameraRig {
  constructor(camera, canvas, ui, city) {
    this.camera = camera;
    this.canvas = canvas;
    this.ui     = ui;
    this.city   = city;

    this.azimuth      = CONFIG.camAzimuth;
    this.polar        = CONFIG.camPolar;
    this._renderPolar = CONFIG.camPolar;   // eased pitch (auto-lifts over buildings)
    this._renderEff   = CONFIG.camRadius;  // eased distance (pulls in to keep KAI visible)
    this.radius       = CONFIG.camRadius;
    this.targetRadius = CONFIG.camRadius;

    this.velAz = 0; this.velPolar = 0;            // orbit momentum
    // pivot = the look-at point, a world point ON the little planet
    this.R           = PLANET_R;
    this.pivot       = planetPoint(CONFIG.charStart.x, CONFIG.camLookY, CONFIG.charStart.z, new THREE.Vector3(), this.R);
    this.pivotTarget = this.pivot.clone();
    this.following   = true;
    this._cine       = null;     // mural slot the camera is "watching" while KAI paints
    this._cineAz     = 0;
    this._cinePolar  = CONFIG.camPolar;
    this.lookY       = CONFIG.camLookY;     // height the camera aims at
    this.lookYTarget = CONFIG.camLookY;

    this._ray   = new THREE.Raycaster();
    this._ndc   = new THREE.Vector2();
    this._up = new THREE.Vector3(); this._t = new THREE.Vector3();
    this._b  = new THREE.Vector3(); this._off = new THREE.Vector3();
    this._ptrs  = new Map();                       // active pointers
    this._mode  = null;                            // 'orbit' | 'pan'
    this._last  = { x: 0, y: 0, t: 0, dx: 0, dy: 0 };
    this._pinch = 0;
    this._lastTapT = 0;
    this._idle  = 0;

    this._bind();
  }

  // ---- input -------------------------------------------------------------
  _bind() {
    const el = this.canvas;

    el.addEventListener('pointerdown', e => {
      el.setPointerCapture?.(e.pointerId);
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._idle = 0;
      this._cine = null;   // user takes over → stop auto-watching the mural
      if (this._ptrs.size === 1) {
        this._mode = (e.shiftKey || e.button === 1) ? 'pan' : 'orbit';
        this._last = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, dy: 0 };
        this.velAz = this.velPolar = 0;
      } else if (this._ptrs.size === 2) {
        this._mode = 'pinch';
        this._pinch = this._pairDist();
        this._pinchMid = this._pairMid();
      }
    });

    window.addEventListener('pointermove', e => {
      const p = this._ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      this._idle = 0;

      if (this._mode === 'orbit') {
        const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
        this._orbit(dx, dy);
        const now = performance.now(), dt = Math.max(1, now - this._last.t) / 1000;
        this._last = { x: e.clientX, y: e.clientY, t: now, dx, dy: dy, dt };
      } else if (this._mode === 'pan') {
        this._pan(e.clientX - this._last.x, e.clientY - this._last.y);
        this._last.x = e.clientX; this._last.y = e.clientY;
      } else if (this._mode === 'pinch') {
        const d = this._pairDist();
        if (this._pinch > 0) {
          this.targetRadius = clamp(this.targetRadius * (this._pinch / d), CONFIG.camRadiusMin, CONFIG.camRadiusMax);
        }
        const mid = this._pairMid();
        this._pan(mid.x - this._pinchMid.x, mid.y - this._pinchMid.y);
        this._pinch = d; this._pinchMid = mid;
      }
    });

    const end = e => {
      if (!this._ptrs.has(e.pointerId)) return;
      this._ptrs.delete(e.pointerId);
      // fling: turn the last drag delta into orbit momentum
      if (this._mode === 'orbit' && this._last.dt) {
        const recent = (performance.now() - this._last.t) < 90;
        if (recent) {
          this.velAz   = -this._last.dx * CONFIG.camDragSensitivity / this._last.dt;
          this.velPolar = this._last.dy * CONFIG.camDragSensitivity * 0.7 / this._last.dt;
        }
      }
      this._mode = this._ptrs.size === 1 ? 'orbit' : null;
      if (this._ptrs.size === 1) {
        const [only] = this._ptrs.values();
        this._last = { x: only.x, y: only.y, t: performance.now(), dx: 0, dy: 0 };
      }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    el.addEventListener('wheel', e => {
      e.preventDefault();
      this._idle = 0;
      this._cine = null;
      this._zoom(e.deltaY, e.clientX, e.clientY);
    }, { passive: false });

    // Street-View travel: double-click / double-tap the ground to glide there
    el.addEventListener('dblclick', e => this._travel(e.clientX, e.clientY));
    el.addEventListener('pointerup', e => {
      if (e.pointerType === 'touch') {
        const now = performance.now();
        if (now - this._lastTapT < 300) this._travel(e.clientX, e.clientY);
        this._lastTapT = now;
      }
    });
  }

  _pairDist() {
    const [a, b] = [...this._ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  _pairMid() {
    const [a, b] = [...this._ptrs.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  _orbit(dx, dy) {
    const s = CONFIG.camDragSensitivity;
    this.azimuth -= dx * s;
    this.polar    = clamp(this.polar - dy * s * 0.7, CONFIG.camPolarMin, CONFIG.camPolarMax);
    this._detach();   // taking manual control → stop following (the Follow button reappears)
  }

  // world point on the little planet under a screen position (null if it misses)
  _planetAt(clientX, clientY) {
    if (!this.city?.planet) return null;
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObject(this.city.planet, false);
    return hits.length ? hits[0].point.clone() : null;
  }

  _zoom(deltaY) {
    this.targetRadius = clamp(this.targetRadius * (1 + deltaY * CONFIG.camZoomStep), CONFIG.camRadiusMin, CONFIG.camRadiusMax);
  }

  // two-finger / shift drag spins the globe → treat as orbit
  _pan(dx, dy) { this._orbit(dx, dy); }

  // double-tap the globe to glide the look-point there (Google-Earth style)
  _travel(clientX, clientY) {
    const g = this._planetAt(clientX, clientY);
    if (!g) return;
    this.pivotTarget.copy(g);
    this._detach();
  }

  // Fly to a painted mural and frame it (sidebar click). t: { px, py, pz }.
  focusMural(t) {
    if (!t) return;
    this._detach();
    this.velAz = this.velPolar = 0;
    planetPoint(t.px, t.py, t.pz, this.pivotTarget, this.R);
    this.polar        = 1.15;
    this.targetRadius = 7.0;
  }

  _detach() {
    if (!this.following) return;
    this.following = false;
    this.ui.cameraFollowing = false;
  }

  reattach(charPos) {
    this.following = true;
    this._cine = null;
    this.ui.cameraFollowing = true;
    this.targetRadius = CONFIG.camRadius;
    planetPoint(charPos.x, CONFIG.camLookY, charPos.z, this.pivotTarget, this.R);
    this.velAz = 0;
  }

  // ── Cinematic: zoom in on the wall KAI is painting ────────────────────────
  watchMural(slot) {
    if (!slot || !this.following) return;     // only auto-frame if KAI was followed
    this._cine = slot;
    this.ui.cameraFollowing = true;           // auto-framing → hide the button
    this.following = false;
    this._cinePolar = 1.18;
    this.targetRadius = 6.5;
    planetPoint(slot.px, slot.py, slot.pz, this.pivotTarget, this.R);
  }

  admireMural(slot) {
    if (!slot || !this._cine) return;
    this._cine = slot;
    this.following = false;
    this.ui.cameraFollowing = true;
    this._cinePolar = 1.22;
    this.targetRadius = 5.0;
    planetPoint(slot.px, slot.py, slot.pz, this.pivotTarget, this.R);
  }

  releaseWatch() {
    if (!this._cine) return;
    this._cine = null;
    this.following = true;
    this.ui.cameraFollowing = true;
    this.targetRadius = CONFIG.camRadius;
  }

  // ---- per-frame ---------------------------------------------------------
  //  Google-Earth orbit around the little planet: the camera always looks at a
  //  pivot point sitting on the sphere, and swings around it in that point's
  //  LOCAL frame (up = the radial direction there). Following keeps the pivot
  //  glued to KAI's spot on the globe; dragging spins the view around it.
  update(dt, charPos) {
    this._idle += dt;

    if (this._cine) {
      this.polar += (this._cinePolar - this.polar) * (1 - Math.exp(-dt * 1.8));
      this.velAz = this.velPolar = 0;
    } else if (this.following) {
      planetPoint(charPos.x, CONFIG.camLookY, charPos.z, this.pivotTarget, this.R);
    }

    // orbit momentum (when not actively dragging)
    if (this._mode !== 'orbit' || this._ptrs.size === 0) {
      this.azimuth += this.velAz * dt;
      this.polar    = clamp(this.polar + this.velPolar * dt, CONFIG.camPolarMin, CONFIG.camPolarMax);
      const decay = Math.exp(-dt / CONFIG.camInertiaTau);
      this.velAz *= decay; this.velPolar *= decay;
      if (Math.abs(this.velAz) < 1e-4) this.velAz = 0;
      if (Math.abs(this.velPolar) < 1e-4) this.velPolar = 0;
    }

    // eased zoom + pivot follow
    const cine = !!this._cine;
    const zoomRate   = cine ? 4.5 : CONFIG.camZoomLerp;
    const followRate = cine ? 2.4 : CONFIG.camFollowLerp;
    this.radius += (this.targetRadius - this.radius) * (1 - Math.exp(-dt * zoomRate));
    this.pivot.lerp(this.pivotTarget, 1 - Math.exp(-dt * followRate));
    this._renderPolar += (this.polar  - this._renderPolar) * (1 - Math.exp(-dt * 6));
    this._renderEff   += (this.radius - this._renderEff)   * (1 - Math.exp(-dt * 6));

    // local frame at the pivot: up = radial; tangent basis (T, B)
    const up = this._up.copy(this.pivot).normalize();
    let T = this._t.set(0, 1, 0).cross(up);
    if (T.lengthSq() < 1e-6) T.set(1, 0, 0);
    T.normalize();
    const B = this._b.copy(up).cross(T).normalize();

    const sinP = Math.sin(this._renderPolar), cosP = Math.cos(this._renderPolar);
    const off = this._off.copy(up).multiplyScalar(cosP)
      .addScaledVector(T, sinP * Math.cos(this.azimuth))
      .addScaledVector(B, sinP * Math.sin(this.azimuth));
    this.camera.position.copy(this.pivot).addScaledVector(off, this._renderEff);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.pivot);
  }
}
