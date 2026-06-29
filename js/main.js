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
import { clockIn } from './solar.js';
import { placeOnPlanet, planetPoint, PLANET_R } from './planet.js';

import BootScreen    from '../components/BootScreen.js';
import TitlePanel    from '../components/TitlePanel.js';
import MuralLog      from '../components/MuralLog.js';
import StatusBar     from '../components/StatusBar.js';
import MuralCounter  from '../components/MuralCounter.js';
import ThoughtBubble from '../components/ThoughtBubble.js';
import FollowButton  from '../components/FollowButton.js';
import ResetButton   from '../components/ResetButton.js';
import FlashOverlay  from '../components/FlashOverlay.js';
import TimeBar       from '../components/TimeBar.js';

const DAY = new THREE.Color('#e7e5e0');
const col = new THREE.Color();

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
  viewTilted:      false,        // horizon rolled → show the "Raddrizza" button

  clock:           '--:--:--',  // JST wall-clock (Setagaya, Tokyo)
  phase:           'day',       // day · night · dawn · dusk
  // Callback slots: Vue / Agent → Three.js CameraRig
  onFollowRequest: null,
  onResetView:     null,   // "right the world" button → snap camera upright behind KAI
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
  components: { BootScreen, TitlePanel, MuralLog, StatusBar, MuralCounter, ThoughtBubble, FollowButton, ResetButton, FlashOverlay, TimeBar },
  setup() {
    return { ui };
  },
  methods: {
    onFollow() {
      ui.onFollowRequest?.();
    },
    onReset() {
      ui.onResetView?.();
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
    <ResetButton   :visible="ui.viewTilted" @reset="onReset" />
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

    // The sun is FIXED. _worldQuat orients the planet so KAI's town always faces it.
    this._sunDir    = new THREE.Vector3(CONFIG.sun.x, CONFIG.sun.y, CONFIG.sun.z).normalize();
    this._worldQuat = new THREE.Quaternion();

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
    this.factory    = new MuralFactory(this.scene, this.renderer, this.city);
    this.agent      = new Agent(this.city, this.character, this.factory, ui);
    this.rig        = new CameraRig(this.camera, this.renderer.domElement, ui, this.city);
    this.atmosphere = new Atmosphere(this.scene, CONFIG.sun);
    // Lamp glows + KAI live UNDER the planet root so they spin with the town.
    this.atmosphere.setLamps(this.city.lampHeads, this.city.worldRoot);   // night street-lamp glows
    this.city.worldRoot.add(this.character.group);
    this.rig.worldQuat = this._worldQuat;            // rig keeps its shot glued to KAI as the planet turns

    // Spawn KAI on a guaranteed-open street point chosen by the city generator,
    // place him on the planet, and centre the orbit camera there.
    const sp = this.city.spawn;
    this._up = new THREE.Vector3(0, 1, 0);
    this._yawQ = new THREE.Quaternion();
    this.character.pos.x = sp.x; this.character.pos.z = sp.z;
    placeOnPlanet(this.character.group, sp.x, 0, sp.z, this._yawQ.identity());
    planetPoint(sp.x, CONFIG.camLookY, sp.z, this.rig.pivot, PLANET_R);
    this.rig.pivotTarget.copy(this.rig.pivot);

    // Wire callbacks: Vue → Three.js
    ui.onFollowRequest = () => this.rig.reattach(this.character.pos, this.character.yaw);
    ui.onResetView     = () => this.rig.resetView(this.character.pos);
    ui.onMuralFocus    = (target) => this.rig.focusMural(target);
    ui.onPaintBegin    = (slot) => this.rig.watchMural(slot);
    ui.onAdmire        = (slot) => this.rig.admireMural(slot);
    ui.onPaintEnd      = () => this.rig.releaseWatch();
    if (location.search.includes('debugcam')) { window.__rig = this.rig; window.__char = this.character; window.__app = this; window.__ui = ui; }

    // Fix the planet orientation (always day) and initialise sky/lights once.
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
    // The key light IS the sun, and it is FIXED — it never moves. Day and night
    // come from spinning the planet under it (_updateSky), so the lit hemisphere
    // is "day" and the far one is "night". The cel gradient turns its clean
    // light/shade split into hard manga bands.
    const key = new THREE.DirectionalLight('#fffdf8', 1.85);
    key.position.copy(this._sunDir).multiplyScalar(130);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    // cover the whole little planet (radius + buildings) from the sun's distance
    const ext = PLANET_R + 14;
    Object.assign(key.shadow.camera, { near: 1, far: 320, left: -ext, right: ext, top: ext, bottom: -ext });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;     // curb shadow acne/peter-panning on the curved ground
    this.scene.add(key);
    this.scene.add(key.target);
    this.key = key;

    // A dim, cool moon light from OPPOSITE the sun that fills the night side.
    const moon = new THREE.DirectionalLight('#aab6d6', 0.0);
    moon.position.copy(this._sunDir).multiplyScalar(-100).setY(70);
    this.scene.add(moon);
    this.moonLight = moon;

    // Ambient: lifts shaded walls just into the cel mid-band (manga tone). Its
    // level rides the day/night cycle too.
    this.ambient = new THREE.AmbientLight('#ffffff', 0.5);
    this.scene.add(this.ambient);
  }

  // ── Always daytime: planet is fixed so the town always faces the sun ──
  _updateSky() {
    // Orient the planet once so KAI's town permanently faces the sun.
    // No time-based spinning: the sun is always up.
    this._worldQuat.setFromUnitVectors(this._up, this._sunDir);
    this.city.worldRoot.quaternion.copy(this._worldQuat);

    // Full day — lights, sky and fog are fixed at their daytime values.
    this.ambient.intensity = 0.70;
    this.moonLight.intensity = 0;
    col.copy(DAY);
    this.scene.background.copy(col);
    this.scene.fog.color.copy(col);
    this.atmosphere.setSun(CONFIG.sun, 1);

    // Clock still shows real Tokyo time (informational only).
    const now = new Date();
    ui.clock = clockIn(CONFIG.location.tz, now).text;
    ui.phase = 'day';
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
    this.city.update(dt, t);     // spin AC fans, sway tree crowns + hanging laundry
    // map KAI's flat (pos, eased yaw) onto the little planet for rendering
    this._yawQ.setFromAxisAngle(this._up, this.character.yaw);
    placeOnPlanet(this.character.group, this.character.pos.x, 0, this.character.pos.z, this._yawQ);
    this.rig.update(dt, this.character.pos, this.character.yaw);
    // Tick the Tokyo clock in the UI ~3×/s (frame-rate independent).
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
