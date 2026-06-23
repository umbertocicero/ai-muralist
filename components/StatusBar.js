export default {
  name: 'StatusBar',
  props: {
    state: { type: String, default: 'booting…' },
  },
  template: `
    <div id="status" class="ui panel">
      <div class="dot"></div>
      <div class="label">{{ state }}</div>
    </div>
  `,
};
