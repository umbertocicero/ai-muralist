import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerpAngle } from './helpers.js';

// azimuth that puts the camera behind a character facing `f` (looking his way)
const behindAzimuth = (f) => Math.atan2(-Math.cos(f), -Math.sin(f));

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
    this._renderPolar = CONFIG.camPolar;   // eased pitch (auto-lifts over buildings)
    this._renderEff   = CONFIG.camRadius;  // eased distance (pulls in to keep KAI visible)
    this.radius       = CONFIG.camRadius;
    this.targetRadius = CONFIG.camRadius;

    this.velAz = 0; this.velPolar = 0;            // orbit momentum
    this.pivot       = new THREE.Vector3(CONFIG.charStart.x, 0, CONFIG.charStart.z);
    this.pivotTarget = this.pivot.clone();
    this.following   = true;
    this._cine       = null;     // mural slot the camera is "watching" while KAI paints
    this._cineAz     = 0;
    this._cinePolar  = CONFIG.camPolar;
    this.lookY       = CONFIG.camLookY;     // height the camera aims at
    this.lookYTarget = CONFIG.camLookY;

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
    this.lookYTarget = CONFIG.camLookY;
    this._clampPivot();
    this._detach();
  }

  _travel(clientX, clientY) {
    const g = this._groundAt(clientX, clientY);
    if (!g) return;
    if (this.city?.isColliding(g.x, g.z)) return;   // stay on the streets
    this.lookYTarget = CONFIG.camLookY;
    this.pivotTarget.set(g.x, 0, g.z);
    this._clampPivot();
    this._detach();
  }

  // Fly to a painted mural and frame it head-on (sidebar click → Street-View).
  // t: { px, py, pz, nx, nz }  — wall point + outward normal.
  focusMural(t) {
    if (!t) return;
    this._detach();
    this.velAz = this.velPolar = 0;
    this.pivotTarget.set(t.px, 0, t.pz);
    this.lookYTarget  = t.py;
    this.azimuth      = Math.atan2(t.nz, t.nx);   // camera on the wall's front side
    this.polar        = 1.5;                       // near-level, looking at the wall
    this.targetRadius = 6.0;
    this._clampPivot();
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

  reattach(charPos, facing = 0) {
    this.following = true;
    this._cine = null;
    this.ui.cameraFollowing = true;
    this.lookYTarget = CONFIG.camLookY;
    this.targetRadius = CONFIG.camRadius;
    this.pivotTarget.set(charPos.x, 0, charPos.z);
    this.azimuth = behindAzimuth(facing);   // snap straight behind KAI
    this.velAz = 0;
  }

  // ── Cinematic: watch KAI paint a wall, framing the mural + him ────────────
  // Move to a 3/4 view in front of the wall, looking at the mural; KAI stands
  // in front of it (between camera and wall) so both read. The rooftop-lift
  // safety still applies, so in a tight lane it rises to a high 3/4 instead of
  // backing into the building opposite.
  watchMural(slot) {
    if (!slot) return;
    this._cine = slot;
    this.ui.cameraFollowing = true;           // it's auto-framing, hide the button
    this.following = false;
    this._cineAz = Math.atan2(slot.nz, slot.nx) + 0.45;  // in front + a 3/4 offset
    this._cinePolar = 1.3;
    this.targetRadius = 5;                                // closer on KAI + wall
    this.lookYTarget = slot.py + 0.45;
    // aim between the wall and where KAI stands, so both fill the frame
    this._cinePivot = { x: slot.px + slot.nx * 0.85, z: slot.pz + slot.nz * 0.85 };
    this.pivotTarget.set(this._cinePivot.x, 0, this._cinePivot.z);
    this._clampPivot();
  }

  // Mural finished → zoom in tighter and more head-on to admire it.
  admireMural(slot) {
    if (!slot) return;
    this._cine = slot;
    this.following = false;
    this.ui.cameraFollowing = true;
    this._cineAz = Math.atan2(slot.nz, slot.nx) + 0.22;   // more frontal
    this._cinePolar = 1.34;
    this.targetRadius = 4.2;
    this.lookYTarget = slot.py + 0.2;
    this._cinePivot = { x: slot.px, z: slot.pz };          // centre on the mural
    this.pivotTarget.set(slot.px, 0, slot.pz);
    this._clampPivot();
  }

  // Done painting → rise back up and smoothly resume the follow-behind (the
  // follow easing swings the azimuth back behind KAI, no snap).
  releaseWatch() {
    this._cine = null;
    this.following = true;
    this.ui.cameraFollowing = true;
    this.lookYTarget = CONFIG.camLookY;
    this.targetRadius = CONFIG.camRadius;
  }

  // ---- per-frame ---------------------------------------------------------
  update(dt, charPos, facing = 0) {
    this._idle += dt;

    if (this._cine) {
      // Watching a mural being painted: ease into the framed 3/4 shot and hold.
      this.pivotTarget.set(this._cinePivot.x, 0, this._cinePivot.z);
      const k = 1 - Math.exp(-dt * 1.8);     // gentle glide into the framed shot
      this.azimuth = lerpAngle(this.azimuth, this._cineAz, k);
      this.polar  += (this._cinePolar - this.polar) * k;
      this.velAz = this.velPolar = 0;
    } else if (this.following) {
      this.pivotTarget.set(charPos.x, 0, charPos.z);
      // Keep the camera behind KAI, looking the way he walks. When not actively
      // dragging, ease the azimuth toward "behind" (so it swings round as he
      // turns); a drag can peek elsewhere and then springs back.
      if (this._ptrs.size === 0) {
        this.azimuth = lerpAngle(this.azimuth, behindAzimuth(facing), 1 - Math.exp(-dt * CONFIG.camFollowSpin));
        this.velAz = 0;
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

    // eased zoom + pivot follow — gentler while the camera is auto-framing
    const cine = !!this._cine;
    const zoomRate   = cine ? 4.5 : CONFIG.camZoomLerp;
    const followRate = cine ? 2.4 : CONFIG.camFollowLerp;
    this.radius += (this.targetRadius - this.radius) * (1 - Math.exp(-dt * zoomRate));
    const pf = 1 - Math.exp(-dt * followRate);
    this.pivot.lerp(this.pivotTarget, pf);
    this.lookY += (this.lookYTarget - this.lookY) * pf;

    // ── Framing ──────────────────────────────────────────────────────────
    let target = this.polar, eff = this.radius;
    if (this.city && (this.following || this._cine)) {
      // AUTO modes: keep KAI in shot. Test the line of sight subject→camera; if
      // a building blocks it, first LIFT the pitch up and over the rooftops to
      // look down past it, and only PULL IN if that isn't enough. Both eased, so
      // the camera gently drifts to keep him visible instead of hiding.
      for (let i = 0; i < 10; i++) {
        eff = this._sightClear(target, this.radius);
        if (eff >= this.radius - 0.05) break;
        if (target <= CONFIG.camPolarMin + 0.02) break;
        target = Math.max(CONFIG.camPolarMin, target - 0.1);
      }
    } else if (this.city) {
      // MANUAL: leave the user's framing alone (wide overviews allowed); only
      // stop the lens from sitting literally inside a building.
      for (let d = this.radius; d > 3; d -= 0.6) {
        const top = this.city.hitsBuilding(
          this.pivot.x + Math.cos(this.azimuth) * Math.sin(target) * d,
          this.pivot.z + Math.sin(this.azimuth) * Math.sin(target) * d);
        if (top === 0 || Math.cos(target) * d + 1.5 > top + 0.4) { eff = d; break; }
      }
    }
    this._renderPolar += (target - this._renderPolar) * (1 - Math.exp(-dt * 5));
    this._renderEff   += (eff   - this._renderEff)   * (1 - Math.exp(-dt * 6));

    const sinP = Math.sin(this._renderPolar), cosP = Math.cos(this._renderPolar);
    this.camera.position.set(
      this.pivot.x + Math.cos(this.azimuth) * sinP * this._renderEff,
      cosP * this._renderEff + 1.5,
      this.pivot.z + Math.sin(this.azimuth) * sinP * this._renderEff,
    );
    this.camera.lookAt(this.pivot.x, this.lookY, this.pivot.z);
  }

  // Max clear distance from the subject toward the camera (at `polar`/`radius`)
  // before a building blocks the line of sight; returns `radius` if fully clear.
  _sightClear(polar, radius) {
    const cx = this.pivot.x, cz = this.pivot.z;
    // If the focus itself is inside a building (a manual pan/overview, never KAI
    // who's always on open ground), there's nothing to keep visible — don't
    // collapse the distance.
    if (this.city.hitsBuilding(cx, cz) > 0) return radius;
    const sinP = Math.sin(polar), cosP = Math.cos(polar);
    const dx = Math.cos(this.azimuth) * sinP, dz = Math.sin(this.azimuth) * sinP;
    const camY = cosP * radius + 1.5;
    const sy = 1.5;                          // KAI's upper body height
    const n = Math.max(4, Math.ceil(radius / 0.7));
    for (let i = 1; i <= n; i++) {
      const f = i / n, d = f * radius;
      const top = this.city.hitsBuilding(cx + dx * d, cz + dz * d);
      if (top > 0 && sy + (camY - sy) * f < top + 0.3) return Math.max(2.5, (i - 1) / n * radius);
    }
    return radius;
  }
}
