import * as THREE from 'three';
import { createApp, reactive } from 'vue';

import { CONFIG } from './config.js';
import { MangaPost }     from './postfx.js';
import { City }          from './city.js';
import { Character }     from './character.js';
import { MuralFactory }  from './mural-factory.js';
import { Agent }         from './agent.js';
import { CameraRig }     from './camera-rig.js';
import { Atmosphere }    from './atmosphere.js';
import { sunPosition, clockIn } from './solar.js';

import BootScreen    from '../components/BootScreen.js';
import TitlePanel    from '../components/TitlePanel.js';
import MuralLog      from '../components/MuralLog.js';
import StatusBar     from '../components/StatusBar.js';
import MuralCounter  from '../components/MuralCounter.js';
import ThoughtBubble from '../components/ThoughtBubble.js';
import FollowButton  from '../components/FollowButton.js';
import FlashOverlay  from '../components/FlashOverlay.js';
import TimeBar       from '../components/TimeBar.js';

// Day/night sky tones (kept greyscale so the world stays B&W manga).
const NIGHT = new THREE.Color('#16161c');
const DAY   = new THREE.Color('#e7e5e0');
const col   = new THREE.Color();
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ==========================================================================
//  Shared reactive state — the bridge between Three.js and Vue.
//  The Three.js App writes to this object; Vue components observe it.
// ==========================================================================
const ui = reactive({
  booted:          false,
  bootError:       null,
  status:          'booting…',
  muralCount:      0,
  logEntries:      [],   // [{ id, styleName, wallW, wallH, buildingIdx }]
  thought:         '',
  thoughtVisible:  false,
  flashActive:     false,
  cameraFollowing: true,
  clock:           '--:--:--',  // JST wall-clock (Setagaya, Tokyo)
  phase:           'day',       // day · night · dawn · dusk
  // Callback slots: Vue / Agent → Three.js CameraRig
  onFollowRequest: null,
  onMuralFocus:    null,
  onPaintBegin:    null,   // Agent: KAI started a wall → frame the mural
  onAdmire:        null,   // Agent: mural done → zoom in to admire it
  onPaintEnd:      null,   // Agent: done admiring → resume follow
});

// ==========================================================================
//  Vue root component — composes all UI panels
// ==========================================================================
const VueRoot = {
  name: 'VueRoot',
  components: { BootScreen, TitlePanel, MuralLog, StatusBar, MuralCounter, ThoughtBubble, FollowButton, FlashOverlay, TimeBar },
  setup() {
    return { ui };
  },
  methods: {
    onFollow() {
      ui.onFollowRequest?.();
    },
    onMuralFocus(entry) {
      ui.onMuralFocus?.(entry.target);
    },
  },
  template: `
    <FlashOverlay  :active="ui.flashActive" />
    <BootScreen    :hidden="ui.booted" :error="ui.bootError" />
    <TitlePanel />
    <TimeBar       :clock="ui.clock" :phase="ui.phase" />
    <MuralLog      :entries="ui.logEntries" @focus="onMuralFocus" />
    <StatusBar     :state="ui.status" />
    <MuralCounter  :count="ui.muralCount" />
    <ThoughtBubble :thought="ui.thought" :visible="ui.thoughtVisible" />
    <FollowButton  :visible="!ui.cameraFollowing" @follow="onFollow" />
  `,
};

// ==========================================================================
//  Three.js App — owns the renderer, scene, and all 3D systems
// ==========================================================================
class App {
  constructor() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.sky);
    this.scene.fog = new THREE.Fog(CONFIG.fog.color, CONFIG.fog.near, CONFIG.fog.far);

    // Camera
    this.camera = new THREE.PerspectiveCamera(CONFIG.camFov, innerWidth / innerHeight, 0.3, 340);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding    = THREE.sRGBEncoding;
    // Flat output (no filmic tone mapping) keeps whites pure white and the
    // cel bands crisp — essential for the inked manga look.
    this.renderer.toneMapping       = THREE.NoToneMapping;
    document.getElementById('canvas-root').appendChild(this.renderer.domElement);

    this._buildLights();
    this.post = new MangaPost(this.renderer);

    // Systems
    this.city       = new City(this.scene);
    this.character  = new Character(this.scene, CONFIG.charStart);
    this.factory    = new MuralFactory(this.scene, this.renderer);
    this.agent      = new Agent(this.city, this.character, this.factory, ui);
    this.rig        = new CameraRig(this.camera, this.renderer.domElement, ui, this.city);
    this.atmosphere = new Atmosphere(this.scene, CONFIG.sun);
    this.atmosphere.setLamps(this.city.lampHeads);   // night street-lamp glows

    // Spawn KAI on a guaranteed-open street point chosen by the city generator
    // (the procedural town has no fixed open cell), and centre the camera there.
    const sp = this.city.spawn;
    this.character.pos.x = sp.x; this.character.pos.z = sp.z;
    this.character.group.position.set(sp.x, 0, sp.z);
    this.rig.pivot.set(sp.x, 0, sp.z);
    this.rig.pivotTarget.set(sp.x, 0, sp.z);

    // Wire callbacks: Vue → Three.js
    ui.onFollowRequest = () => this.rig.reattach(this.character.pos, this.character.group.rotation.y);
    ui.onMuralFocus    = (target) => this.rig.focusMural(target);
    ui.onPaintBegin    = (slot) => this.rig.watchMural(slot);
    ui.onAdmire        = (slot) => this.rig.admireMural(slot);
    ui.onPaintEnd      = () => this.rig.releaseWatch();
    if (location.search.includes('debugcam')) { window.__rig = this.rig; window.__char = this.character; window.__app = this; window.__ui = ui; }

    // Day/night: set the sky to the real Tokyo time right away, then track it.
    this._lastSky = -1e9;
    this._updateSky();

    // Clock
    this.clock   = new THREE.Clock();
    this.running = true;

    addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this._onVisibility());

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildLights() {
    // The key light IS the sun — its position/intensity are driven each frame
    // by the real solar position for Tokyo (_updateSky). The cel gradient turns
    // its clean light/shade split into hard manga bands.
    const key = new THREE.DirectionalLight('#fffdf8', 1.7);
    key.position.set(CONFIG.sun.x, CONFIG.sun.y, CONFIG.sun.z);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { near: 1, far: 300, left: -72, right: 72, top: 72, bottom: -72 });
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.scene.add(key.target);
    this.key = key;

    // A dim, cool moon light that only matters at night (no shadow).
    const moon = new THREE.DirectionalLight('#aab6d6', 0.0);
    moon.position.set(-46, 74, -52);
    this.scene.add(moon);
    this.moonLight = moon;

    // Ambient: lifts shaded walls just into the cel mid-band (manga tone). Its
    // level rides the day/night cycle too.
    this.ambient = new THREE.AmbientLight('#ffffff', 0.5);
    this.scene.add(this.ambient);
  }

  // ── Day/night: track the real sun over Setagaya, Tokyo ────────────────────
  _updateSky() {
    const now = (typeof window !== 'undefined' && window.__forceDate) ? new Date(window.__forceDate) : new Date();
    const L = CONFIG.location;
    const sp = sunPosition(now, L.lat, L.lon);
    const elDeg = sp.elevation * 180 / Math.PI;

    // day factor: 0 below −6° (night), 1 above +6° (full day), smooth twilight
    const day = smoothstep(-6, 6, elDeg);

    // Sun world position drives the directional light + the atmosphere glow.
    const R = 130;
    const sx = sp.dir.x * R, sy = sp.dir.y * R, sz = sp.dir.z * R;
    this.key.position.set(sx, Math.max(sy, 3), sz);   // keep above ground so shadows resolve
    this.key.intensity = 0.12 + 1.5 * day;
    this.ambient.intensity = 0.16 + 0.42 * day;
    this.moonLight.intensity = (1 - day) * 0.45;

    // Sky + fog ride the cycle: night → day (greyscale, stays monochrome).
    col.copy(NIGHT).lerp(DAY, day);
    this.scene.background.copy(col);
    this.scene.fog.color.copy(col);

    // Atmosphere: glow/shafts follow the sun and fade out at night (moon fades in).
    this.atmosphere.setSun({ x: sx, y: sy, z: sz }, day);

    // Clock + phase for the UI (morning sun is in the east → az > 0 = dawn).
    ui.clock = clockIn(L.tz, now).text;
    ui.phase = day > 0.85 ? 'day' : day < 0.15 ? 'night' : (sp.azimuth > 0 ? 'dawn' : 'dusk');
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.setSize();
  }

  // Pause while tab is hidden — saves GPU and prevents huge dt spikes.
  _onVisibility() {
    this.running = !document.hidden;
    if (this.running) { this.clock.getDelta(); requestAnimationFrame(this._loop); }
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t  = this.clock.elapsedTime;
    this.agent.update(dt, t);
    this.rig.update(dt, this.character.pos, this.character.group.rotation.y);
    // track the real sun ~3×/s on wall-clock time (frame-rate independent, so the
    // clock keeps ticking even when the scene runs slowly)
    const nowMs = performance.now();
    if (nowMs - this._lastSky >= 330) { this._lastSky = nowMs; this._updateSky(); }
    this.atmosphere.update(dt, t, this.camera);
    this.post.render(this.scene, this.camera);
    if (!ui.booted) {
      ui.booted  = true;
      ui.status  = 'wandering the streets';
    }
  }
}

// ==========================================================================
//  Bootstrap — mount Vue first, then start Three.js
// ==========================================================================
createApp(VueRoot).mount('#ui-root');

try {
  new App();
} catch (e) {
  console.error('[muralist] fatal:', e);
  ui.bootError = e.message ?? 'failed to start';
}
