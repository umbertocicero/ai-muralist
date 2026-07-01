export default {
  name: 'ResetButton',
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['reset'],
  // Shown ONLY when the horizon is rolled (the world looks crooked/upside down):
  // rights the little planet (ground back to the bottom of the frame) and re-locks
  // the camera behind KAI.
  template: `
    <button
      id="reset-btn"
      :class="{ visible }"
      aria-label="Align the camera vertically"
      title="Align the camera vertically"
      @click="$emit('reset')"
    >
      <span class="icon">⟲</span> ALIGN
    </button>
  `,
};
