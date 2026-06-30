import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerpAngle } from './helpers.js';
import { planetPoint, PLANET_R } from './planet.js';

const _WORLD_UP = new THREE.Vector3(0, 1, 0);

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
    // Navigation guard: the town is a cap around the north pole; flat coords run
    // to ±world.half, so its far corners sit this many radians from the pole.
    // Free-roam (drag/travel/zoom-to-cursor) is clamped to here + a small margin
    // so you can sweep the whole town but never drift onto the empty far side and
    // end up looking at it "upside down". Murals all live inside this cap.
    this._maxPivotTheta = Math.hypot(CONFIG.world.half, CONFIG.world.half) / this.R + 0.12;
    this._cine       = null;     // mural slot the camera is "watching" while KAI paints
    this._cineAz     = 0;
    this._cinePolar  = CONFIG.camPolar;
    this.lookY       = CONFIG.camLookY;     // height the camera aims at
    this.lookYTarget = CONFIG.camLookY;

    this._ray   = new THREE.Raycaster();
    this._ndc   = new THREE.Vector2();
    this._up = new THREE.Vector3(); this._t = new THREE.Vector3();
    this._b  = new THREE.Vector3(); this._off = new THREE.Vector3();
    // The whole planet (and KAI) is spun by the app over the day; the rig does
    // all its maths in the planet's UN-spun (north-pole) frame, then rotates its
    // final camera + look-point by this quaternion so it stays glued to KAI as
    // the world turns. Set by the app each frame (null = no spin).
    this.worldQuat = null;
    this._pw = new THREE.Vector3(); this._invQ = new THREE.Quaternion(); this._camL = new THREE.Vector3();
    this._cineN = null;            // slot normal the paint-cam frames from behind
    this._cineSide = 0;            // shoulder offset (rad) for the paint-cam
    this._cineAdmire = false;      // true = admiring a finished mural (frames itself; no occlusion-lift)
    this._snapBehind = false;      // reattach → snap straight behind KAI next frame
    this._offAxis = false;         // user has orbited/panned off the follow axis
    this._ptrs  = new Map();                       // active pointers
    this._mode  = null;                            // 'orbit' | 'pan'
    this._last  = { x: 0, y: 0, t: 0, dx: 0, dy: 0 };
    this._pinch = 0;
    this._lastTapT = 0;
    this._idle  = 0;

    this._bind();
  }

  // ---- input -------------------------------------------------------------
  //  Touch:  one finger drags to spin/tilt the globe (with a fling), two fingers
  //  pinch to zoom (into the spot between them), twist to spin, and slide up/down
  //  to tilt. A clean tap = nothing; a clean double-tap glides there. A small
  //  dead-zone means a tap never accidentally drops the follow-cam.
  _bind() {
    const el = this.canvas;
    const MOVE_EPS = 6;   // px before a touch counts as a drag (not a tap)

    el.addEventListener('pointerdown', e => {
      el.setPointerCapture?.(e.pointerId);
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._idle = 0;
      this._cine = null;   // user takes over → stop auto-watching the mural
      if (this._ptrs.size === 1) {
        this._mode = (e.shiftKey || e.button === 1) ? 'pan' : 'orbit';
        this._last = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, dy: 0, dt: 0 };
        this.velAz = this.velPolar = 0;
        this._moved = false;
        this._downT = performance.now();
      } else if (this._ptrs.size === 2) {
        this._mode = 'pinch';
        this._pinch    = this._pairDist();
        this._pinchMid = this._pairMid();
        this._pinchAng = this._pairAngle();
        this._moved = true;            // a two-finger gesture is never a tap
        this.velAz = this.velPolar = 0;
      }
    });

    window.addEventListener('pointermove', e => {
      const p = this._ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      this._idle = 0;

      if (this._mode === 'orbit') {
        const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
        if (!this._moved && Math.abs(dx) + Math.abs(dy) > MOVE_EPS) this._moved = true;
        // Orbiting does NOT drop the follow — you look around KAI and it eases
        // back behind him when you let go. Only double-tap (travel) detaches.
        if (this._moved) this._orbit(dx, dy);
        const now = performance.now(), dt = Math.max(1, now - this._last.t) / 1000;
        this._last = { x: e.clientX, y: e.clientY, t: now, dx, dy, dt };
      } else if (this._mode === 'pan') {
        this._orbit(e.clientX - this._last.x, e.clientY - this._last.y);
        this._last.x = e.clientX; this._last.y = e.clientY;
      } else if (this._mode === 'pinch') {
        const d = this._pairDist(), mid = this._pairMid();
        if (this._pinch > 0) this._applyZoom(this._pinch / d, mid.x, mid.y);   // pinch → zoom into the spot
        // two-finger swipe → drag the world: the look-point slides OPPOSITE the
        // swipe, so the planet rotates under your fingers (grab-and-spin).
        this._dragWorld(mid.x - this._pinchMid.x, mid.y - this._pinchMid.y);
        this._pinch = d; this._pinchMid = mid;
      }
    });

    const end = e => {
      if (!this._ptrs.has(e.pointerId)) return;
      // fling: turn the last drag delta into orbit momentum
      if (this._mode === 'orbit' && this._moved && this._last.dt && (performance.now() - this._last.t) < 90) {
        this.velAz    = -this._last.dx * CONFIG.camDragSensitivity / this._last.dt;
        this.velPolar =  this._last.dy * CONFIG.camDragSensitivity * 0.7 / this._last.dt;
      }
      // clean touch tap → double-tap glides there (single tap does nothing)
      if (e.pointerType === 'touch' && this._ptrs.size === 1 && !this._moved &&
          performance.now() - this._downT < 300) {
        const now = performance.now();
        if (now - this._lastTapT < 320) this._travel(e.clientX, e.clientY);
        this._lastTapT = now;
      }
      this._ptrs.delete(e.pointerId);
      this._mode = this._ptrs.size >= 2 ? 'pinch' : (this._ptrs.size === 1 ? 'orbit' : null);
      if (this._ptrs.size >= 1) {
        const [only] = this._ptrs.values();
        this._last = { x: only.x, y: only.y, t: performance.now(), dx: 0, dy: 0, dt: 0 };
        this._moved = true;   // lifting a finger mid-gesture isn't a fresh tap
      }
      if (this._ptrs.size === 2) { this._pinch = this._pairDist(); this._pinchMid = this._pairMid(); this._pinchAng = this._pairAngle(); }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    el.addEventListener('wheel', e => {
      e.preventDefault();
      this._idle = 0;
      this._cine = null;
      this._applyZoom(1 + e.deltaY * CONFIG.camZoomStep, e.clientX, e.clientY);
    }, { passive: false });

    // Desktop: double-click the ground to glide there
    el.addEventListener('dblclick', e => this._travel(e.clientX, e.clientY));
  }

  _pairDist() {
    const [a, b] = [...this._ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  _pairMid() {
    const [a, b] = [...this._ptrs.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  _pairAngle() {
    const [a, b] = [...this._ptrs.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  // Rotate the globe around the look-point. Detaching is handled by the caller
  // (so a pinch can rotate while still following KAI).
  _orbit(dx, dy) {
    const s = CONFIG.camDragSensitivity;
    this.azimuth -= dx * s;
    this.polar    = clamp(this.polar - dy * s * 0.7, CONFIG.camPolarMin, CONFIG.camPolarMax);
    this._offAxis = true;   // the user has taken the camera off the follow axis → show "Follow KAI"
  }

  // Keep a look-point (in the rig's un-spun frame) from straying past the town
  // cap: if it sits more than _maxPivotTheta radians from the north pole, slide
  // it back onto that rim circle at the same azimuth, preserving its radius.
  _clampPivot(v) {
    const len = v.length();
    if (len < 1e-6) return v;
    const theta = Math.acos(clamp(v.y / len, -1, 1));   // arc distance from the pole
    if (theta <= this._maxPivotTheta) return v;
    const horiz = Math.hypot(v.x, v.z) || 1e-6;
    const f = (len * Math.sin(this._maxPivotTheta)) / horiz;
    v.x *= f; v.z *= f;
    v.y = len * Math.cos(this._maxPivotTheta);
    return v;
  }

  // world point on the little planet under a screen position (null if it misses)
  _planetAt(clientX, clientY) {
    if (!this.city?.planet) return null;
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObject(this.city.planet, false);
    if (!hits.length) return null;
    // the raycast hit is in WORLD space (the planet is spun); bring it back into
    // the rig's un-spun frame so all pivot maths stay in one coordinate system.
    const p = hits[0].point.clone();
    if (this.worldQuat) p.applyQuaternion(this._invQ.copy(this.worldQuat).invert());
    return p;
  }

  // Zoom by a multiplicative factor (>1 out, <1 in). When the user is driving
  // (not following), also glide the look-point toward the spot under the cursor
  // / pinch — so you zoom *into where you're looking*, the way maps do.
  _applyZoom(factor, clientX, clientY) {
    const old = this.targetRadius;
    this.targetRadius = clamp(old * factor, CONFIG.camRadiusMin, CONFIG.camRadiusMax);
    if (!this.following && clientX != null) {
      const g = this._planetAt(clientX, clientY);
      if (g) {
        const f = Math.max(0, (1 - this.targetRadius / old) * CONFIG.camZoomToCursor);
        this.pivotTarget.lerp(g, Math.min(f, 0.6)).setLength(this.R + CONFIG.camLookY);
        this._clampPivot(this.pivotTarget);
      }
    }
  }

  // Two-finger swipe = drag the planet: slide the look-point across the surface
  // OPPOSITE the swipe (so the world rotates under your fingers). Leaves the
  // follow (you're exploring) and keeps the pivot exactly on the sphere.
  _dragWorld(dmx, dmy) {
    if (!dmx && !dmy) return;
    this._detach();
    // work in the rig's un-spun frame: bring the (world-space) camera position
    // back through the planet spin so it matches this.pivot's frame.
    this._camL.copy(this.camera.position);
    if (this.worldQuat) this._camL.applyQuaternion(this._invQ.copy(this.worldQuat).invert());
    const fwd   = this._t.copy(this.pivot).sub(this._camL).normalize();
    const right = this._b.crossVectors(fwd, _WORLD_UP).normalize();
    const up    = this._off.crossVectors(right, fwd).normalize();
    const k = this._renderEff * 0.0016 + 0.02;     // farther out → faster traverse
    this.pivotTarget
      .addScaledVector(right, -dmx * k)
      .addScaledVector(up,     dmy * k)
      .setLength(this.R + CONFIG.camLookY);
    this._clampPivot(this.pivotTarget);   // stay over the town, never onto the far side
  }

  // double-tap the globe to glide the look-point there (Google-Earth style)
  _travel(clientX, clientY) {
    const g = this._planetAt(clientX, clientY);
    if (!g) return;
    this.pivotTarget.copy(g).setLength(this.R + CONFIG.camLookY);
    this._clampPivot(this.pivotTarget);
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
    this._cineAdmire = false;
    this._cineN = null;
    this.ui.cameraFollowing = true;
    this.targetRadius = CONFIG.camRadius;
    planetPoint(charPos.x, CONFIG.camLookY, charPos.z, this.pivotTarget, this.R);
    this.velAz = 0;
    this._idle = 999;       // settle straight behind KAI right away
    this._snapBehind = true; // …and lock the azimuth this very frame (no swing)
    this._offAxis = false;   // back on the follow axis → hide the Follow button
  }

  // Right the world: snap pitch/zoom back to the default 3/4 look-down so the
  // rooftops face up again — the escape hatch after you've spun the little planet
  // around and lost which way is up. While you're navigating the map this levels
  // the view IN PLACE (keeps the spot you're exploring); it does NOT fly back to
  // KAI — that's the Follow button's job, so the two controls stay distinct.
  resetView(charPos) {
    this.polar = this._renderPolar = CONFIG.camPolar;
    this.targetRadius = this.radius = this._renderEff = CONFIG.camRadius;
    this.velAz = this.velPolar = 0;
    this._cine = null;
    if (this.following) {
      this.reattach(charPos);            // already on KAI → just re-lock behind him
    } else {
      // The camera's up is the local surface normal at the pivot, so re-levelling
      // the pitch and pulling the look-point back over the town cap is all it
      // takes to set the rooftops upright again, right where you are.
      this._clampPivot(this.pivot);
      this._clampPivot(this.pivotTarget);
    }
  }

  // ── Cinematic: watch over KAI's shoulder while he paints ──────────────────
  // The camera drops in BEHIND him (along the wall's outward normal), slightly
  // to one shoulder and zoomed in, looking at the wall — so the viewer sees
  // exactly what he is drawing, with KAI in the near foreground.
  watchMural(slot) {
    if (!slot || !this.following) return;     // only auto-frame if KAI was followed
    this._cine  = slot;
    this._cineAdmire = false;                  // paint cam keeps the occlusion-lift
    this._cineN = { x: slot.nx, z: slot.nz }; // outward wall normal = "behind KAI"
    this._cineSide = 0.26;                     // a touch over one shoulder
    this.ui.cameraFollowing = true;           // auto-framing → hide the button
    this.following = false;
    this._cinePolar = 1.30;                    // nearly level, looking at the wall
    this.targetRadius = 4.6;                   // zoomed in on the work
    planetPoint(slot.px, slot.py + 0.2, slot.pz, this.pivotTarget, this.R);
  }

  admireMural(slot) {
    if (!slot || !this._cine) return;
    this._cine  = slot;
    this._cineAdmire = true;                    // admire frames itself (probe below); skip occlusion-lift
    this._cineN = { x: slot.nx, z: slot.nz };
    this.following = false;
    this.ui.cameraFollowing = true;

    // Is a neighbour standing in — or just beside — the head-on line of sight (a
    // tight alley)? If so the frontal shot would bury the lens or be tipped
    // overhead by the occlusion-lift, so swing round a shoulder to see past it.
    // Otherwise frame the piece nearly head-on (KAI has stepped aside, so he's
    // clear either way). Same frontage test the wall-picker prefers.
    const frontalBlocked = this.city ? !this.city.frontageOpen(slot) : false;
    this._cineSide    = frontalBlocked ? 0.70 : 0.22;  // swing past a neighbour, else head-on
    this._cinePolar   = frontalBlocked ? 1.28 : 1.46;  // dip a touch when swung, else level/square
    this.targetRadius = frontalBlocked ? 5.6  : 4.4;   // closer when head-on so lateral blocks fall outside frame

    planetPoint(slot.px, slot.py + 0.20, slot.pz, this.pivotTarget, this.R);
  }

  // True while the camera is auto-framing a mural (watch/admire). The app reads
  // this to calm the sun glow so the artwork isn't washed out half the frame.
  get watching() { return !!this._cine; }

  releaseWatch() {
    if (!this._cine) return;
    this._cine = null;
    this._cineAdmire = false;
    this._cineN = null;
    this.following = true;
    this.ui.cameraFollowing = true;
    this.targetRadius = CONFIG.camRadius;
  }

  // ---- per-frame ---------------------------------------------------------
  //  Google-Earth orbit around the little planet: the camera always looks at a
  //  pivot point sitting on the sphere, and swings around it in that point's
  //  LOCAL frame (up = the radial direction there). Following keeps the pivot
  //  glued to KAI's spot on the globe; dragging spins the view around it.
  update(dt, charPos, facing = null) {
    this._idle += dt;

    if (this._cine) {
      this.polar += (this._cinePolar - this.polar) * (1 - Math.exp(-dt * 1.8));
      this.velPolar = 0;
      // Paint-cam: sit BEHIND KAI (along the wall's outward normal) and look at
      // the wall, so the viewer watches over his shoulder while he sprays. The
      // normal is a flat (x,z) vector; near the pole the tangent frame ≈ flat, so
      // we resolve it into the pivot's (T,B) basis and ease the azimuth there.
      if (this._cineN) {
        const up0 = this._up.copy(this.pivot).normalize();
        let T0 = this._t.set(0, 1, 0).cross(up0); if (T0.lengthSq() < 1e-6) T0.set(1, 0, 0); T0.normalize();
        const B0 = this._b.copy(up0).cross(T0).normalize();
        const behindAz = Math.atan2(this._cineN.x * B0.x + this._cineN.z * B0.z,
                                    this._cineN.x * T0.x + this._cineN.z * T0.z) + this._cineSide;
        this.azimuth = lerpAngle(this.azimuth, behindAz, 1 - Math.exp(-dt * 2.4));
        this.velAz = 0;
      } else {
        this.velAz = 0;
      }
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

    // local frame at the pivot: up = radial; a stable tangent basis (T, B)
    const up = this._up.copy(this.pivot).normalize();
    let T = this._t.set(0, 1, 0).cross(up);
    if (T.lengthSq() < 1e-6) T.set(1, 0, 0);
    T.normalize();
    const B = this._b.copy(up).cross(T).normalize();

    // Follow from BEHIND: a short moment after you stop touching, ease the
    // azimuth so the camera settles behind KAI, looking the way he walks. His
    // flat heading (sin f, cos f) is the walk direction; the camera goes
    // opposite, expressed in this point's tangent (T,B) basis. `behindAz` is also
    // reused below to know whether the shot is currently locked behind him.
    let behindAz = null;
    if (facing != null) {
      const dx = -Math.sin(facing), dz = -Math.cos(facing);
      behindAz = Math.atan2(dx * B.x + dz * B.z, dx * T.x + dz * T.z);
      if (this.following && this._ptrs.size === 0 && (this._snapBehind || this._idle > 1.4)) {
        // _snapBehind (set by reattach/resetView) locks instantly so the Follow
        // button hides the moment you press it; otherwise ease smoothly.
        this.azimuth = this._snapBehind ? behindAz
          : lerpAngle(this.azimuth, behindAz, 1 - Math.exp(-dt * CONFIG.camFollowSpin));
        this._snapBehind = false;
        this.velAz = 0;
        // once the swing has settled back behind KAI, we're "following" again →
        // the Follow button can hide (it won't flicker while he merely turns).
        const d = Math.atan2(Math.sin(this.azimuth - behindAz), Math.cos(this.azimuth - behindAz));
        if (Math.abs(d) < 0.06) this._offAxis = false;
      }
    }

    // The camera's tangential (horizontal) direction for this azimuth — its XZ
    // gives the flat direction camera→pivot, used for occlusion below.
    const ddx = T.x * Math.cos(this.azimuth) + B.x * Math.sin(this.azimuth);
    const ddz = T.z * Math.cos(this.azimuth) + B.z * Math.sin(this.azimuth);
    const dl = Math.hypot(ddx, ddz) || 1;

    // Occlusion-aware framing: when following/auto-framing, if a building sits
    // between the camera and KAI, first raise the pitch so the lens looks down
    // over the rooftops; if that alone can't clear it, ALSO pull the camera in
    // (zoom toward KAI) so it slips in front of the obstruction. Both targets are
    // transient — they relax back to the user's pitch/zoom once the shot is clear,
    // so the camera eases out and re-levels on its own (the town hugs the pole, so
    // flat ≈ world for this ray test).
    let polTarget = this.polar;
    let radTarget = this.radius;
    // The admire shot frames itself (admireMural probes the frontage and either
    // stays head-on or swings past a neighbour), so it opts OUT of the lift —
    // otherwise the ray, aimed at a pivot sitting ON the mural's wall, always
    // reads "blocked" and tips the shot overhead. Follow + paint cam keep it.
    if ((this.following || (this._cine && !this._cineAdmire)) && this.city && charPos) {
      const ux = ddx / dl, uz = ddz / dl;
      const blocked = (pol, rad) => {
        const camH  = Math.cos(pol) * rad + 1.2;
        const horiz = Math.sin(pol) * rad;
        const n = Math.max(4, Math.ceil(horiz / 1.3));
        for (let i = 1; i <= n; i++) {
          const f = i / n, d = f * horiz;
          const top = this.city.hitsBuilding(charPos.x + ux * d, charPos.z + uz * d);
          if (top > 0 && 1.2 + (camH - 1.2) * f < top + 0.5) return true;
        }
        return false;
      };
      // 1) a GENTLE pitch lift first — enough to peek over a near wall without
      //    swinging fully overhead (keeps the third-person, behind-KAI framing)
      const softPol = Math.max(CONFIG.camPolarMin, this.polar - 0.36);
      for (let tries = 0; tries < 4 && blocked(polTarget, radTarget); tries++) {
        polTarget = Math.max(softPol, polTarget - 0.12);
        if (polTarget <= softPol) break;
      }
      // 2) then ZOOM IN toward KAI — slip the camera in front of the obstruction
      for (let tries = 0; tries < 12 && blocked(polTarget, radTarget); tries++) {
        radTarget *= 0.9;
        if (radTarget <= CONFIG.camRadiusMin) { radTarget = CONFIG.camRadiusMin; break; }
      }
      // 3) last resort (a really tall block right on top of him) → lift the rest
      //    of the way over the rooftops
      for (let tries = 0; tries < 9 && blocked(polTarget, radTarget); tries++) {
        polTarget -= 0.12;
        if (polTarget <= CONFIG.camPolarMin) { polTarget = CONFIG.camPolarMin; break; }
      }
    }
    this._renderPolar += (polTarget - this._renderPolar) * (1 - Math.exp(-dt * 5));
    // pull IN quickly so KAI isn't lost behind a wall, but ease back OUT gently
    const pullRate = radTarget < this._renderEff ? 7 : 3;
    this._renderEff   += (radTarget - this._renderEff) * (1 - Math.exp(-dt * pullRate));

    const sinP = Math.sin(this._renderPolar), cosP = Math.cos(this._renderPolar);
    const off = this._off.copy(up).multiplyScalar(cosP)
      .addScaledVector(T, sinP * Math.cos(this.azimuth))
      .addScaledVector(B, sinP * Math.sin(this.azimuth));
    // build camera + look-point in the un-spun frame, then rotate both by the
    // planet spin so the shot stays glued to KAI as the world turns under it.
    const lookAt = this._pw.copy(this.pivot);
    this.camera.position.copy(this.pivot).addScaledVector(off, this._renderEff);
    // Camera "up" is the LOCAL surface normal at the pivot (the radial direction
    // there), NOT world-Y. The town reaches far from the pole, so world-Y would
    // diverge from the local vertical and roll the horizon — that's the crooked
    // tilt you see when KAI roams far. Using the radial up keeps KAI upright and
    // the frame perfectly vertical everywhere on the planet (near the pole it IS
    // ≈ world-Y, so nothing changes there). It tracks `pivot`, which is eased, so
    // the verticality settles back smoothly after any orbit/occlusion move.
    this.camera.up.copy(up);
    if (this.worldQuat) {
      // The rig works in the planet's UN-spun frame; rotate the camera, its
      // target AND its up by the planet spin together so the shot stays glued to
      // KAI (and stays level) however the day/night terminator has turned the world.
      lookAt.applyQuaternion(this.worldQuat);
      this.camera.position.applyQuaternion(this.worldQuat);
      this.camera.up.applyQuaternion(this.worldQuat);
    }
    this.camera.lookAt(lookAt);

    // ── UI button visibility: show each control only when it would do something ─
    if (this._cine) {
      this.ui.cameraFollowing = true;     // auto paint-cam → hide both buttons
      this.ui.viewTilted = false;
    } else {
      // FOLLOW: hidden while we're following AND haven't been knocked off-axis.
      // `_offAxis` is set the instant you orbit/pan and cleared once the shot has
      // eased back behind KAI — so it stays hidden during normal walking/turning
      // and reappears whenever you move the camera away.
      this.ui.cameraFollowing = this.following && !this._offAxis;

      // RADDRIZZA: only useful once you've DETACHED — flown the planet around with a
      // two-finger swipe, double-tap travel, or a sidebar mural jump — where the
      // view can end up tilted/backwards. Hidden during normal following/orbiting
      // (orbit can't roll the horizon, so reset wouldn't change anything there).
      this.ui.viewTilted = !this.following;
    }
  }
}
