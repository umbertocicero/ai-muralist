export default {
  name: 'FollowButton',
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['follow'],
  template: `
    <button
      id="follow-btn"
      :class="{ visible }"
      aria-label="Follow character"
      @click="$emit('follow')"
    >
      <span class="icon">⊙</span> FOLLOW MURO
    </button>
  `,
};
