import * as THREE from 'three';
import { createApp, reactive } from 'vue';

import { CONFIG } from './config.js';
import { City }          from './city.js';
import { Character }     from './character.js';
import { MuralFactory }  from './mural-factory.js';
import { Agent }         from './agent.js';
import { CameraRig }     from './camera-rig.js';

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
  // Callback slot: Vue follow-button → Three.js CameraRig
  onFollowRequest: null,
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
  },
  template: `
    <FlashOverlay  :active="ui.flashActive" />
    <BootScreen    :hidden="ui.booted" :error="ui.bootError" />
    <TitlePanel />
    <MuralLog      :entries="ui.logEntries" />
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
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.getElementById('canvas-root').appendChild(this.renderer.domElement);

    this._buildLights();

    // Systems
    this.city      = new City(this.scene);
    this.character = new Character(this.scene, { x: 0, z: 14 });
    this.factory   = new MuralFactory(this.scene, this.renderer);
    this.agent     = new Agent(this.city, this.character, this.factory, ui);
    this.rig       = new CameraRig(this.camera, this.renderer.domElement, ui);

    // Wire follow-button callback: Vue → Three.js
    ui.onFollowRequest = () => this.rig.reattach(this.character.pos);

    // Clock
    this.clock   = new THREE.Clock();
    this.running = true;

    addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this._onVisibility());

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildLights() {
    const sun = new THREE.DirectionalLight('#fff5e0', 2.4);
    sun.position.set(50, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 1, far: 200, left: -70, right: 70, top: 70, bottom: -70 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight('#c9dff0', 0.35));
    this.scene.add(new THREE.HemisphereLight('#87CEEB', '#6b8e6b', 0.5));
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
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
    this.renderer.render(this.scene, this.camera);
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
