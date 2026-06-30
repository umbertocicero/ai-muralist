// A slide-out side drawer holding EVERY mural KAI has painted (the live "RECENT
// MURALS" panel only keeps the latest few). It opens from a handle on the right
// edge, scrolls through the full archive with thumbnails, and flies the camera
// to a piece on click — on phones too, where it closes itself after a pick so
// the zoom is visible.
export default {
  name: 'MuralGallery',
  props: {
    entries: { type: Array, default: () => [] },
  },
  emits: ['focus'],
  data() {
    return { open: false };
  },
  methods: {
    toggle() { this.open = !this.open; },
    pick(e) {
      if (!e.target) return;
      this.$emit('focus', e);
      // On a phone the drawer covers the view, so step aside to reveal the zoom.
      if (window.innerWidth <= 640) this.open = false;
    },
  },
  template: `
    <button id="gallery-tab" class="ui" :class="{ open }" @click="toggle"
            :aria-label="open ? 'Close mural gallery' : 'Open mural gallery'">
      <span class="ico">{{ open ? '✕' : '☰' }}</span>
      <span class="lbl">GALLERY</span>
      <span class="cnt" v-if="entries.length">{{ entries.length }}</span>
    </button>

    <div id="gallery" class="ui panel" :class="{ open }" role="dialog" aria-label="Mural gallery">
      <div class="g-hdr">
        <span>MURAL GALLERY</span>
        <span class="g-count">{{ entries.length }}</span>
      </div>
      <div class="g-scroll">
        <template v-if="entries.length">
          <div v-for="e in entries" :key="e.id" class="g-item" :class="{ clickable: e.target }"
               @click="pick(e)">
            <div class="g-thumb">
              <img v-if="e.thumb" :src="e.thumb" :alt="e.styleName" loading="lazy" draggable="false" />
            </div>
            <div class="g-info">
              <div class="g-title"><span class="n">#{{ String(e.id + 1).padStart(3, '0') }}</span> {{ e.styleName }}</div>
              <div class="g-meta">{{ e.wallW.toFixed(1) }}×{{ e.wallH.toFixed(1) }}m · building {{ e.buildingIdx + 1 }}</div>
            </div>
          </div>
        </template>
        <div v-else class="g-empty">no murals yet… KAI is still wandering</div>
      </div>
    </div>
  `,
};
