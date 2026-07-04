// Manga action lines — radial ink spokes converging on the frame, shown only
// while KAI is striding (agent sets ui.speedLines). Pure CSS (a masked
// repeating-conic-gradient), so it costs nothing per frame.
export default {
  name: 'SpeedLines',
  props: { active: { type: Boolean, default: false } },
  template: `<div id="speed-lines" :class="{ on: active }"></div>`,
};
