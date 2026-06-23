export default {
  name: 'ThoughtBubble',
  props: {
    thought: { type: String,  default: '' },
    visible: { type: Boolean, default: false },
  },
  template: `
    <div id="thought" class="ui" :class="{ show: visible }">
      <div class="panel">
        <div class="tip">AI IS THINKING</div>
        <div class="text">{{ thought }}</div>
      </div>
    </div>
  `,
};
