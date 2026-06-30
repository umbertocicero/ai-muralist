import * as THREE from 'three';
import { CONFIG } from './config.js';
import { PLANET_R } from './planet.js';

// ===========================================================================
//  Manga atmosphere — the things that turn a clean cel-shaded model into a
//  *drawn panel*: the sun blown out at the end of the alley as a clean inked
//  white-out, with hard light-shafts (speed lines) radiating down from it.
//
//  Everything here is additive, depth-tested but not depth-writing, and pinned
//  to the sun. It costs almost nothing (a couple of sprites + ~12 quads) and
//  works from any orbit angle — a backlit white-out with radiating ink streaks.
// ===========================================================================

// Soft round sprite — used for lamp glows / pools / the moon.
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

// A crisp inked WHITE-OUT disc for the sun: a solid white core out to `core`
// (so it reads as a flat blown highlight, not a fuzzy photographic bloom), then
// a short, decisive falloff to nothing — the clean white sun of a manga panel.
function whiteOutTexture(core = 0.62) {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, 'rgba(255,255,255,1)');     // solid white-out core
  g.addColorStop(core + (1 - core) * 0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

// A downward light-cone gradient: bright at the lamp (top), fading to nothing at
// the ground (bottom) and soft across its width.
function coneTexture() {
  const w = 8, h = 128;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);   // top of image = apex = the lamp
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
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
    this._dim       = 1;       // eased glow/shaft multiplier (1 = full sun)
    this._dimTarget = 1;       // calmed toward ~0 while admiring a mural
    this._buildGlow();
    this._buildShafts();
    this._buildMoon();
  }

  // Move the sun (and its glow/shafts) to a new world position, and set the
  // day factor so everything fades out at night. A moon takes over in the dark.
  setSun(pos, day) {
    this._day = day;
    this.glow.position.set(pos.x, pos.y, pos.z);
    this.core.position.copy(this.glow.position);
    this.shafts.position.copy(this.glow.position);
    if (this.moon) this.moon.material.opacity = (1 - day) * 0.85;
    const night = 1 - day;
    if (this.lamps)     this.lamps.material.opacity     = night * 1.0;   // lamp lens bloom
    if (this.lampPools) this.lampPools.material.opacity = night * 0.55;  // warm light on the lane
    if (this.lampCones) this.lampCones.material.opacity = night * 0.17;  // downward light cones
  }

  // Street-lamp glows — added UNDER `parent` (the spun planet root) so they ride
  // with the town as it turns. For every lamp: a lens bloom point, a warm ground
  // pool, AND a downward cone of light. All fade in with the night and cost only
  // one draw call each.
  setLamps(heads, parent = this.scene) {
    if (!heads || !heads.length) return;
    const n = heads.length / 3;

    // (1) bright lens bloom at each cobra head
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3));
    const mat = new THREE.PointsMaterial({
      map: discTexture(0.12), color: 0xffe2b0, size: 3.4, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    });
    this.lamps = new THREE.Points(geo, mat);
    this.lamps.renderOrder = 995;
    parent.add(this.lamps);

    // (2) a soft warm pool on the ground under each lamp (flat additive quads,
    // merged into one mesh). Lit lanes are what sell a night manga panel. The
    // pool sits tangent on the planet, just under each lamp's foot.
    const R = 2.8, up = new THREE.Vector3(), c = new THREE.Vector3(),
          t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const pos = new Float32Array(n * 4 * 3);
    const uv  = new Float32Array(n * 4 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const hx = heads[i * 3], hy = heads[i * 3 + 1], hz = heads[i * 3 + 2], v = i * 4;
      up.set(hx, hy, hz).normalize();                 // local "up" at this lamp
      t1.copy(Y).cross(up); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); t1.normalize();
      t2.copy(up).cross(t1).normalize();
      c.copy(up).multiplyScalar(PLANET_R + 0.06);     // the lamp's foot on the planet surface
      const ax = t1.x * R, ay = t1.y * R, az = t1.z * R;
      const bx = t2.x * R, by = t2.y * R, bz = t2.z * R;
      pos.set([
        c.x - ax - bx, c.y - ay - by, c.z - az - bz,
        c.x + ax - bx, c.y + ay - by, c.z + az - bz,
        c.x + ax + bx, c.y + ay + by, c.z + az + bz,
        c.x - ax + bx, c.y - ay + by, c.z - az + bz,
      ], v * 3);
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], v * 2);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('uv',       new THREE.BufferAttribute(uv, 2));
    pg.setIndex(idx);
    const pmat = new THREE.MeshBasicMaterial({
      map: discTexture(0.0), color: 0xffcf8c,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    });
    this.lampPools = new THREE.Mesh(pg, pmat);
    this.lampPools.renderOrder = 994;
    parent.add(this.lampPools);

    // (3) a downward CONE of light under each lamp — the thing that reads as
    // "the streetlamp is ON". One InstancedMesh of open additive cones, each
    // oriented along the local up at its lamp and dropped so its apex is the lens.
    const h = 3.4, cr = 1.7;
    const cgeo = new THREE.ConeGeometry(cr, h, 16, 1, true);
    const cmat = new THREE.MeshBasicMaterial({
      map: coneTexture(), color: 0xffcf8c, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    const cones = new THREE.InstancedMesh(cgeo, cmat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
          p = new THREE.Vector3(), cc = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      p.set(heads[i * 3], heads[i * 3 + 1], heads[i * 3 + 2]);
      up.copy(p).normalize();
      q.setFromUnitVectors(Y, up);                    // local +Y (apex side) → up
      cc.copy(p).addScaledVector(up, -h / 2);         // apex lands exactly on the lamp
      cones.setMatrixAt(i, m.compose(cc, q, s));
    }
    cones.instanceMatrix.needsUpdate = true;
    cones.renderOrder = 993;
    this.lampCones = cones;
    parent.add(cones);
  }

  _buildMoon() {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: discTexture(0.45), color: 0xd2d8e8,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      transparent: true, opacity: 0,
    }));
    m.scale.setScalar(CONFIG.atmo.glowSize * 0.42);
    // hang the moon OPPOSITE the fixed sun (raised), so it rides the sky on the
    // night side of the planet — and is hidden behind the planet by day.
    const opp = this.sun.clone().normalize().multiplyScalar(-92);
    m.position.set(opp.x, opp.y + 40, opp.z);
    m.renderOrder = 998;
    this.scene.add(m);
    this.moon = m;
  }

  // Blown-out highlight where the light pours in — the white-out at the
  // vanishing point of every reference alley.
  _buildGlow() {
    // A CONTAINED manga sun: a small disc with a hot centre and a soft falloff.
    // Kept deliberately small + gentle so its additive light reads as "the sun is
    // there" without washing the whole panel (and the taupe ground) to white.
    const mat = new THREE.SpriteMaterial({
      map: whiteOutTexture(0.28),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,          // the OPAQUE planet hides it when it's behind us
      transparent: true,
      opacity: 0.38,
    });
    this.glow = new THREE.Sprite(mat);
    this.glow.scale.setScalar(CONFIG.atmo.glowSize);
    this.glow.position.copy(this.sun);
    this.glow.renderOrder = 998;
    this.scene.add(this.glow);

    // A small hot core for a crisp white-out centre (the sun's disc itself).
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: whiteOutTexture(0.55), color: 0xffffff,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      transparent: true, opacity: 0.65,
    }));
    core.scale.setScalar(CONFIG.atmo.glowSize * 0.4);
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
      const len = CONFIG.atmo.shaftLen * (0.75 + Math.random() * 0.4);
      const wid = CONFIG.atmo.shaftWidth * (0.7 + Math.random() * 0.5);
      const geo = new THREE.PlaneGeometry(wid, len);
      geo.translate(0, -len / 2, 0); // pivot at the sun end
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffffff,
        blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: true,   // the planet occludes shafts behind it
        transparent: true, opacity: CONFIG.atmo.shaftOpacity * (0.85 + Math.random() * 0.3),
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

  // Calm the sun glow + shafts toward `target` (0..1). Used to stop the white-out
  // washing half the frame while the camera admires a mural; eased in update().
  setDim(target) { this._dimTarget = target; }

  update(dt, t, camera) {
    // Face the shaft fan toward the camera (rays splay across screen).
    if (camera) this.shafts.lookAt(camera.position);

    // ease the glow multiplier toward its target (calmed during admire shots)
    this._dim += (this._dimTarget - this._dim) * (1 - Math.exp(-dt * 3));
    const day = this._day * this._dim;
    // Gentle breathing on each beam's opacity (faded out at night).
    for (const b of this._beams) {
      b.material.opacity = b._baseOp * (0.7 + 0.3 * Math.sin(t * 0.7 + b._phase)) * day;
    }
    // Subtle pulse on the glow so the white-out feels alive (day only).
    const pulse = 1 + Math.sin(t * 0.5) * 0.04;
    this.glow.scale.setScalar(CONFIG.atmo.glowSize * pulse);
    this.core.scale.setScalar(CONFIG.atmo.glowSize * 0.4 * pulse);
    this.glow.material.opacity = 0.38 * day;
    this.core.material.opacity = 0.65 * day;
  }
}
