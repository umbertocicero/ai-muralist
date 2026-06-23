import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './helpers.js';

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

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const PIVOT_LIMIT = 64;

export class CameraRig {
  constructor(camera, canvas, ui, city) {
    this.camera = camera;
    this.canvas = canvas;
    this.ui     = ui;
    this.city   = city;

    this.azimuth      = CONFIG.camAzimuth;
    this.polar        = CONFIG.camPolar;
    this.radius       = CONFIG.camRadius;
    this.targetRadius = CONFIG.camRadius;

    this.velAz = 0; this.velPolar = 0;            // orbit momentum
    this.pivot       = new THREE.Vector3(CONFIG.charStart.x, 0, CONFIG.charStart.z);
    this.pivotTarget = this.pivot.clone();
    this.following   = true;

    this._ray   = new THREE.Raycaster();
    this._ndc   = new THREE.Vector2();
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
  }

  // ground-plane hit point under a screen position (null if it misses)
  _groundAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    const hit = new THREE.Vector3();
    return this._ray.ray.intersectPlane(GROUND, hit) ? hit : null;
  }

  _zoom(deltaY, clientX, clientY) {
    const oldR = this.targetRadius;
    this.targetRadius = clamp(oldR * (1 + deltaY * CONFIG.camZoomStep), CONFIG.camRadiusMin, CONFIG.camRadiusMax);
    // zoom toward the cursor only once the user is driving (not while following)
    if (!this.following) {
      const g = this._groundAt(clientX, clientY);
      if (g) {
        const f = (1 - this.targetRadius / oldR) * CONFIG.camZoomToCursor;
        this.pivotTarget.x += (g.x - this.pivotTarget.x) * f;
        this.pivotTarget.z += (g.z - this.pivotTarget.z) * f;
        this._clampPivot();
      }
    }
  }

  _pan(dx, dy) {
    const k = CONFIG.camPanSpeed * this.radius * 0.0016;
    const az = this.azimuth;
    const right = { x: Math.sin(az), z: -Math.cos(az) };
    const fwd   = { x: -Math.cos(az), z: -Math.sin(az) };
    this.pivotTarget.x += (-right.x * dx - fwd.x * dy) * k;
    this.pivotTarget.z += (-right.z * dx - fwd.z * dy) * k;
    this._clampPivot();
    this._detach();
  }

  _travel(clientX, clientY) {
    const g = this._groundAt(clientX, clientY);
    if (!g) return;
    if (this.city?.isColliding(g.x, g.z)) return;   // stay on the streets
    this.pivotTarget.set(g.x, 0, g.z);
    this._clampPivot();
    this._detach();
  }

  _clampPivot() {
    this.pivotTarget.x = clamp(this.pivotTarget.x, -PIVOT_LIMIT, PIVOT_LIMIT);
    this.pivotTarget.z = clamp(this.pivotTarget.z, -PIVOT_LIMIT, PIVOT_LIMIT);
  }

  _detach() {
    if (!this.following) return;
    this.following = false;
    this.ui.cameraFollowing = false;
  }

  reattach(charPos) {
    this.following = true;
    this.ui.cameraFollowing = true;
    this.pivotTarget.set(charPos.x, 0, charPos.z);
  }

  // ---- per-frame ---------------------------------------------------------
  update(dt, charPos) {
    this._idle += dt;

    if (this.following) {
      this.pivotTarget.set(charPos.x, 0, charPos.z);
      // a whisper of idle drift so a still scene stays alive
      if (this._ptrs.size === 0 && this._idle > 2 && Math.abs(this.velAz) < 1e-3) {
        this.azimuth += CONFIG.camAutoSpin * dt;
      }
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

    // eased zoom + eased pivot follow (frame-rate independent)
    this.radius += (this.targetRadius - this.radius) * (1 - Math.exp(-dt * CONFIG.camZoomLerp));
    const pf = 1 - Math.exp(-dt * CONFIG.camFollowLerp);
    this.pivot.lerp(this.pivotTarget, pf);

    const sinP = Math.sin(this.polar), cosP = Math.cos(this.polar);
    this.camera.position.set(
      this.pivot.x + Math.cos(this.azimuth) * sinP * this.radius,
      cosP * this.radius + 1.5,
      this.pivot.z + Math.sin(this.azimuth) * sinP * this.radius,
    );
    this.camera.lookAt(this.pivot.x, CONFIG.camLookY, this.pivot.z);
  }
}
