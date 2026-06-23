export default {
  name: 'BootScreen',
  props: {
    hidden: { type: Boolean, default: false },
    error:  { type: String,  default: null  },
  },
  template: `
    <div id="boot" :class="{ hide: hidden, error: !!error }">
      <div class="b-name">AI MURALIST</div>
      <div class="b-sub">{{ error ?? 'loading the city…' }}</div>
    </div>
  `,
};
