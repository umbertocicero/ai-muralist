// AI Muralist — Cloudflare Worker API proxy + mural persistence + live Kay
// Hides the Anthropic API key, adds CORS, validates/normalizes input and
// rate-limits per IP. With a D1 binding (DB) it also stores every painted
// mural at GET/POST <worker>/murals, so the world survives a refresh. With a
// Durable Object binding (KAY) it also runs the ONE shared, server-authoritative
// Kay at <worker>/live (WebSocket): his position is centralized (identical for
// every browser), advances only while ≥1 browser is connected, and he chooses +
// paints walls himself — see the KayDO class at the bottom of this file.
// Deploy: `wrangler deploy` · Secret: `wrangler secret put ANTHROPIC_API_KEY`

import { KaySim } from './js/sim.mjs';
import { demoSVG, DEMO_THOUGHTS } from './js/demo.js';
import { buildMuralPrompt, buildImageMuralPrompt, pickImageSize, parseStyle } from './js/mural-prompt.js';
import { verifyGoogleIdToken, isOwner, makeGoogleJwksFetcher } from './js/google-verify.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-user-api-key, Authorization',
};

// ---- Owner authentication --------------------------------------------------
// Privileged actions (wipe murals, change the shared demo/AI mode) require a
// Google ID token that (a) verifies against Google's public keys and (b) belongs
// to an email in OWNER_EMAILS. The JWKS is fetched+cached at module scope.
const getGoogleJwks = makeGoogleJwksFetcher();
async function verifyOwnerToken(token, env) {
  if (!token || !env.GOOGLE_CLIENT_ID) return null;
  try {
    const payload = await verifyGoogleIdToken(token, { clientId: env.GOOGLE_CLIENT_ID, getJwks: getGoogleJwks });
    return isOwner(payload.email, env.OWNER_EMAILS) ? payload.email : null;
  } catch {
    return null;
  }
}
function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

const RATE_LIMIT_MS = 8_000;      // max 1 request / 8s per IP
const MAX_BODY_BYTES = 16_000;    // reject oversized payloads early
const MAX_TOKENS_CAP = 4_096;     // clamp to bound per-request cost
const ALLOWED_MODELS = new Set([  // only models this app is meant to call
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-8',
]);

// ---- Mural persistence (D1) ------------------------------------------------
// Build tag, returned by GET /murals and logged by the client at restore time:
// makes "is the deployed Worker up to date?" answerable straight from the
// browser console. Bump when the /murals contract, validation, OR the live DO
// protocol changes — build 5 is the first to broadcast `route` messages and the
// hibernating in-memory tick, so a console still showing "build 4" means the
// Worker predates client-side route animation and MUST be redeployed. Build 6
// makes the alarm heartbeat crash-proof + force-restarted on every connect, so a
// console showing "build 5" or lower means Kay can still freeze permanently.
// Build 7 adds GET /live?world=N diagnostics (plain browser tab, no WebSocket)
// and self-heals a stale painted set: D1 is re-checked on every connect, every
// 30 s while CONTEMPLATING, and on the owner's DELETE /murals wipe. Build 8
// persists the sim (including the active walk) every tick, so hibernation wakes
// resume the route seamlessly instead of re-seeking from a stale snapshot.
// Build 9 broadcasts each route from its TRUE start (the tick breaks the moment
// a route is chosen instead of walking into it first), caps catch-up dt at 3 s,
// and slows the default pacing to an unhurried stroll. Build 10 caps the OBSERVE
// pause (standing at the wall before spraying) at 1 s — it used to inherit
// whatever cooldown was left after travel, up to the full 18-32 s when two
// walls sat close together — and shortens admire to 5 s. Build 11: observe 2 s /
// admire 4 s; NO_MORE_WALL wander-and-admire once the city is full; each mural
// records its model + prompt (D1 columns, in the broadcast, and GET /murals?id).
// Build 12 drops the 8 fixed style presets: the first mural of a world starts
// from a generic open prompt, every later one is conditioned by the previous
// piece (its SVG + thought embedded in the prompt), and KAI names his own style.
// Build 13 adds RASTER murals: POST /image proxies OpenAI gpt-image-1-mini
// (visitor's own key via x-user-api-key, or the site's OPENAI_API_KEY), and the
// murals store/broadcast accepts data:image/… pieces alongside SVG ones.
const WORKER_BUILD = 13;
const MURAL_MAX_BODY = 560_000;   // svg (≤60 KB) or data-url image (≤400 KB) + prompt + metadata
const MURAL_RATE_MS  = 3_000;     // max 1 save / 3s per IP (a paint takes ≥8s anyway)
const MURAL_LIST_CAP = 500;       // rows returned per world
// Server-side copy of the client's SVG_FORBIDDEN guard (js/config.js):
// url(#…) fragment refs (the murals' own gradient fills) are allowed; only
// external url(...) targets stay forbidden.
const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(\s*(?!#)/i;
// A raster mural rides the SAME svg column as a data URL: base64 image only,
// nothing executable. Bounded (≤400 KB ≈ a compressed 1024px webp) well inside
// D1's per-value limit.
const IMAGE_MURAL   = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const IMAGE_MURAL_MAX = 400_000;
const IMAGE_MODEL     = 'gpt-image-1-mini';
const IMAGE_SIZES     = new Set(['1024x1024', '1024x1536', '1536x1024']);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const path = new URL(request.url).pathname;
    // Live shared Kay — one Durable Object per world, keyed by ?world=<worldKey>.
    // Every browser of the same world talks to the SAME object, so they all see
    // one Kay at one position. The WebSocket upgrade is forwarded straight in.
    if (path.endsWith('/live')) {
      return handleLive(request, env);
    }
    if (path.endsWith('/murals')) {
      return handleMurals(request, env);
    }
    // Raster mural generation — proxies OpenAI's image API so the visitor's
    // ChatGPT key never has to leave their browser unprotected by CORS rules.
    if (path.endsWith('/image')) {
      return handleImage(request, env);
    }
    if (request.method !== 'POST') {
      return json({ error: { type: 'invalid_request_error', message: 'Method not allowed' } }, 405);
    }
    // The visitor may bring their OWN Anthropic key (Settings panel → sent as
    // x-user-api-key): it is used for this request instead of the site secret,
    // so generation bills them. Shape-checked, never stored.
    const userKey = request.headers.get('x-user-api-key');
    const apiKey  = (userKey && /^sk-ant-[A-Za-z0-9_-]{10,200}$/.test(userKey)) ? userKey : env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json({ error: { type: 'config_error', message: 'Server missing ANTHROPIC_API_KEY (or send x-user-api-key)' } }, 500);
    }

    // Reject oversized bodies before reading them.
    const declaredLen = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (declaredLen > MAX_BODY_BYTES) {
      return json({ error: { type: 'invalid_request_error', message: 'Payload too large' } }, 413);
    }

    // Per-IP rate limiting via KV (skipped if the binding is absent).
    const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.RATE_LIMIT_KV) {
      const last = await env.RATE_LIMIT_KV.get(`rl:${clientIP}`);
      if (last && Date.now() - parseInt(last, 10) < RATE_LIMIT_MS) {
        return json({ error: { type: 'rate_limit_error', message: 'Too many requests. Wait a moment.' } }, 429);
      }
      await env.RATE_LIMIT_KV.put(`rl:${clientIP}`, String(Date.now()), { expirationTtl: 60 });
    }

    // Read + validate body (guard against unbounded chunked payloads too).
    let text;
    try {
      text = await request.text();
    } catch {
      return json({ error: { type: 'invalid_request_error', message: 'Could not read body' } }, 400);
    }
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: { type: 'invalid_request_error', message: 'Payload too large' } }, 413);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }
    if (!body.model || !Array.isArray(body.messages) || !body.messages.length || !body.max_tokens) {
      return json({ error: { type: 'invalid_request_error', message: 'Missing required fields: model, messages, max_tokens' } }, 400);
    }
    if (!ALLOWED_MODELS.has(body.model)) {
      return json({ error: { type: 'invalid_request_error', message: `Model not allowed: ${body.model}` } }, 400);
    }

    // Normalize: clamp tokens and strip anything we don't proxy on purpose.
    const payload = {
      model: body.model,
      max_tokens: Math.min(Math.max(1, body.max_tokens | 0), MAX_TOKENS_CAP),
      messages: body.messages,
    };
    if (typeof body.temperature === 'number') payload.temperature = Math.min(Math.max(0, body.temperature), 1);
    if (typeof body.system === 'string') payload.system = body.system;

    // Proxy to Anthropic — propagate upstream status so the client can react.
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      const data = await upstream.json();
      return json(data, upstream.status);
    } catch {
      return json({ error: { type: 'upstream_error', message: 'Failed to reach AI service' } }, 502);
    }
  },
};

// POST /image → one mural picture from OpenAI gpt-image-1-mini. The visitor's
// own ChatGPT key rides x-user-api-key (never stored); without it the site's
// OPENAI_API_KEY secret is used, and with neither the endpoint reports itself
// unconfigured. Body: { prompt, size? } — the reply is { b64, mime } for the
// client to assemble into a data URL. Same per-IP limiter as text generation.
async function handleImage(request, env) {
  if (request.method !== 'POST') {
    return json({ error: { type: 'invalid_request_error', message: 'Method not allowed' } }, 405);
  }
  const userKey = request.headers.get('x-user-api-key');
  const apiKey  = (userKey && /^sk-[A-Za-z0-9_-]{10,240}$/.test(userKey)) ? userKey : env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: { type: 'config_error', message: 'No OpenAI key: send x-user-api-key or set OPENAI_API_KEY' } }, 500);
  }
  const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.RATE_LIMIT_KV) {
    const last = await env.RATE_LIMIT_KV.get(`rl:${clientIP}`);
    if (last && Date.now() - parseInt(last, 10) < RATE_LIMIT_MS) {
      return json({ error: { type: 'rate_limit_error', message: 'Too many requests. Wait a moment.' } }, 429);
    }
    await env.RATE_LIMIT_KV.put(`rl:${clientIP}`, String(Date.now()), { expirationTtl: 60 });
  }
  let body;
  try { body = await request.json(); } catch {
    return json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
  }
  const prompt = body?.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
    return json({ error: { type: 'invalid_request_error', message: 'Missing or oversized prompt' } }, 400);
  }
  const size = IMAGE_SIZES.has(body.size) ? body.size : '1024x1024';
  try {
    const upstream = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL, prompt, n: 1, size,
        quality: 'low', output_format: 'webp', output_compression: 60,   // keep the piece storable (≤400 KB)
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok || data.error) {
      return json({ error: { type: 'upstream_error', message: data?.error?.message || `OpenAI ${upstream.status}` } }, upstream.status || 502);
    }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return json({ error: { type: 'upstream_error', message: 'OpenAI returned no image' } }, 502);
    return json({ b64, mime: 'image/webp', model: IMAGE_MODEL });
  } catch {
    return json({ error: { type: 'upstream_error', message: 'Failed to reach OpenAI' } }, 502);
  }
}

// GET  /murals?world=<seed> → { murals: [...] }  every mural of that world
// POST /murals              → save one painted mural (first painter per wall wins)
// Optional feature: without the D1 binding it answers 501 and the client
// simply runs non-persistent, exactly like the KV-less rate limiter.
async function handleMurals(request, env) {
  if (!env.DB) {
    return json({ error: { type: 'config_error', message: 'Persistence not configured (missing D1 binding DB)' } }, 501);
  }

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    // GET /murals?id=<n> → ONE mural with its full provenance (model + prompt).
    // The list below omits the (large, near-identical) prompt to keep the boot
    // payload small; the detail view fetches it here only when a mural is opened.
    const idParam = params.get('id');
    if (idParam != null) {
      const id = parseInt(idParam, 10);
      if (!Number.isFinite(id)) {
        return json({ error: { type: 'invalid_request_error', message: 'Bad ?id=' } }, 400);
      }
      const row = await env.DB.prepare(
        `SELECT id, style, thought, svg, model, prompt, user_id, wall_w, wall_h, created_at
           FROM murals WHERE id = ?1`).bind(id).first();
      if (!row) return json({ error: { type: 'not_found', message: 'No such mural' } }, 404);
      return json({ mural: row, build: WORKER_BUILD });
    }
    const world = parseInt(params.get('world') ?? '', 10);
    if (!Number.isFinite(world)) {
      return json({ error: { type: 'invalid_request_error', message: 'Missing ?world=<seed>' } }, 400);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, px, py, pz, nx, nz, wall_w, wall_h, style, thought, svg, user_id, model, created_at
         FROM murals WHERE world = ?1 ORDER BY id LIMIT ${MURAL_LIST_CAP}`
    ).bind(world).all();
    return json({ murals: results ?? [], build: WORKER_BUILD });
  }

  // DELETE /murals?world=<seed>  → wipe this world's shared canvas (the Settings
  // "DELETE MURALS" reset). OWNER ONLY: requires a valid Google ID token for an
  // OWNER_EMAILS account. Scoped to one world, so it can't touch archived rows
  // saved under other seeds / town builds.
  if (request.method === 'DELETE') {
    const owner = await verifyOwnerToken(bearerToken(request), env);
    if (!owner) {
      return json({ error: { type: 'auth_error', message: 'Sign in as the owner to delete murals' } }, 401);
    }
    const world = parseInt(new URL(request.url).searchParams.get('world') ?? '', 10);
    if (!Number.isFinite(world)) {
      return json({ error: { type: 'invalid_request_error', message: 'Missing ?world=<seed>' } }, 400);
    }
    const res = await env.DB.prepare(`DELETE FROM murals WHERE world = ?1`).bind(world).run();
    // Tell the live Kay of this world his painted memory is stale, so he starts
    // repainting the blank walls immediately instead of contemplating a world he
    // remembers as finished (the DO also self-heals every 30 s, this is just fast).
    if (env.KAY) {
      try {
        await env.KAY.get(env.KAY.idFromName(String(world)))
          .fetch('https://do/live?world=' + world, { method: 'DELETE' });
      } catch { /* best-effort — the 30 s self-heal covers it */ }
    }
    return json({ deleted: res?.meta?.changes ?? 0 });
  }

  if (request.method !== 'POST') {
    return json({ error: { type: 'invalid_request_error', message: 'Method not allowed' } }, 405);
  }

  // Per-IP rate limit (own key prefix — a save always follows a generate call,
  // so sharing the generate limiter would block every save).
  const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.RATE_LIMIT_KV) {
    const last = await env.RATE_LIMIT_KV.get(`rlm:${clientIP}`);
    if (last && Date.now() - parseInt(last, 10) < MURAL_RATE_MS) {
      return json({ error: { type: 'rate_limit_error', message: 'Too many saves. Wait a moment.' } }, 429);
    }
    await env.RATE_LIMIT_KV.put(`rlm:${clientIP}`, String(Date.now()), { expirationTtl: 60 });
  }

  let body;
  try {
    const text = await request.text();
    if (text.length > MURAL_MAX_BODY) throw new Error('too_large');
    body = JSON.parse(text);
  } catch {
    return json({ error: { type: 'invalid_request_error', message: 'Invalid or oversized body' } }, 400);
  }

  // Validate — numbers finite and inside the little world, strings bounded,
  // svg re-checked server-side with the same guard the client uses. Each check
  // NAMES what failed: a bare "invalid record" made real deployments
  // undebuggable from the browser console.
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const { world, px, py, pz, nx, nz, wallW, wallH, style, thought, svg, userId, model, prompt } = body ?? {};
  // The svg field carries EITHER real SVG markup (Claude pieces — full forbidden-
  // reference guard) OR a base64 data-url image (gpt-image pieces — no markup at
  // all, just a bounded base64 payload of an allowed raster type).
  const isImage = typeof svg === 'string' && svg.startsWith('data:image/');
  const artBad =
    typeof svg !== 'string'                                    ? 'svg' :
    isImage
      ? (svg.length > IMAGE_MURAL_MAX ? 'image size' : !IMAGE_MURAL.test(svg) ? 'image content' : null)
      : (svg.length > 60_000                 ? 'svg size' :
         !svg.trimStart().startsWith('<svg') ? 'svg prefix' :
         SVG_FORBIDDEN.test(svg)             ? 'svg content (forbidden reference)' : null);
  const bad =
    !Number.isInteger(world)                                          ? 'world' :
    !(num(px, -200, 200) && num(py, 0, 50) && num(pz, -200, 200))     ? 'position' :
    !(num(nx, -1.01, 1.01) && num(nz, -1.01, 1.01))                   ? 'normal' :
    !(num(wallW, 0.5, 30) && num(wallH, 0.5, 30))                     ? 'wall size' :
    !(typeof style === 'string' && style.length <= 40)                ? 'style' :
    !(thought == null || (typeof thought === 'string' && thought.length <= 300)) ? 'thought' :
    artBad                                                            ? artBad :
    !(typeof userId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(userId)) ? 'userId' :
    !(model  == null || (typeof model  === 'string' && model.length  <= 40))    ? 'model' :
    !(prompt == null || (typeof prompt === 'string' && prompt.length <= 12_000)) ? 'prompt' :
    null;
  if (bad) {
    return json({ error: { type: 'invalid_request_error', message: `Invalid mural record: ${bad}` } }, 400);
  }

  // First painter per wall wins: the unique (world, px, py, pz) index turns a
  // duplicate into a no-op instead of an error.
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO murals (world, px, py, pz, nx, nz, wall_w, wall_h, style, thought, svg, user_id, model, prompt)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
  ).bind(world, px, py, pz, nx, nz, wallW, wallH, style, thought ?? null, svg, userId, model ?? null, prompt ?? null).run();
  const saved = (res?.meta?.changes ?? 0) > 0;
  return json({ saved }, saved ? 201 : 200);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ===========================================================================
//  Live shared Kay — Durable Object
// ===========================================================================
// GET /live?world=<worldKey>  (WebSocket upgrade) → connect to the ONE Kay of
// this world. The Worker routes every connection for a given worldKey to the
// same Durable Object instance (idFromName), so all browsers share one
// authoritative simulation. Without the KAY binding the client silently falls
// back to its own local Kay (see js/main.js).
function handleLive(request, env) {
  if (!env.KAY) {
    return json({ error: { type: 'config_error', message: 'Live not configured (missing Durable Object binding KAY)' } }, 501);
  }
  const world = parseInt(new URL(request.url).searchParams.get('world') ?? '', 10);
  if (!Number.isFinite(world)) {
    return json({ error: { type: 'invalid_request_error', message: 'Missing ?world=<worldKey>' } }, 400);
  }
  const id = env.KAY.idFromName(String(world));
  return env.KAY.get(id).fetch(request);
}

// Pacing knobs. All optional env overrides so a deployment can slow Kay down
// (token cost) without a code change.
// Kay ticks COARSELY on the server (an alarm every SIM_STEP_MS) and HIBERNATES in
// between — browsers animate the walk smoothly on their side from the broadcast
// route, so the server doesn't need a fast heartbeat. This keeps the DO cheap:
// ~1 request / 2 s and near-zero billable duration (it sleeps between alarms).
const SIM_STEP_MS = 2000;
const FIRST_TICK_MS = 300;    // first tick shortly after a connect, so Kay sets off promptly
// Bump when the uploaded world model's shape/resolution changes, so a DO holding
// an older cached model discards it and asks the next client to re-upload.
const MODEL_VERSION = 2;
const KAY_MODEL_DEFAULT = 'claude-sonnet-4-6';
const STYLE_NAMES = ['Ukiyo-e', 'Sumi-e', 'Manga', 'Woodblock', 'Anime', 'Kirie', 'Wabi-sabi', 'Kanji'];
const envNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
// NB: env vars set in the dashboard OVERRIDE these code defaults — if the pace
// still feels frantic after a deploy, check for a stale KAY_COOLDOWN_MIN /
// KAY_PAINT / KAY_ADMIRE var pinning the old rhythm.
function pacing(env) {
  return {
    moveSpeed:       envNum(env.KAY_SPEED, 2.6),      // stroll speed (m/s)
    paintMinSeconds: envNum(env.KAY_PAINT, 7.0),      // min spray time (demo shows a few s)
    paintMaxSeconds: envNum(env.KAY_PAINT_MAX, 45),   // cap while AI generation is in flight
    admireSeconds:   envNum(env.KAY_ADMIRE, 4.0),
    cooldownMin:     envNum(env.KAY_COOLDOWN_MIN, 18),
    cooldownRange:   envNum(env.KAY_COOLDOWN_RANGE, 14),
    observeMaxSeconds: envNum(env.KAY_OBSERVE_MAX, 2.0),  // cap the pre-paint "sizing up" pause
  };
}

export class KayDO {
  constructor(state, env) {
    this.state    = state;
    this.env      = env;
    this.storage  = state.storage;
    this.sim      = null;
    this.worldKey = null;
    this.demo     = false;         // site demo mode → procedural murals, no Anthropic call
    this._loaded  = false;
    this._generating = false;      // an AI paint is in flight (guards double-start)
    this._lastTick = null;         // wall-clock of the last advance (per live instance)
    this._routeSentFor = null;     // targetId whose route we've already broadcast
    this._lastReconcile = 0;       // last painted-vs-D1 rebuild (CONTEMPLATING self-heal)
    this._lastMural = null;        // {style,thought,svg} of the last paint — prompt conditioning fallback when D1 is absent
  }

  // Presence + broadcast go through the hibernation API's socket list, so they
  // survive the object being evicted from memory between alarms.
  _sockets() { return this.state.getWebSockets(); }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  _broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this._sockets()) { try { ws.send(s); } catch {} }
  }

  // Restore the simulation from storage on first touch (the DO may have been
  // evicted while frozen). The world MODEL (grid + wall catalogue) is stored
  // once, uploaded by the first browser; Kay's live state is stored each tick.
  async _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    this.worldKey = (await this.storage.get('worldKey')) ?? null;
    this.demo     = (await this.storage.get('demo')) ?? false;
    const model = await this.storage.get('model');
    if (model && model.version === MODEL_VERSION) {
      this.sim = new KaySim(model, pacing(this.env));
      const saved = await this.storage.get('sim');
      if (saved) this.sim.hydrate(saved);
      await this._reconcilePainted();
    } else if (model) {
      // Model version mismatch — clear stale data so the client can upload fresh.
      console.log(`[KayDO] discarding model version ${model.version} (expected ${MODEL_VERSION})`);
      await this.storage.delete('model');
      await this.storage.delete('sim');
    }
  }

  // Seed the sim's "already painted" set from D1 so Kay never wastes tokens
  // repainting walls a previous session (or another world build) already covered.
  // Matches each stored mural to its wall by anchor (same 0.1 m tolerance the
  // client restore uses to absorb 3-decimal rounding).
  async _reconcilePainted() {
    if (!this.sim || !this.env.DB || !Number.isInteger(this.worldKey)) return;
    try {
      const { results } = await this.env.DB.prepare(
        `SELECT px, py, pz FROM murals WHERE world = ?1`).bind(this.worldKey).all();
      for (const row of results ?? []) {
        const w = this.sim.walls.find((w) =>
          (w.px - row.px) ** 2 + (w.py - row.py) ** 2 + (w.pz - row.pz) ** 2 < 0.01);
        if (w) this.sim.painted.add(w.id);
      }
    } catch { /* best-effort — worst case Kay revisits a painted wall (INSERT ignored) */ }
  }

  // Throw away the sim's "already painted" belief and re-derive it from D1 (the
  // only durable truth). Guards against the freeze where the owner wipes the
  // murals table while this DO's stored sim still lists every wall as painted —
  // hasFreeReachable() stays false and Kay CONTEMPLATES an actually-blank world
  // forever. Rebuilding converges painted to D1, so wiped walls free up again.
  async _rebuildPainted() {
    if (!this.sim || !this.env.DB) return;
    const before = this.sim.painted.size;
    this.sim.painted.clear();
    this.sim._defer.clear();
    await this._reconcilePainted();
    if (this.sim.painted.size !== before) {
      console.log(`[KayDO] painted rebuilt from D1: ${before} → ${this.sim.painted.size} (world ${this.worldKey})`);
      try { await this.storage.put('sim', this.sim.serialize()); } catch {}
    }
  }

  // One-page health report for GET /live?world=N (no WebSocket): everything
  // needed to answer "why isn't Kay moving?" from a plain browser tab.
  async _diagnostics() {
    const alarm = await this.storage.getAlarm();
    let d1Murals = null;
    if (this.env.DB && Number.isInteger(this.worldKey)) {
      try {
        d1Murals = (await this.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM murals WHERE world = ?1`).bind(this.worldKey).first())?.n ?? null;
      } catch {}
    }
    return {
      build: WORKER_BUILD, worldKey: this.worldKey, demo: this._isDemo(),
      sockets: this._sockets().length,
      alarmInMs: alarm == null ? null : alarm - Date.now(),
      d1Murals,
      sim: this.sim ? {
        state: this.sim.state, status: this.sim.status,
        x: this.sim.x, z: this.sim.z, targetId: this.sim.targetId,
        muralCount: this.sim.muralCount,
        wallsTotal: this.sim.walls.length,
        painted: this.sim.painted.size,
        freeReachable: this.sim._freeWalls().length,
        deferred: this.sim._defer.size,
        cooldownLeft: this.sim._cooldownLeft,
        pathFails: this.sim._pathFails,
        generating: this._generating,
      } : null,
    };
  }

  async fetch(request) {
    await this._ensureLoaded();
    const world = parseInt(new URL(request.url).searchParams.get('world') ?? '', 10);
    if (Number.isFinite(world) && this.worldKey == null) this.worldKey = world;

    if (request.headers.get('Upgrade') !== 'websocket') {
      // DELETE → re-derive the painted set from D1. Fired by the owner's
      // DELETE /murals wipe so Kay starts repainting the now-blank walls at
      // once. Harmless if called publicly: rebuilding from D1 is idempotent —
      // it can only converge painted to the truth, never fake it.
      if (request.method === 'DELETE') {
        await this._rebuildPainted();
        return json({ ok: true, painted: this.sim ? this.sim.painted.size : null });
      }
      // Anything else (a plain GET in a browser tab) → read-only diagnostics.
      // This is how "Kay isn't moving" gets debugged without wrangler access:
      // GET <worker>/live?world=N shows the sim state, painted vs D1 counts,
      // pathfinding failures and whether an alarm is pending.
      return json(await this._diagnostics());
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // HIBERNATABLE accept: the object can be evicted from memory between alarms
    // (no billing while asleep) and still keep this connection open.
    this.state.acceptWebSocket(server);

    this._send(server, {
      type: 'hello', build: WORKER_BUILD, worldKey: this.worldKey,
      needWorld: !this.sim, kay: this.sim ? this.sim.snapshot() : null,
      route: this.sim ? this.sim.currentRoute() : null,   // mid-walk joiner resumes the route
    });
    // Force a prompt tick on EVERY connect — unconditionally, not "only if no
    // alarm exists". A browser opening the page must always revive Kay: if a
    // previous tick threw and the runtime left the alarm wedged in retry/backoff
    // (getAlarm() stays non-null, so _ensureAlarm would be a no-op), setAlarm here
    // REPLACES that wedged alarm with a fresh near-term one and the heartbeat
    // resumes. Without this, one bad tick could freeze Kay until a redeploy.
    await this.storage.setAlarm(Date.now() + FIRST_TICK_MS);
    // Freshen painted from D1 in the background: if murals were wiped while this
    // DO remembered its walls as painted, the next visitor un-freezes Kay.
    this.state.waitUntil(this._rebuildPainted());
    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation delivers socket messages here (not via addEventListener).
  async webSocketMessage(ws, message) {
    await this._ensureLoaded();
    let msg;
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch { return; }
    // The shared demo/AI mode. OWNER ONLY — the message must carry a Google ID
    // token for an OWNER_EMAILS account, else it's ignored (the baseline still
    // comes from KAY_DEMO / stored state). This is why any visitor's local mode
    // setting can't flip the shared Kay.
    if (msg.type === 'mode') {
      const owner = await verifyOwnerToken(msg.token, this.env);
      if (!owner) { this._send(ws, { type: 'notice', level: 'error', message: 'Sign in as the owner to change the mode' }); return; }
      this.demo = !!msg.demo;
      await this.storage.put('demo', this.demo);
      console.log(`[KayDO] mode set to ${this.demo ? 'demo' : 'AI'} by ${owner}`);
      return;
    }
    if (msg.type === 'world' && !this.sim) {
      const model = decodeModel(msg.model);
      if (!model) { this._send(ws, { type: 'error', message: 'bad world model' }); return; }
      if (Number.isInteger(msg.worldKey)) this.worldKey = msg.worldKey;
      // NB: demo is NOT taken from the (unauthenticated) world upload — only from
      // KAY_DEMO / stored state / an authenticated `mode` message.
      this.sim = new KaySim(model, pacing(this.env));
      await this.storage.put('model', model);
      await this.storage.put('worldKey', this.worldKey);
      await this._reconcilePainted();
      await this._ensureAlarm(FIRST_TICK_MS);
    }
  }

  // The last viewer leaving is detected by the next alarm (0 sockets → freeze),
  // but snapshot immediately on close so a reconnect resumes from the exact spot.
  async webSocketClose() {
    if (this._sockets().length <= 1 && this.sim) { try { await this.storage.put('sim', this.sim.serialize()); } catch {} }
  }
  async webSocketError() { /* handled by the next alarm */ }

  // Whether to paint procedurally instead of calling Anthropic: forced by env,
  // forced when no site key is configured, or the client-reported demo mode.
  _isDemo() {
    if (this.env.KAY_DEMO === 'true') return true;
    if (!this.env.ANTHROPIC_API_KEY) return true;
    return this.demo;
  }

  async _ensureAlarm(ms = SIM_STEP_MS) {
    if ((await this.storage.getAlarm()) == null) await this.storage.setAlarm(Date.now() + ms);
  }

  // The heartbeat — one coarse step every ~2 s, then the object HIBERNATES until
  // the next alarm. sim.advance() sub-steps internally so the trajectory matches
  // continuous ticking; browsers animate the walk smoothly in between from the
  // broadcast route. Broadcasts: a fresh `route` whenever Kay heads to a new wall,
  // and his authoritative `kay` keyframe (position + state) each tick. When nobody
  // is connected it does NOT reschedule → the world freezes and stops billing.
  async alarm() {
    // A tick must NEVER kill the heartbeat. If _tick throws, the runtime would
    // retry it with backoff — and while it retries, getAlarm() stays non-null, so
    // reconnecting browsers (whose _ensureAlarm only sets an alarm when none
    // exists) can't restart it: Kay stays frozen until a redeploy. Catching here
    // and rescheduling ourselves turns a fatal tick into "skip one, try again in
    // 2 s", and surfaces the cause in `wrangler tail`.
    try {
      await this._tick();
    } catch (e) {
      console.error('[KayDO] tick failed, keeping heartbeat alive:', e?.stack || e);
      try {
        if (this._sockets().length > 0) await this.storage.setAlarm(Date.now() + SIM_STEP_MS);
      } catch {}
    }
  }

  async _tick() {
    await this._ensureLoaded();
    const socketCount = this._sockets().length;
    if (socketCount === 0) {             // nobody watching → freeze
      if (this.sim) await this.storage.put('sim', this.sim.serialize());
      return;
    }
    if (!this.sim) {
      console.log(`[KayDO] alarm: waiting for world model (${socketCount} socket${socketCount !== 1 ? 's' : ''})`);
      await this.storage.setAlarm(Date.now() + SIM_STEP_MS); return;
    }

    const now = Date.now();
    // Real elapsed since the last advance; on the first tick after a hibernation
    // wake (_lastTick lost) assume the scheduled interval.
    let dt = this._lastTick ? (now - this._lastTick) / 1000 : SIM_STEP_MS / 1000;
    this._lastTick = now;
    // Cap catch-up at 3 s (not 6): a late alarm made the keyframe leap up to
    // 15 m in one tick, blowing past the client's teleport guard — on screen Kay
    // "jumped several metres". 3 s bounds any leap to under the guard distance.
    dt = Math.min(Math.max(dt, 0.05), 3);

    const sig = this.sim.advance(dt);
    if (sig && sig.paint && !this._generating) {
      this._generating = true;
      // Keep the object awake through the (possibly seconds-long) AI generation.
      this.state.waitUntil(this._paintWall(sig.paint));
    }

    // Broadcast a fresh route once per wall Kay starts walking to — from the
    // START, so every client walks the whole path in lock-step (this coarse tick
    // may already have advanced Kay several metres into it).
    if (this.sim.state === 'MOVING_TO_WALL' && this.sim.targetId !== this._routeSentFor) {
      const route = this.sim.currentRoute(true);
      if (route) { this._broadcast({ type: 'route', ...route }); this._routeSentFor = this.sim.targetId; }
    } else if (this.sim.state !== 'MOVING_TO_WALL') {
      this._routeSentFor = null;
    }
    this._broadcast({ type: 'kay', ...this.sim.snapshot() });

    // NO_MORE_WALL self-heal: "every wall painted" may be a stale belief (e.g.
    // the murals table was wiped since). While he wanders the finished gallery,
    // re-derive the painted set from D1 every 30 s — if walls freed up, SEEKING
    // resumes on its own (the sim re-checks hasFreeReachable while roaming).
    if (this.sim.state === 'NO_MORE_WALL' && this.env.DB && now - this._lastReconcile > 30_000) {
      this._lastReconcile = now;
      await this._rebuildPainted();
    }

    // Persist EVERY tick (one tiny row on SQLite-backed storage): with the old
    // 30 s cadence a hibernation wake hydrated a snapshot up to 30 s stale, so
    // Kay rolled back mid-walk — the client's >8 m teleport guard then snapped
    // him around. A fresh snapshot each tick makes wakes seamless.
    await this.storage.put('sim', this.sim.serialize());
    await this.storage.setAlarm(now + SIM_STEP_MS);
  }

  // Kay reached a wall → imagine + paint it. In DEMO mode he paints a procedural
  // mural (no Anthropic call); otherwise he calls Anthropic with the SITE key (he
  // runs autonomously, no visitor key). Either way the piece is stored in D1 (same
  // table as the client save path) and broadcast to every browser, then Kay is
  // released to finish his brush stroke. Any failure just skips the wall (retried).
  async _paintWall(wall) {
    try {
      const index = this.sim.muralCount;
      let svg, thought, model, prompt;

      let style;
      if (this._isDemo()) {
        const PW = 512, PH = Math.round(512 * (wall.wallH / wall.wallW));
        svg     = demoSVG(PW, PH, index);
        thought = DEMO_THOUGHTS[index % DEMO_THOUGHTS.length];
        style   = STYLE_NAMES[index % STYLE_NAMES.length];   // procedural pieces keep the rotation
        model   = 'demo';         // procedural — no model, no prompt to recreate
        prompt  = null;
      } else if (this.env.KAY_PROVIDER === 'openai' && this.env.OPENAI_API_KEY) {
        // Raster Kay: gpt-image-1-mini paints the piece. Conditioning is textual
        // (style + thought of the previous piece — an image model reads no SVG).
        const prev = await this._latestMural();
        prompt = buildImageMuralPrompt(wall, index, prev);
        model  = IMAGE_MODEL;
        const upstream = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: IMAGE_MODEL, prompt, n: 1, size: pickImageSize(wall),
            quality: 'low', output_format: 'webp', output_compression: 60,
          }),
        });
        const data = await upstream.json();
        if (!upstream.ok || data.error) {
          throw new Error(`OpenAI ${upstream.status}: ${data?.error?.message || 'api_error'}`);
        }
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) throw new Error('OpenAI returned no image');
        svg     = `data:image/webp;base64,${b64}`;
        thought = null;                          // an image model has no inner monologue
        style   = 'Image';
      } else {
        // Conditioning: the newest mural of THIS world (D1 is the durable truth,
        // so the chain resets by itself when the murals table is wiped). null →
        // first mural → the generic open prompt; KAI names his own style either way.
        const prev = await this._latestMural();
        const { text } = buildMuralPrompt(wall, index, prev);
        model  = this.env.KAY_MODEL || KAY_MODEL_DEFAULT;
        prompt = text;            // the exact prompt, stored so a viewer can recreate it
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': this.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model,
            max_tokens: 2048, temperature: 1,
            messages: [{ role: 'user', content: text }],
          }),
        });
        const data = await upstream.json();
        if (!upstream.ok || data.error) {
          throw new Error(`Anthropic ${upstream.status}: ${data?.error?.message || 'api_error'}`);
        }
        const raw = data?.content?.[0]?.text;
        const parsed = parseMural(raw);
        svg = parsed.svg; thought = parsed.thought;
        style = parseStyle(raw);
      }

      const isImage = typeof svg === 'string' && svg.startsWith('data:image/');
      if (isImage) {
        if (svg.length > IMAGE_MURAL_MAX || !IMAGE_MURAL.test(svg)) throw new Error('no usable image');
      } else if (!svg || svg.length > 60_000 || SVG_FORBIDDEN.test(svg) || !svg.trimStart().startsWith('<svg')) {
        throw new Error('no usable SVG');
      }

      if (this.env.DB && Number.isInteger(this.worldKey)) {
        const r3 = (v) => Math.round(v * 1000) / 1000;
        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO murals (world, px, py, pz, nx, nz, wall_w, wall_h, style, thought, svg, user_id, model, prompt)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
        ).bind(this.worldKey, r3(wall.px), r3(wall.py), r3(wall.pz), r3(wall.nx), r3(wall.nz),
               r3(wall.wallW), r3(wall.wallH), style, thought ?? null, svg, 'kay-server', model, prompt).run();
      }

      this.sim.paintDone({ svg, thought });
      this._lastMural = { style, thought: thought ?? null, svg };   // no-DB conditioning fallback
      console.log(`[KayDO] painted wall ${wall.id} · ${style} · mural #${index} · world ${this.worldKey}${this._isDemo() ? ' · demo' : ''}`);
      // Broadcast in the SAME shape the client's mural-apply expects (mirrors a
      // /murals row): the browser matches it to the wall slot by anchor. model +
      // prompt ride along so the detail view has them without a follow-up fetch.
      this._broadcast({
        type: 'mural',
        px: wall.px, py: wall.py, pz: wall.pz, nx: wall.nx, nz: wall.nz,
        wall_w: wall.wallW, wall_h: wall.wallH,
        style, thought: thought ?? null, svg, user_id: 'kay-server', model, prompt,
      });
    } catch (e) {
      this._paintError('paint failed — ' + (e?.message || e));
      this.sim.paintFailed();
    } finally {
      this._generating = false;
    }
  }

  // Surface a paint failure both in `wrangler tail` (console) and in every
  // connected browser's console (a `notice` the client logs) — so "Kay isn't
  // painting" is never a silent mystery again.
  _paintError(message) {
    console.warn('[KayDO]', message);
    this._broadcast({ type: 'notice', level: 'error', message });
  }

  // The newest mural of this world — the piece that CONDITIONS the next prompt
  // (see js/mural-prompt.js). D1 is the source of truth: reading it fresh each
  // paint means the conversation chain survives hibernation AND resets by
  // itself the moment the murals table is wiped (the memory reset). Without a
  // DB binding, fall back to the in-memory last paint of this live instance.
  async _latestMural() {
    if (this.env.DB && Number.isInteger(this.worldKey)) {
      try {
        const row = await this.env.DB.prepare(
          `SELECT style, thought, svg FROM murals WHERE world = ?1 ORDER BY id DESC LIMIT 1`
        ).bind(this.worldKey).first();
        return row ?? null;
      } catch { /* fall through to the in-memory copy */ }
    }
    return this._lastMural;
  }
}

// Decode + validate the world model a browser uploads. `cells` travels as
// base64 of a per-cell Uint8Array (0 = walkable, else solid) to keep the message
// small; everything else is plain JSON. Returns the model with a real Uint8Array,
// or null if it fails any sanity check.
function decodeModel(m) {
  try {
    if (!m || typeof m !== 'object') return null;
    if (!Number.isFinite(m.half) || !(m.cellSize > 0)) return null;
    const cols = m.cols | 0, rows = m.rows | 0;
    if (cols <= 0 || rows <= 0 || cols * rows > 200_000) return null;
    if (!m.spawn || !Number.isFinite(m.spawn.x) || !Number.isFinite(m.spawn.z)) return null;
    if (!Array.isArray(m.walls) || !m.walls.length || m.walls.length > 4000) return null;
    const bin = atob(m.cellsB64);
    if (bin.length !== cols * rows) return null;
    const cells = new Uint8Array(cols * rows);
    for (let i = 0; i < bin.length; i++) cells[i] = bin.charCodeAt(i);
    const walls = m.walls.map((w, i) => ({
      id: Number.isInteger(w.id) ? w.id : i,
      px: +w.px, py: +w.py, pz: +w.pz, nx: +w.nx, nz: +w.nz,
      wallW: +w.wallW, wallH: +w.wallH, ax: +w.ax, az: +w.az,
    }));
    if (walls.some((w) => ![w.px, w.pz, w.nx, w.nz, w.ax, w.az, w.wallW, w.wallH].every(Number.isFinite))) return null;
    return { version: Number.isInteger(m.version) ? m.version : 0,
             half: +m.half, cellSize: +m.cellSize, cols, rows, cells,
             spawn: { x: +m.spawn.x, z: +m.spawn.z }, walls };
  } catch { return null; }
}

function parseMural(raw) {
  let thought = 'this grey wall has been waiting for someone like me';
  if (typeof raw !== 'string') return { thought, svg: null };
  const tm = raw.match(/THOUGHT:\s*(.+)/i);
  if (tm) thought = tm[1].split('\n')[0].trim().replace(/^["']|["']$/g, '');
  const start = raw.indexOf('<svg');
  const end   = raw.lastIndexOf('</svg>');
  const svg   = (start !== -1 && end !== -1) ? raw.slice(start, end + 6) : null;
  return { thought, svg };
}
