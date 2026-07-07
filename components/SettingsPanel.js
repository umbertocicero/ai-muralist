import { loadUserSettings, saveUserSettings } from '../js/settings.js';
import { CONFIG } from '../js/config.js';
import { auth, signOut } from '../js/auth.js';

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
  // onDelete: wipes the shared world's murals (wired to Persistence in main.js);
  // null when no Worker is configured, so the button hides.
  props: { onDelete: { type: Function, default: null } },
  data() {
    const s = loadUserSettings();
    return {
      open: false,
      mode:      s.mode ?? '',          // '' = auto
      apiKey:    s.apiKey ?? '',
      model:     s.model ?? '',
      workerUrl: s.workerUrl ?? '',
      saveMurals: s.saveMurals !== false,
      deleting:  false,
      models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8'],
    };
  },
  computed: {
    // Worker resolved from ANY layer (panel field > yaml/site > code default).
    // By the time the panel is opened, boot-time resolution has long finished,
    // so CONFIG.workerUrl reflects the effective value.
    effectiveWorker() { return this.workerUrl.trim() || CONFIG.workerUrl || ''; },
    auth() { return auth; },                 // reactive Google-auth store (js/auth.js)
    // Admin controls (MODE, DELETE) are visible when auth is OFF (open app) or
    // when the signed-in user is the owner. The Worker enforces regardless.
    canAdmin()  { return !auth.enabled || auth.isOwner; },
  },
  methods: {
    doSignOut() { signOut(); },
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
    async deleteMurals() {
      if (!this.onDelete || this.deleting) return;
      if (!confirm('Delete every mural in this shared world? This clears the canvas for everyone and cannot be undone.')) return;
      this.deleting = true;
      try {
        const n = await this.onDelete();
        alert(`Deleted ${n ?? 0} mural(s). Reloading a blank world.`);
        location.reload();
      } catch (e) {
        this.deleting = false;
        alert('Delete failed: ' + (e?.message ?? e));
      }
    },
  },
  template: `
    <button id="settings-btn" aria-label="Settings" title="Settings" @click="open = !open">⚙</button>
    <div id="settings-panel" class="panel" v-if="open">
      <div class="s-hdr">SETTINGS</div>

      <div class="s-auth" v-if="auth.enabled">
        <template v-if="auth.user">
          <span class="s-note">signed in as {{ auth.user.email }}<template v-if="auth.isOwner"> · owner</template></span>
          <button class="s-btn ghost" @click="doSignOut">SIGN OUT</button>
        </template>
        <span v-else class="s-note">sign in with the Google button (top-left) to manage this world</span>
      </div>

      <template v-if="canAdmin">
        <label class="s-lab">MODE</label>
        <div class="s-row">
          <label><input type="radio" value="" v-model="mode"> auto</label>
          <label><input type="radio" value="demo" v-model="mode"> demo</label>
          <label><input type="radio" value="ai" v-model="mode"> AI</label>
        </div>
      </template>

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

      <div class="s-danger" v-if="onDelete && effectiveWorker && canAdmin">
        <button class="s-btn danger" :disabled="deleting" @click="deleteMurals">
          {{ deleting ? 'DELETING…' : 'DELETE MURALS' }}
        </button>
        <span class="s-note">wipes this shared world for everyone</span>
      </div>
    </div>
  `,
};
