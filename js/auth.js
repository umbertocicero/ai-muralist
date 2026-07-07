import { reactive } from 'vue';
import { CONFIG } from './config.js';

// ===========================================================================
//  Google Sign-In (Google Identity Services) — client side.
//
//  Gives the browser a Google ID token (JWT). It is sent with privileged
//  requests (delete murals, change the shared mode); the WORKER verifies it and
//  checks the owner allowlist (js/google-verify.mjs). Everything here is UI/UX
//  only — `isOwner` below is a hint for showing controls; it grants nothing.
//  Auth is simply OFF when CONFIG.googleClientId is unset (all admin UI hidden).
// ===========================================================================

export const auth = reactive({
  enabled: false,   // a Google client id is configured
  ready:   false,   // GIS script loaded + initialised
  user:    null,    // { email, name, picture } once signed in
  token:   null,    // current ID token (JWT) or null
  isOwner: false,   // user.email === CONFIG.ownerEmail (UI hint only)
});

const listeners = new Set();
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(auth); } catch {} } }

export function getToken() { return auth.token; }

// Decode a JWT payload WITHOUT verifying (client display only; the server is the
// authority). Handles base64url + UTF-8.
function decodeJwt(tok) {
  try {
    const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(b).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    return JSON.parse(json);
  } catch { return null; }
}

let _expiryTimer = null;
function setToken(idToken) {
  if (_expiryTimer) { clearTimeout(_expiryTimer); _expiryTimer = null; }
  const p = idToken ? decodeJwt(idToken) : null;
  auth.token = idToken || null;
  auth.user  = p ? { email: p.email, name: p.name, picture: p.picture } : null;
  auth.isOwner = !!(p && CONFIG.ownerEmail && p.email &&
    p.email.toLowerCase() === String(CONFIG.ownerEmail).toLowerCase());
  // Clear the token when Google says it expires (server would reject it anyway).
  if (p?.exp) {
    const ms = p.exp * 1000 - Date.now();
    if (ms > 0) _expiryTimer = setTimeout(() => setToken(null), Math.min(ms, 2 ** 31 - 1));
  }
  notify();
}

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google sign-in script failed to load'));
    document.head.appendChild(s);
  });
}

// Call once at boot. No-op (auth disabled) when no client id is configured.
export async function initAuth() {
  auth.enabled = !!CONFIG.googleClientId;
  if (!auth.enabled) return;
  try {
    await loadGis();
    window.google.accounts.id.initialize({
      client_id: CONFIG.googleClientId,
      callback: (resp) => setToken(resp?.credential || null),
      auto_select: true,
      cancel_on_tap_outside: true,
    });
    auth.ready = true;
    try { window.google.accounts.id.prompt(); } catch {}   // silent One Tap if possible
    notify();
  } catch (e) {
    console.warn('[auth]', e.message);
  }
}

// Render the official Google button into `el` (its look/flow are Google-owned).
export function renderSignInButton(el) {
  if (!auth.ready || !el) return;
  try {
    window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'medium', type: 'standard', shape: 'rectangular' });
    window.google.accounts.id.prompt();
  } catch (e) { console.warn('[auth] render button:', e.message); }
}

export function signOut() {
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch {}
  setToken(null);
}
