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
import { Persistence }   from './persistence.js';
import { LiveLink }      from './live.js';
import { RemoteDriver }  from './remote-driver.js';
import { applySettings } from './settings.js';
import { initAuth, getToken } from './auth.js';
import { placeOnPlanet, planetPoint, PLANET_R } from './planet.js';

import BootScreen    from '../components/BootScreen.js';
import TitlePanel    from '../components/TitlePanel.js';
import MuralLog      from '../components/MuralLog.js';
import MuralGallery  from '../components/MuralGallery.js';
import MapOverlay    from '../components/MapOverlay.js';
import SettingsPanel from '../components/SettingsPanel.js';
import StatusBar     from '../components/StatusBar.js';
import MuralCounter  from '../components/MuralCounter.js';
import ThoughtBubble from '../components/ThoughtBubble.js';
import SfxOverlay    from '../components/SfxOverlay.js';
import FollowButton  from '../components/FollowButton.js';
import ResetButton   from '../components/ResetButton.js';
import FlashOverlay  from '../components/FlashOverlay.js';
import LoginButton   from '../components/LoginButton.js';

const DAY = new THREE.Color(CONFIG.sky);
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
  logEntries:      [],   // [{ id, styleName, wallW, wallH, buildingIdx }] — recent HUD
  gallery:         [],   // full archive of every mural (+ thumb) for the side drawer
  thought:         '',
  thoughtVisible:  false,
  tailAngle:       0,      // speech-bubble tail rotation (deg) toward KAI
  tailUp:          false,  // tail on the top edge when KAI is above the bubble
  sfxText:         '',     // current onomatopoeia
  sfxX: 50, sfxY: 34, sfxRot: 0, sfxKey: 0,   // its position/tilt + retrigger key
  flashActive:     false,
  cameraFollowing: true,
  viewTilted:      false,        // horizon rolled → show the "Raddrizza" button

  // Callback slots: Vue / Agent → Three.js CameraRig
  onFollowRequest: null,
  onResetView:     null,   // "right the world" button → snap camera upright behind KAI
  onMuralFocus:    null,
  onPaintBegin:    null,   // Agent: KAI started a wall → frame the mural
  onAdmire:        null,   // Agent: mural done → zoom in to admire it
  onPaintEnd:      null,   // Agent: done admiring → resume follow
  onMapRender:     null,   // MapOverlay → live city-map compositor (js/map.js)
  onDeleteMurals:  null,   // SettingsPanel "DELETE MURALS" → wipe this world (D1)
});

// ==========================================================================
//  Vue root component — composes all UI panels
// ==========================================================================
const VueRoot = {
  name: 'VueRoot',
  components: { BootScreen, TitlePanel, MuralLog, MuralGallery, MapOverlay, SettingsPanel, StatusBar, MuralCounter, ThoughtBubble, SfxOverlay, FollowButton, ResetButton, FlashOverlay, LoginButton },
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
    <MuralLog      :entries="ui.logEntries" @focus="onMuralFocus" />
    <MuralGallery  :entries="ui.gallery"    @focus="onMuralFocus" />
    <MapOverlay    :render="ui.onMapRender" />
    <SettingsPanel :on-delete="ui.onDeleteMurals" />
    <StatusBar     :state="ui.status" />
    <MuralCounter  :count="ui.muralCount" />
    <SfxOverlay    :text="ui.sfxText" :x="ui.sfxX" :y="ui.sfxY" :rot="ui.sfxRot" :k="ui.sfxKey" />
    <ThoughtBubble :thought="ui.thought" :visible="ui.thoughtVisible" :tail-angle="ui.tailAngle" :tail-up="ui.tailUp" />
    <FollowButton  :visible="!ui.cameraFollowing" @follow="onFollow" />
    <ResetButton   :visible="ui.viewTilted" @reset="onReset" />
    <LoginButton />
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

    // Renderer. The scene is drawn into an MSAA offscreen target (MangaPost) and
    // the default framebuffer only ever shows a full-screen quad, so it needs no
    // stencil buffer. Ask the OS for the discrete GPU on hybrid-graphics laptops.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFShadowMap;
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
    // Persistent world (see js/settings.js for how the flags resolve):
    //  · RESTORE always runs when a Worker is known — even in demo mode — so a
    //    refresh always brings the saved murals back onto the seeded town, and
    //    they take PRECEDENCE: the agent holds off claiming walls until every
    //    saved mural has re-taken its slot.
    //  · SAVE is wired only when the saveMurals flag is on (Settings / yaml).
    if (CONFIG.workerUrl) {
      // Keyed by city.worldKey (seed ⊕ layout fingerprint), NOT the bare seed:
      // murals must only restore onto the exact town build they were painted in.
      this.persistence = new Persistence(CONFIG.workerUrl, this.city.worldKey);
      if (CONFIG.saveMurals !== false) {
        this.agent.onPainted = (slot, result, style) => this.persistence.save(slot, result, style);
      }
      this.agent.holdPainting = true;
      this.persistence.restore(this.city, this.factory, this.agent, ui)
        .catch(e => console.warn('[persist] restore failed:', e.message))
        .finally(() => { this.agent.holdPainting = false; });
      // Settings "DELETE MURALS" → wipe this world's shared canvas. OWNER ONLY:
      // pass the signed-in owner's Google token; the Worker verifies + enforces.
      ui.onDeleteMurals = () => this.persistence.deleteAll(getToken());
    }

    // ── Live shared Kay ────────────────────────────────────────────────────
    // When a Worker is configured (and live isn't disabled) Kay is authoritative
    // ON THE SERVER: one shared position for every browser, and the server picks
    // + paints the walls. This browser stops running Kay's brain — it just
    // renders where the server says he is (RemoteDriver). If the socket never
    // connects (no DO binding / offline) we fall back to the local Agent below.
    this.liveEnabled = !!(CONFIG.workerUrl && CONFIG.live !== false);
    this.live = null;
    this.remote = null;
    this._offline = false;
    if (this.liveEnabled) {
      this.remote = new RemoteDriver(this.city, this.character, ui);
      this.live   = new LiveLink(CONFIG.workerUrl, this.city.worldKey, this.city, this.factory, ui);
      this.live.onState = (s, p) => this.remote.onState(s, p, this.live.kay);
      this.live.onRoute = (route) => this.remote.setRoute(route);
      this.live.start();
      // If no live server answers within the grace window, run the local Kay.
      setTimeout(() => { if (!this.live.everConnected) this._offline = true; }, 8000);
    }
    // Live map page: the overlay canvas is composited from js/map.js — static
    // base cached once, KAI dot + fading trail + mural markers on top.
    this._trail = []; this._trailT = 0;
    ui.onMapRender = (canvas) => {
      import('./map.js').then(({ renderLiveMap }) => renderLiveMap(canvas, this.city, this.agent, this._trail));
    };
    if (location.search.includes('debugcam')) {
      window.__rig = this.rig; window.__char = this.character; window.__app = this; window.__ui = ui;
      // window.__map() → draw the generated town as an inked 2D map (js/map.js)
      window.__map = async (opts) => {
        const { drawCityMap } = await import('./map.js');
        return drawCityMap(this.city, { agent: this.agent, trail: this._trail, ...opts });
      };
    }

    // Fix the planet orientation (always day) and initialise sky/lights ONCE.
    // The sun is fixed and it is permanently daytime, so every value _updateSky
    // computes is constant — it never needs to run again after this.
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
    const v = CONFIG.visual ?? {};
    const key = new THREE.DirectionalLight('#fffdf8', v.keyLight ?? 2.0);
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

    // A soft, cool fill light from OPPOSITE the sun. The town is a big cap on the
    // little planet: its far edge/corners curve past the terminator onto the night
    // side and would otherwise render pitch-black. This lifts that far zone into a
    // readable penombra (cooler + dimmer than the sunlit side), so KAI can wander
    // all the way out there and it still reads. (See visual.nightFill.)
    const moon = new THREE.DirectionalLight('#b8c2de', v.nightFill ?? 0.68);
    moon.position.copy(this._sunDir).multiplyScalar(-100).setY(70);
    this.scene.add(moon);
    this.moonLight = moon;

    // Ambient: lifts shaded walls just into the cel mid-band (manga tone). Its
    // level rides the day/night cycle too.
    this.ambient = new THREE.AmbientLight('#ffffff', v.ambientLight ?? 0.52);
    this.scene.add(this.ambient);
  }

  // ── Always daytime: planet is fixed so the town always faces the sun ──
  _updateSky() {
    // Orient the planet once so KAI's town permanently faces the sun.
    // No time-based spinning: the sun is always up.
    this._worldQuat.setFromUnitVectors(this._up, this._sunDir);
    this.city.worldRoot.quaternion.copy(this._worldQuat);

    // Full day — lights, sky and fog are fixed at their daytime values. The
    // anti-sun fill stays ON (it's what keeps the town's far, curved-away edge
    // readable rather than black).
    this.ambient.intensity = CONFIG.visual?.ambientLight ?? 0.52;
    this.moonLight.intensity = CONFIG.visual?.nightFill ?? 0.68;
    col.copy(DAY);
    this.scene.background.copy(col);
    this.scene.fog.color.copy(col);
    this.atmosphere.setSun(CONFIG.sun, 1);
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

  // Fade the thought bubble in/out from the game loop instead of a CSS
  // transition. The transition is main-thread and gets starved by the WebGL
  // render loop under heavy load (it can stick at opacity 0); an inline opacity
  // eased here always advances, since the loop is what's running. Inline style
  // wins over the stylesheet, so this is the authoritative value.
  _fadeThought(dt) {
    this._thoughtEl ??= document.getElementById('thought');
    if (!this._thoughtEl) return;
    const target = ui.thoughtVisible ? 1 : 0;
    this._thoughtOp = (this._thoughtOp ?? 0) + (target - (this._thoughtOp ?? 0)) * (1 - Math.exp(-dt * 6));
    this._thoughtEl.style.opacity = this._thoughtOp.toFixed(3);
  }

  // Point the thought-bubble tail at KAI: project his world position to the
  // screen, take the vector from the bubble to him, and drive the tail's side
  // (top/bottom edge) + rotation. Clamped so the tail never lies flat.
  _aimThoughtTail() {
    const v = (this._v ??= new THREE.Vector3());
    this.character.group.getWorldPosition(v).project(this.camera);
    if (v.z >= 1) { ui.tailAngle = 0; return; }             // behind the camera → leave as-is
    const kx = (v.x * 0.5 + 0.5) * innerWidth;
    const ky = (-v.y * 0.5 + 0.5) * innerHeight;
    const bx = innerWidth / 2, by = innerHeight - 134;      // ≈ bubble centre (bottom:90 + ~half height)
    const dx = kx - bx, dy = ky - by;
    const up = dy < 0;                                       // KAI above the bubble
    const ang = Math.atan2(dx, up ? -dy : dy);              // 0 = straight toward KAI's edge
    const deg = Math.max(-1, Math.min(1, ang)) * 180 / Math.PI;   // clamp ±57°
    // Only write when it actually moves: KAI is stationary while thinking/
    // painting, so this settles to ~zero updates — a per-frame reactive write
    // would re-render ThoughtBubble 60×/s and starve its CSS opacity transition
    // (the bubble would never fade in).
    if (up !== ui.tailUp || Math.abs(deg - ui.tailAngle) > 1.5) {
      ui.tailUp = up; ui.tailAngle = deg;
    }
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t  = this.clock.elapsedTime;
    // Who moves Kay this frame:
    //  · live server connected → render the authoritative position (no wrapping,
    //    so the "Pac-Man" teleport is gone entirely on this path);
    //  · live enabled but still handshaking → hold him still (don't let the local
    //    brain claim/paint walls the server owns);
    //  · offline / demo → the local Agent drives himself (legacy toroidal walk,
    //    with the follow-cam wrap-snap kept only here).
    if (this.live && this.live.everConnected) {
      this.remote.update(dt, t, this.live.kay);
    } else if (this.liveEnabled && !this._offline) {
      this.character.idle(t); this.character.sync();
    } else {
      const _px = this.character.pos.x, _pz = this.character.pos.z;
      this.agent.update(dt, t);
      if (Math.abs(this.character.pos.x - _px) > this.city.HALF ||
          Math.abs(this.character.pos.z - _pz) > this.city.HALF) {
        this.rig.wrapSnap(this.character.pos);
      }
    }
    // breadcrumb trail for the live map (~7 points/s, capped at ~90s of walk)
    this._trailT += dt;
    if (this._trailT > 0.15) {
      this._trailT = 0;
      this._trail.push(this.character.pos.x, this.character.pos.z);
      if (this._trail.length > 1200) this._trail.splice(0, 2);
    }
    this.city.update(dt, t);     // spin AC fans, sway tree crowns + hanging laundry
    // map KAI's flat (pos, eased yaw) onto the little planet for rendering
    this._yawQ.setFromAxisAngle(this._up, this.character.yaw);
    placeOnPlanet(this.character.group, this.character.pos.x, 0, this.character.pos.z, this._yawQ);
    this.rig.update(dt, this.character.pos, this.character.yaw);
    // Calm the sun white-out while the camera is admiring a mural, so the
    // artwork reads instead of half the frame blowing out to light.
    this.atmosphere.setDim(this.rig.watching ? 0.25 : 1);
    this.atmosphere.update(dt, t, this.camera);
    if (ui.thoughtVisible) this._aimThoughtTail();
    this._fadeThought(dt);
    this.post.render(this.scene, this.camera);
    if (!ui.booted) {
      ui.booted  = true;
      ui.status  = 'wandering the streets';
    }
  }
}

// ==========================================================================
//  Bootstrap — resolve settings (defaults < config.yaml < the visitor's own
//  Settings panel), mount Vue, then start Three.js
// ==========================================================================
createApp(VueRoot).mount('#ui-root');

applySettings(CONFIG)
  .catch(() => {})           // settings are best-effort; defaults always work
  .then(() => {
    initAuth().catch(() => {});   // Google sign-in (no-op unless googleClientId is set)
    try {
      new App();
    } catch (e) {
      console.error('[muralist] fatal:', e);
      ui.bootError = e.message ?? 'failed to start';
    }
  });
