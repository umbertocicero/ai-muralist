import { loadUserSettings, saveUserSettings } from '../js/settings.js';
import { CONFIG } from '../js/config.js';

// ===========================================================================
//  Settings panel — a ⚙ button opening a small paper card where the VISITOR
//  configures their own session (stored in localStorage only, never sent
//  anywhere except the api key going straight to the Worker/Anthropic):
//
//    · Mode        — Demo (procedural murals, free) or AI (Claude generates)
//    · API key     — their own Anthropic key (cached, editable, optional if
//                    the site's Worker already has one)
//    · Model       — which Claude model paints
//    · Save to DB  — persist murals to the shared world (when the site has D1)
//
//  Saving reloads the page: settings resolve at boot (js/settings.js).
// ===========================================================================
export default {
  name: 'SettingsPanel',
  data() {
    const s = loadUserSettings();
    return {
      open: false,
      mode:      s.mode ?? '',          // '' = auto
      apiKey:    s.apiKey ?? '',
      model:     s.model ?? '',
      workerUrl: s.workerUrl ?? '',
      saveMurals: s.saveMurals !== false,
      models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'],
    };
  },
  computed: {
    // Worker resolved from ANY layer (panel field > yaml/site > code default).
    // By the time the panel is opened, boot-time resolution has long finished,
    // so CONFIG.workerUrl reflects the effective value.
    effectiveWorker() { return this.workerUrl.trim() || CONFIG.workerUrl || ''; },
  },
  methods: {
    apply() {
      const s = {};
      if (this.mode)            s.mode = this.mode;
      if (this.apiKey.trim())   s.apiKey = this.apiKey.trim();
      if (this.model)           s.model = this.model;
      if (this.workerUrl.trim()) s.workerUrl = this.workerUrl.trim();
      s.saveMurals = this.saveMurals;
      saveUserSettings(s);
      location.reload();
    },
    reset() {
      saveUserSettings({});
      location.reload();
    },
  },
  template: `
    <button id="settings-btn" aria-label="Settings" title="Settings" @click="open = !open">⚙</button>
    <div id="settings-panel" class="panel" v-if="open">
      <div class="s-hdr">SETTINGS</div>

      <label class="s-lab">MODE</label>
      <div class="s-row">
        <label><input type="radio" value="" v-model="mode"> auto</label>
        <label><input type="radio" value="demo" v-model="mode"> demo</label>
        <label><input type="radio" value="ai" v-model="mode"> AI</label>
      </div>

      <template v-if="mode !== 'demo'">
        <label class="s-lab">ANTHROPIC API KEY <span class="s-note">(kept in your browser)</span></label>
        <input class="s-in" type="password" v-model="apiKey" placeholder="sk-ant-…" autocomplete="off">

        <label class="s-lab">MODEL</label>
        <select class="s-in" v-model="model">
          <option value="">(default)</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
      </template>

      <!-- The Worker also hosts persistence (D1), so it matters in EVERY mode:
           demo murals are saved/restored through it too — keep it visible. -->
      <label class="s-lab">WORKER URL <span class="s-note">(generation + save/restore)</span></label>
      <input class="s-in" type="text" v-model="workerUrl" placeholder="https://…workers.dev">

      <label class="s-row s-save">
        <input type="checkbox" v-model="saveMurals"> save murals to the shared world (DB)
      </label>
      <div class="s-warn" v-if="saveMurals && !effectiveWorker">
        ⚠ saving needs a Worker URL (the database lives behind it)
      </div>

      <div class="s-row s-actions">
        <button class="s-btn" @click="apply">SAVE &amp; RELOAD</button>
        <button class="s-btn ghost" @click="reset">RESET</button>
      </div>
    </div>
  `,
};
