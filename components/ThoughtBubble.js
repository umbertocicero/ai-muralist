export default {
  name: 'ThoughtBubble',
  props: {
    thought: { type: String,  default: '' },
    visible: { type: Boolean, default: false },
    // Tail direction, computed in main.js from KAI's on-screen position:
    // `tailAngle` in degrees (0 = pointing straight toward KAI's side), `tailUp`
    // puts the tail on the top edge when KAI is above the bubble.
    tailAngle: { type: Number,  default: 0 },
    tailUp:    { type: Boolean, default: false },
  },
  computed: {
    tailStyle() {
      return { transform: `translateX(-50%) rotate(${this.tailAngle}deg)` };
    },
  },
  template: `
    <div id="thought" class="ui" :class="{ show: visible }">
      <div class="bubble panel">
        <div class="tip">AI IS THINKING</div>
        <div class="text">{{ thought }}</div>
        <div class="tail" :class="{ up: tailUp }" :style="tailStyle"></div>
      </div>
    </div>
  `,
};
