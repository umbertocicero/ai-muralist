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

import BootScreen    from '../components/BootScreen.js';
import TitlePanel    from '../components/TitlePanel.js';
import MuralLog      from '../components/MuralLog.js';
import StatusBar     from '../components/StatusBar.js';
import MuralCounter  from '../components/MuralCounter.js';
import ThoughtBubble from '../components/ThoughtBubble.js';
import FollowButton  from '../components/FollowButton.js';
import FlashOverlay  from '../components/FlashOverlay.js';

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
  // Callback slots: Vue → Three.js CameraRig
  onFollowRequest: null,
  onMuralFocus:    null,
});

// ==========================================================================
//  Vue root component — composes all UI panels
// ==========================================================================
const VueRoot = {
  name: 'VueRoot',
  components: { BootScreen, TitlePanel, MuralLog, StatusBar, MuralCounter, ThoughtBubble, FollowButton, FlashOverlay },
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
    this.camera = new THREE.PerspectiveCamera(CONFIG.camFov, innerWidth / innerHeight, 0.1, 500);

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

    // Safety: if the spawn ever lands inside a block (e.g. grid retuned),
    // relocate KAI to a guaranteed-open lane point so he's never stuck/hidden.
    if (this.city.isColliding(this.character.pos.x, this.character.pos.z)) {
      const p = this.city.randomReachablePoint();
      this.character.pos.x = p.x; this.character.pos.z = p.z;
      this.character.group.position.set(p.x, 0, p.z);
      this.rig.pivot.set(p.x, 0, p.z);
      this.rig.pivotTarget.set(p.x, 0, p.z);
    }

    // Wire callbacks: Vue → Three.js
    ui.onFollowRequest = () => this.rig.reattach(this.character.pos);
    ui.onMuralFocus    = (target) => this.rig.focusMural(target);
    if (location.search.includes('debugcam')) { window.__rig = this.rig; window.__char = this.character; window.__app = this; window.__ui = ui; }

    // Clock
    this.clock   = new THREE.Clock();
    this.running = true;

    addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this._onVisibility());

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildLights() {
    // One key light gives the cel material a clean light/shade split (the
    // toon gradient map turns it into hard bands). High ambient keeps shaded
    // areas as light grey — manga shadows are tone, not black.
    const key = new THREE.DirectionalLight('#ffffff', 1.7);
    key.position.set(CONFIG.sun.x, CONFIG.sun.y, CONFIG.sun.z);
    key.target.position.set(0, 0, 0);     // aim at the grid centre
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { near: 1, far: 260, left: -58, right: 58, top: 58, bottom: -58 });
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.scene.add(key.target);
    // Lower ambient so grazed/shaded walls drop into the cel mid-band and pick
    // up screentone — that contrast is what makes it read as inked manga, not
    // a flat white model.
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.5));
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
    this.rig.update(dt, this.character.pos);
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
