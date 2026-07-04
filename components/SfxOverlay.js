// Manga onomatopoeia (シャー, ザッ…) that pop over the wall while KAI paints.
// The `:key="k"` re-mounts the element whenever the agent bumps ui.sfxKey, so
// the CSS pop-in animation replays for every stroke — even a repeated word.
export default {
  name: 'SfxOverlay',
  props: {
    text: { type: String, default: '' },
    x:    { type: Number, default: 50 },
    y:    { type: Number, default: 34 },
    rot:  { type: Number, default: 0 },
    k:    { type: Number, default: 0 },
  },
  computed: {
    style() {
      return { left: this.x + 'vw', top: this.y + 'vh', '--r': this.rot + 'deg' };
    },
  },
  template: `
    <div id="sfx-layer">
      <div v-if="text" class="sfx" :key="k" :style="style">{{ text }}</div>
    </div>
  `,
};
