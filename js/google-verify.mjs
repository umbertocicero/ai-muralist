// Google ID-token (JWT) verification — PURE, no DOM / no framework. Uses only
// Web Crypto (globalThis.crypto.subtle), available in Cloudflare Workers and in
// Node 18+. Imported by worker.js (server enforcement) AND by
// tests/google-verify.test.mjs, so the test proves the exact code the Worker runs.
//
// This is the trust boundary: the browser sends a Google ID token, the Worker
// verifies the SIGNATURE against Google's public keys and checks the standard
// claims. Only then is the email trusted and matched against the owner allowlist.

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToString = (s) => new TextDecoder().decode(b64urlToBytes(s));

// ---- Owner allowlist ------------------------------------------------------
export function parseOwners(str) {
  return (str ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function isOwner(email, ownersStr) {
  if (!email) return false;
  return parseOwners(ownersStr).includes(String(email).trim().toLowerCase());
}

// ---- Token verification ---------------------------------------------------
// verifyGoogleIdToken(token, { clientId, getJwks }) → decoded payload, or throws.
// getJwks() must resolve Google's JWKS ({ keys: [...] }); it is injected so the
// test can supply a local key and prod can cache the fetch (see makeGoogleJwksFetcher).
export async function verifyGoogleIdToken(token, { clientId, getJwks, now = Date.now(), skewSec = 60 } = {}) {
  if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error('malformed token');
  if (!clientId) throw new Error('no client id configured');
  const [h, p, sig] = token.split('.');

  let header, payload;
  try { header = JSON.parse(b64urlToString(h)); payload = JSON.parse(b64urlToString(p)); }
  catch { throw new Error('undecodable token'); }
  if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);

  const jwks = await getJwks();
  const jwk = (jwks?.keys ?? []).find((k) => k.kty === 'RSA' && k.kid === header.kid);
  if (!jwk) throw new Error('signing key not found');

  const key = await crypto.subtle.importKey(
    'jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');

  // Standard claim checks (only AFTER the signature is proven).
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new Error(`bad iss ${payload.iss}`);
  if (payload.aud !== clientId) throw new Error('aud mismatch');
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + skewSec < nowSec) throw new Error('token expired');
  if (typeof payload.nbf === 'number' && payload.nbf - skewSec > nowSec) throw new Error('token not yet valid');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('email not verified');
  if (!payload.email) throw new Error('no email in token');
  return payload;
}

// Default JWKS fetcher with a small in-memory cache (module scope, honours
// Cache-Control max-age). `fetchImpl` is injectable for tests.
export function makeGoogleJwksFetcher(fetchImpl) {
  let cache = null, exp = 0;
  return async function getJwks() {
    if (cache && Date.now() < exp) return cache;
    const f = fetchImpl || fetch;
    const res = await f(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`jwks fetch ${res.status}`);
    cache = await res.json();
    const cc = res.headers?.get?.('cache-control') || '';
    const m = /max-age=(\d+)/.exec(cc);
    exp = Date.now() + (m ? parseInt(m[1], 10) : 3600) * 1000;
    return cache;
  };
}
