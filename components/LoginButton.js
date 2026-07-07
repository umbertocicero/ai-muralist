import { auth, renderSignInButton, signOut } from '../js/auth.js';

// ===========================================================================
//  LoginButton — the visible sign-in control on the HUD (top-left column).
//  Signed out: the official Google button. Signed in: a small chip with the
//  account + a sign-out. Hidden entirely when auth isn't configured
//  (CONFIG.googleClientId unset). Real enforcement is server-side; this is UI.
// ===========================================================================
export default {
  name: 'LoginButton',
  computed: {
    auth()     { return auth; },
    ready()    { return auth.ready; },
    signedIn() { return !!auth.user; },
  },
  watch: {
    // (Re)render the Google button once GIS is ready or after a sign-out.
    ready()    { this.$nextTick(() => this._render()); },
    signedIn() { this.$nextTick(() => this._render()); },
  },
  mounted() { this.$nextTick(() => this._render()); },
  methods: {
    _render() {
      if (auth.enabled && !auth.user && this.$refs.gsi) renderSignInButton(this.$refs.gsi);
    },
    doSignOut() { signOut(); },
  },
  template: `
    <div id="login-ctl" v-if="auth.enabled">
      <template v-if="auth.user">
        <img v-if="auth.user.picture" :src="auth.user.picture" class="lc-pic" alt="" referrerpolicy="no-referrer">
        <div class="lc-who">
          <div class="lc-name">{{ auth.user.email }}</div>
          <div class="lc-role" v-if="auth.isOwner">owner</div>
        </div>
        <button class="lc-out" @click="doSignOut">SIGN OUT</button>
      </template>
      <div v-else ref="gsi" class="lc-gsi"></div>
    </div>
  `,
};
