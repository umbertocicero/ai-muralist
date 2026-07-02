// Live city-map page: a MAP button opens a full-screen overlay where the town
// map redraws ~8×/s — KAI's dot + fading trail move in real time and every
// painted mural appears as an orange marker the moment it's finished. The
// actual drawing lives in js/map.js; the Three app passes a render callback
// through the shared ui state (ui.onMapRender), same bridge as the camera
// controls.
export default {
  name: 'MapOverlay',
  props: {
    render: { type: Function, default: null },   // (canvas) => void
  },
  data() {
    return { open: false };
  },
  beforeUnmount() { this._stop(); },
  methods: {
    toggle() {
      this.open = !this.open;
      if (this.open) this.$nextTick(() => this._tick());
      else this._stop();
    },
    _stop() { if (this._t) { clearTimeout(this._t); this._t = null; } },
    _tick() {
      if (!this.open) return;
      const cv = this.$refs.cv;
      if (cv && this.render) this.render(cv);
      this._t = setTimeout(() => this._tick(), 120);   // ~8 fps — plenty for a map
    },
  },
  template: `
    <button id="map-btn" class="ui" :class="{ open }" @click="toggle"
            :aria-label="open ? 'Close city map' : 'Open city map'">
      <span class="ico">✦</span> MAP
    </button>
    <div id="map-overlay" v-if="open" @click.self="toggle">
      <div class="m-wrap">
        <button class="m-close" @click="toggle" aria-label="Close map">✕</button>
        <canvas ref="cv" width="1100" height="1100"></canvas>
      </div>
    </div>
  `,
};
