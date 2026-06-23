import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp } from './helpers.js';

export class CameraRig {
  // ui: shared reactive uiState — rig writes ui.cameraFollowing
  constructor(camera, canvas, ui) {
    this.camera  = camera;
    this.ui      = ui;
    this.pivot   = new THREE.Vector3(0, 0, 14);
    this.azimuth = 0;
    this.polar   = CONFIG.camPolar;
    this.radius  = CONFIG.camRadius;
    this.following = true;

    this._drag    = false;
    this._lx = 0; this._ly = 0;
    this._touches = [];

    this._bind(canvas);
  }

  _bind(el) {
    // Mouse
    el.addEventListener('mousedown', e => {
      this._drag = true;
      this._lx = e.clientX; this._ly = e.clientY;
      this._detach();
    });
    window.addEventListener('mousemove', e => {
      if (!this._drag) return;
      this._orbit(e.clientX - this._lx, e.clientY - this._ly);
      this._lx = e.clientX; this._ly = e.clientY;
    });
    window.addEventListener('mouseup', () => { this._drag = false; });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.radius = clamp(this.radius + e.deltaY * 0.06, CONFIG.camRadiusMin, CONFIG.camRadiusMax);
    }, { passive: false });

    // Touch
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      this._touches = Array.from(e.touches);
      if (e.touches.length === 1) {
        this._lx = e.touches[0].clientX;
        this._ly = e.touches[0].clientY;
        this._detach();
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1) {
        this._orbit(e.touches[0].clientX - this._lx, e.touches[0].clientY - this._ly);
        this._lx = e.touches[0].clientX;
        this._ly = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const cur  = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY);
        const prev = this._touches.length === 2
          ? Math.hypot(this._touches[0].clientX - this._touches[1].clientX,
                       this._touches[0].clientY - this._touches[1].clientY)
          : cur;
        this.radius = clamp(this.radius - (cur - prev) * 0.12, CONFIG.camRadiusMin, CONFIG.camRadiusMax);
        this._touches = Array.from(e.touches);
      }
    }, { passive: false });

    el.addEventListener('touchend', e => { this._touches = Array.from(e.touches); });
  }

  _orbit(dx, dy) {
    const s = CONFIG.camDragSensitivity;
    this.azimuth += dx * s;
    this.polar    = clamp(this.polar + dy * s * 0.7, CONFIG.camPolarMin, CONFIG.camPolarMax);
  }

  _detach() {
    if (!this.following) return;
    this.following        = false;
    this.ui.cameraFollowing = false;
  }

  reattach(charPos) {
    this.following          = true;
    this.ui.cameraFollowing = true;
    this.pivot.set(charPos.x, 0, charPos.z);
  }

  update(dt, charPos) {
    if (this.following) {
      this.azimuth += dt * CONFIG.camOrbitSpeed;
      this.pivot.lerp(new THREE.Vector3(charPos.x, 0, charPos.z), CONFIG.camFollowLerp);
    }
    const sinP = Math.sin(this.polar);
    const cosP = Math.cos(this.polar);
    this.camera.position.set(
      this.pivot.x + Math.cos(this.azimuth) * sinP * this.radius,
      cosP * this.radius + 1.5,
      this.pivot.z + Math.sin(this.azimuth) * sinP * this.radius
    );
    this.camera.lookAt(this.pivot.x, 1.5, this.pivot.z);
  }
}
