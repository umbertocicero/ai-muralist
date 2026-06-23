export default {
  name: 'MuralCounter',
  props: {
    count: { type: Number, default: 0 },
  },
  template: `
    <div id="counter" class="ui panel">
      <div class="num">{{ count }}</div>
      <div class="cap">MURALS CREATED</div>
    </div>
  `,
};
