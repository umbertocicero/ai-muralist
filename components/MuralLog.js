export default {
  name: 'MuralLog',
  props: {
    entries: { type: Array, default: () => [] },
  },
  template: `
    <div id="log" class="ui panel">
      <div class="hdr">RECENT MURALS</div>
      <template v-if="entries.length">
        <div v-for="e in entries" :key="e.id" class="entry">
          <span class="n">#{{ String(e.id + 1).padStart(3, '0') }}</span>
          {{ e.styleName }}
          <div class="meta">
            {{ e.wallW.toFixed(1) }}×{{ e.wallH.toFixed(1) }}m · building {{ e.buildingIdx + 1 }}
          </div>
        </div>
      </template>
      <div v-else class="empty">no murals yet…</div>
    </div>
  `,
};
