export default {
  name: 'FlashOverlay',
  props: {
    active: { type: Boolean, default: false },
  },
  template: `<div id="flash" :class="{ on: active }"></div>`,
};
