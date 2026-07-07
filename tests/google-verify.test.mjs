// Deterministic proof of the owner-auth trust boundary (js/google-verify.mjs) —
// no network, no Google. Generates a throwaway RSA key, signs JWTs with it, and
// serves it as the JWKS, so we can prove every accept/reject path.
// Run:  node tests/google-verify.test.mjs

import assert from 'node:assert';
import { verifyGoogleIdToken, isOwner, parseOwners } from '../js/google-verify.mjs';

const enc = new TextEncoder();
const b64url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJSON = (obj) => b64url(enc.encode(JSON.stringify(obj)));

const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const KID = 'test-kid-1';

// One throwaway RSA keypair; export the public half as the JWKS Google would serve.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const pubJwk = await crypto.subtle.exportKey('jwk', publicKey);
pubJwk.kid = KID; pubJwk.alg = 'RS256'; pubJwk.use = 'sig';
const getJwks = async () => ({ keys: [pubJwk] });

async function makeToken({ aud = CLIENT_ID, email = 'umbertocicero@gmail.com', email_verified = true,
                            iss = 'https://accounts.google.com', exp, kid = KID } = {}) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = { iss, aud, email, email_verified, sub: '42', name: 'Owner',
    exp: exp ?? Math.floor(Date.now() / 1000) + 3600 };
  const signingInput = `${b64urlJSON(header)}.${b64urlJSON(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(signingInput)));
  return `${signingInput}.${b64url(sig)}`;
}

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
};
const rejects = async (p) => {
  try { await p; return false; } catch { return true; }
};

const OWNERS = 'umbertocicero@gmail.com, second@example.com';

await check('valid owner token verifies and matches the allowlist', async () => {
  const tok = await makeToken();
  const payload = await verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks });
  assert.equal(payload.email, 'umbertocicero@gmail.com');
  assert.ok(isOwner(payload.email, OWNERS), 'owner should be allowed');
});

await check('a verified NON-owner email is rejected by the allowlist', async () => {
  const tok = await makeToken({ email: 'stranger@gmail.com' });
  const payload = await verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks });
  assert.ok(!isOwner(payload.email, OWNERS), 'non-owner must NOT be allowed');
});

await check('wrong aud (token for another app) is rejected', async () => {
  const tok = await makeToken({ aud: 'someone-elses-client-id' });
  assert.ok(await rejects(verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks })));
});

await check('expired token is rejected', async () => {
  const tok = await makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 });
  assert.ok(await rejects(verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks })));
});

await check('unverified email is rejected', async () => {
  const tok = await makeToken({ email_verified: false });
  assert.ok(await rejects(verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks })));
});

await check('bad issuer is rejected', async () => {
  const tok = await makeToken({ iss: 'https://evil.example.com' });
  assert.ok(await rejects(verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks })));
});

await check('tampered signature is rejected', async () => {
  const tok = await makeToken();
  // flip the FIRST char of the signature (top 6 bits of byte 0 → always alters
  // the bytes; the last char can fall on padding bits and be a no-op flip).
  const parts = tok.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.ok(await rejects(verifyGoogleIdToken(parts.join('.'), { clientId: CLIENT_ID, getJwks })));
});

await check('tampered payload (privilege forge) is rejected', async () => {
  const tok = await makeToken({ email: 'stranger@gmail.com' });
  const parts = tok.split('.');
  parts[1] = b64urlJSON({ iss: 'https://accounts.google.com', aud: CLIENT_ID,
    email: 'umbertocicero@gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.ok(await rejects(verifyGoogleIdToken(parts.join('.'), { clientId: CLIENT_ID, getJwks })),
    'a payload swapped after signing must fail the signature check');
});

await check('unknown signing key (kid) is rejected', async () => {
  const tok = await makeToken({ kid: 'unknown-kid' });
  assert.ok(await rejects(verifyGoogleIdToken(tok, { clientId: CLIENT_ID, getJwks })));
});

await check('parseOwners trims/lowercases and drops blanks', () => {
  assert.deepEqual(parseOwners(' A@x.com , B@Y.com ,, '), ['a@x.com', 'b@y.com']);
});

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll auth checks passed');
process.exit(failures ? 1 : 0);
