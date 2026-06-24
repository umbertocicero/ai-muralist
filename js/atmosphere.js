import * as THREE from 'three';
import { CONFIG } from './config.js';

// ===========================================================================
//  Manga atmosphere — the things that turn a clean cel-shaded model into a
//  *drawn panel*: the sun blown out at the end of the alley, hard light-shafts
//  raining down from it, and dust motes hanging in the beam.
//
//  Everything here is additive, depth-tested but not depth-writing, and pinned
//  to the sun. It costs almost nothing (a sprite, ~8 quads, a few hundred
//  points) and works from any orbit angle — exactly what the reference photos
//  have: a backlit haze with radiating light streaks, like inked sunbeams.
// ===========================================================================

// Soft round sprite — used for the sun glow and for each dust mote.
function discTexture(inner = 0.0) {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * inner, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

// A single light-shaft: bright at the base (the sun) fading to nothing,
// soft across its width. Drawn long and thin.
function beamTexture() {
  const w = 64, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // length fade (top = at sun = bright)
  const lg = ctx.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, 'rgba(255,255,255,0.9)');
  lg.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, w, h);
  // width fade (soft edges) via destination-in alpha mask
  const wg = ctx.createLinearGradient(0, 0, w, 0);
  wg.addColorStop(0, 'rgba(0,0,0,0)');
  wg.addColorStop(0.5, 'rgba(0,0,0,1)');
  wg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = wg;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class Atmosphere {
  constructor(scene, sun) {
    this.scene = scene;
    this.sun   = new THREE.Vector3(sun.x, sun.y, sun.z);
    this._day  = 1;            // 0 = night, 1 = day (drives all visibility)
    this._buildGlow();
    this._buildShafts();
    this._buildMoon();
    this._buildDust();
  }

  // Move the sun (and its glow/shafts) to a new world position, and set the
  // day factor so everything fades out at night. A moon takes over in the dark.
  setSun(pos, day) {
    this._day = day;
    this.glow.position.set(pos.x, pos.y, pos.z);
    this.core.position.copy(this.glow.position);
    this.shafts.position.copy(this.glow.position);
    if (this.moon) this.moon.material.opacity = (1 - day) * 0.85;
    if (this.lamps) this.lamps.material.opacity = (1 - day) * 0.9;   // street lamps glow after dark
  }

  // Street-lamp glows — one additive Points cloud for every lamp lens, faded in
  // by the day/night cycle. Cheap (a single draw call).
  setLamps(heads) {
    if (!heads || !heads.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3));
    const mat = new THREE.PointsMaterial({
      map: discTexture(0.15), color: 0xffdca8, size: 3.0, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    });
    this.lamps = new THREE.Points(geo, mat);
    this.lamps.renderOrder = 995;
    this.scene.add(this.lamps);
  }

  _buildMoon() {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: discTexture(0.45), color: 0xd2d8e8,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      transparent: true, opacity: 0,
    }));
    m.scale.setScalar(CONFIG.atmo.glowSize * 0.42);
    m.position.set(-46, 74, -52);
    m.renderOrder = 998;
    this.scene.add(m);
    this.moon = m;
  }

  // Blown-out highlight where the light pours in — the white-out at the
  // vanishing point of every reference alley.
  _buildGlow() {
    const mat = new THREE.SpriteMaterial({
      map: discTexture(0.0),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,         // always the brightest thing on screen
      transparent: true,
      opacity: 0.9,
    });
    this.glow = new THREE.Sprite(mat);
    this.glow.scale.setScalar(CONFIG.atmo.glowSize);
    this.glow.position.copy(this.sun);
    this.glow.renderOrder = 998;
    this.scene.add(this.glow);

    // A smaller, sharper core for a crisp hot centre.
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: discTexture(0.0), color: 0xffffff,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      transparent: true, opacity: 1,
    }));
    core.scale.setScalar(CONFIG.atmo.glowSize * 0.42);
    core.position.copy(this.sun);
    core.renderOrder = 999;
    this.scene.add(core);
    this.core = core;
  }

  // A fan of light-shafts radiating from the sun. The fan is a flat group of
  // quads; each frame we turn the group to face the camera so the streaks
  // always splay across the screen from the glow — inked sunbeams.
  _buildShafts() {
    this.shafts = new THREE.Group();
    this.shafts.position.copy(this.sun);
    this.shafts.renderOrder = 997;
    const tex = beamTexture();
    const N = CONFIG.atmo.shaftCount;
    this._beams = [];
    for (let i = 0; i < N; i++) {
      const len = CONFIG.atmo.shaftLen * (0.6 + Math.random() * 0.8);
      const wid = CONFIG.atmo.shaftWidth * (0.5 + Math.random() * 1.1);
      const geo = new THREE.PlaneGeometry(wid, len);
      geo.translate(0, -len / 2, 0); // pivot at the sun end
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffffff,
        blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false,
        transparent: true, opacity: CONFIG.atmo.shaftOpacity * (0.7 + Math.random() * 0.7),
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(geo, mat);
      // splay downward-ish: angles biased toward the ground
      beam.rotation.z = (i / N) * Math.PI * 1.5 - Math.PI * 0.75 + (Math.random() - 0.5) * 0.2;
      beam.renderOrder = 997;
      beam._baseOp = mat.opacity;
      beam._phase  = Math.random() * Math.PI * 2;
      this._beams.push(beam);
      this.shafts.add(beam);
    }
    this.scene.add(this.shafts);
  }

  // Dust motes drifting in the light — slow upward float, recycled in a box.
  _buildDust() {
    const n = CONFIG.atmo.dustCount;
    const pos = new Float32Array(n * 3);
    this._vel = new Float32Array(n);
    const R = CONFIG.atmo.dustRange;
    for (let i = 0; i < n; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * R;
      pos[i * 3 + 1] = Math.random() * 14 + 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * R;
      this._vel[i]   = 0.15 + Math.random() * 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: discTexture(0.0), color: 0xffffff,
      size: CONFIG.atmo.dustSize, sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.55,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.renderOrder = 996;
    this.scene.add(this.dust);
  }

  update(dt, t, camera) {
    // Face the shaft fan toward the camera (rays splay across screen).
    if (camera) this.shafts.lookAt(camera.position);

    const day = this._day;
    // Gentle breathing on each beam's opacity (faded out at night).
    for (const b of this._beams) {
      b.material.opacity = b._baseOp * (0.7 + 0.3 * Math.sin(t * 0.7 + b._phase)) * day;
    }
    // Subtle pulse on the glow so the white-out feels alive (day only).
    const pulse = 1 + Math.sin(t * 0.5) * 0.04;
    this.glow.scale.setScalar(CONFIG.atmo.glowSize * pulse);
    this.core.scale.setScalar(CONFIG.atmo.glowSize * 0.42 * pulse);
    this.glow.material.opacity = 0.9 * day;
    this.core.material.opacity = 1.0 * day;
    this.dust.material.opacity = 0.12 + 0.45 * day;

    // Drift the dust upward; recycle past the ceiling back to the floor.
    const p = this.dust.geometry.attributes.position;
    const R = CONFIG.atmo.dustRange;
    for (let i = 0; i < this._vel.length; i++) {
      let y = p.array[i * 3 + 1] + this._vel[i] * dt;
      p.array[i * 3]     += Math.sin(t * 0.3 + i) * dt * 0.12; // lazy drift
      if (y > 15) {
        y = 0.3;
        p.array[i * 3]     = (Math.random() - 0.5) * R;
        p.array[i * 3 + 2] = (Math.random() - 0.5) * R;
      }
      p.array[i * 3 + 1] = y;
    }
    p.needsUpdate = true;
  }
}
