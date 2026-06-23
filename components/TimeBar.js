// Live JST wall-clock for the town (Setagaya, Tokyo) + day/night phase.
export default {
  name: 'TimeBar',
  props: {
    clock: { type: String, default: '--:--:--' },
    phase: { type: String, default: 'day' },
  },
  computed: {
    icon() { return { day: '☀', night: '☾', dawn: '↑☀', dusk: '↓☀' }[this.phase] || '☀'; },
    label() { return (this.phase || '').toUpperCase(); },
  },
  template: `
    <div id="clock" class="ui panel">
      <span class="ico">{{ icon }}</span>
      <span class="t">{{ clock }}</span>
      <span class="z">JST · {{ label }}</span>
    </div>
  `,
};
