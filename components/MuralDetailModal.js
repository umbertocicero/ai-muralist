// Mural detail view — opened from the ⛶ button on any gallery entry. Shows the
// piece large, plus everything needed to RECREATE it: the exact prompt Claude
// was given and which model painted it (the TODO). The prompt is carried inline
// for murals painted this session (live broadcast / local paint); for murals
// restored from the shared world it's lazy-fetched by id (GET /murals?id=), so
// the boot payload stays small. Demo pieces are procedural — they show "no
// prompt (procedural demo)".
export default {
  name: 'MuralDetailModal',
  props: {
    entry:     { type: Object, default: null },
    workerUrl: { type: String, default: '' },
  },
  emits: ['close', 'focus'],
  data() {
    return { prompt: null, model: null, promptState: 'none', copied: false };
  },
  computed: {
    visible()   { return !!this.entry; },
    modelName() { return this.entry?.model ?? this.model ?? null; },
    dims()      { const e = this.entry; return e ? `${e.wallW.toFixed(1)} × ${e.wallH.toFixed(1)} m` : ''; },
    num()       { const e = this.entry; return e ? String((typeof e.id === 'number' ? e.id : 0) + 1).padStart(3, '0') : ''; },
  },
  watch: {
    entry: {
      immediate: true,
      handler(e) {
        this.copied = false; this.prompt = null; this.model = null; this.promptState = 'none';
        if (!e) return;
        if ('prompt' in e) {                       // painted this session → prompt is inline
          this.prompt = e.prompt;
          this.promptState = e.prompt ? 'ready' : 'none';
        } else if (typeof e.id === 'number' && this.workerUrl) {
          this._fetchPrompt(e.id);                 // restored → fetch its provenance
        }
      },
    },
  },
  methods: {
    close() { this.$emit('close'); },
    flyTo() { if (this.entry?.target) this.$emit('focus', this.entry); this.close(); },
    _fetchPrompt(id) {
      this.promptState = 'loading';
      const base = this.workerUrl.replace(/\/$/, '');
      fetch(`${base}/murals?id=${id}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((d) => {
          const m = d.mural || {};
          this.prompt = m.prompt ?? null;
          this.model  = m.model ?? null;
          this.promptState = this.prompt ? 'ready' : 'none';
        })
        .catch(() => { this.promptState = 'error'; });
    },
    async copyPrompt() {
      if (!this.prompt) return;
      try { await navigator.clipboard.writeText(this.prompt); this.copied = true; setTimeout(() => { this.copied = false; }, 1600); }
      catch { /* clipboard blocked — the textarea is selectable as a fallback */ }
    },
  },
  template: `
    <div id="detail-overlay" v-if="visible" @click.self="close" role="dialog" aria-label="Mural detail">
      <div class="d-card">
        <button class="d-close" aria-label="Close" @click="close">✕</button>
        <div class="d-body">
          <div class="d-art">
            <img v-if="entry.thumb" :src="entry.thumb" :alt="entry.styleName" draggable="false" />
          </div>
          <div class="d-side">
            <div class="d-title"><span class="n">#{{ num }}</span> {{ entry.styleName }}</div>
            <div class="d-meta">
              <div><span class="k">size</span><span class="v">{{ dims }}</span></div>
              <div v-if="entry.buildingIdx != null"><span class="k">building</span><span class="v">{{ entry.buildingIdx + 1 }}</span></div>
              <div><span class="k">model</span><span class="v">{{ modelName || '—' }}</span></div>
              <div v-if="entry.by"><span class="k">by</span><span class="v">{{ entry.by }}</span></div>
            </div>
            <div v-if="entry.thought" class="d-thought">“{{ entry.thought }}”</div>
            <div class="d-prompt-hdr">
              <span>PROMPT</span>
              <button v-if="promptState === 'ready'" class="d-copy" @click="copyPrompt">{{ copied ? 'COPIED ✓' : 'COPY' }}</button>
            </div>
            <textarea v-if="promptState === 'ready'" class="d-prompt" readonly :value="prompt"></textarea>
            <div v-else-if="promptState === 'loading'" class="d-prompt-note">loading…</div>
            <div v-else-if="promptState === 'error'"   class="d-prompt-note">couldn't load the prompt</div>
            <div v-else class="d-prompt-note">no prompt (procedural demo)</div>
            <div class="d-actions">
              <button v-if="entry.target" class="d-btn" @click="flyTo">FLY TO IT</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
