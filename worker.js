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
// browser console. Bump when the /murals contract or validation changes.
const WORKER_BUILD = 4;
const MURAL_MAX_BODY = 80_000;    // svg (≤60 KB) + metadata
const MURAL_RATE_MS  = 3_000;     // max 1 save / 3s per IP (a paint takes ≥8s anyway)
const MURAL_LIST_CAP = 500;       // rows returned per world
// Server-side copy of the client's SVG_FORBIDDEN guard (js/config.js):
// url(#…) fragment refs (the murals' own gradient fills) are allowed; only
// external url(...) targets stay forbidden.
const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(\s*(?!#)/i;

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

// GET  /murals?world=<seed> → { murals: [...] }  every mural of that world
// POST /murals              → save one painted mural (first painter per wall wins)
// Optional feature: without the D1 binding it answers 501 and the client
// simply runs non-persistent, exactly like the KV-less rate limiter.
async function handleMurals(request, env) {
  if (!env.DB) {
    return json({ error: { type: 'config_error', message: 'Persistence not configured (missing D1 binding DB)' } }, 501);
  }

  if (request.method === 'GET') {
    const world = parseInt(new URL(request.url).searchParams.get('world') ?? '', 10);
    if (!Number.isFinite(world)) {
      return json({ error: { type: 'invalid_request_error', message: 'Missing ?world=<seed>' } }, 400);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, px, py, pz, nx, nz, wall_w, wall_h, style, thought, svg, user_id, created_at
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
  const { world, px, py, pz, nx, nz, wallW, wallH, style, thought, svg, userId } = body ?? {};
  const bad =
    !Number.isInteger(world)                                          ? 'world' :
    !(num(px, -200, 200) && num(py, 0, 50) && num(pz, -200, 200))     ? 'position' :
    !(num(nx, -1.01, 1.01) && num(nz, -1.01, 1.01))                   ? 'normal' :
    !(num(wallW, 0.5, 30) && num(wallH, 0.5, 30))                     ? 'wall size' :
    !(typeof style === 'string' && style.length <= 40)                ? 'style' :
    !(thought == null || (typeof thought === 'string' && thought.length <= 300)) ? 'thought' :
    !(typeof svg === 'string' && svg.length <= 60_000)                ? 'svg size' :
    !svg.trimStart().startsWith('<svg')                               ? 'svg prefix' :
    SVG_FORBIDDEN.test(svg)                                           ? 'svg content (forbidden reference)' :
    !(typeof userId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(userId)) ? 'userId' :
    null;
  if (bad) {
    return json({ error: { type: 'invalid_request_error', message: `Invalid mural record: ${bad}` } }, 400);
  }

  // First painter per wall wins: the unique (world, px, py, pz) index turns a
  // duplicate into a no-op instead of an error.
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO murals (world, px, py, pz, nx, nz, wall_w, wall_h, style, thought, svg, user_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  ).bind(world, px, py, pz, nx, nz, wallW, wallH, style, thought ?? null, svg, userId).run();
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
const PERSIST_MS = 30_000;    // how often to snapshot sim state to storage
// Bump when the uploaded world model's shape/resolution changes, so a DO holding
// an older cached model discards it and asks the next client to re-upload.
const MODEL_VERSION = 2;
const KAY_MODEL_DEFAULT = 'claude-sonnet-4-6';
const STYLE_NAMES = ['Ukiyo-e', 'Sumi-e', 'Manga', 'Woodblock', 'Anime', 'Kirie', 'Wabi-sabi', 'Kanji'];
const envNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
function pacing(env) {
  return {
    moveSpeed:       envNum(env.KAY_SPEED, 2.6),      // stroll speed (m/s)
    paintMinSeconds: envNum(env.KAY_PAINT, 5.0),      // min spray time (demo shows a few s)
    paintMaxSeconds: envNum(env.KAY_PAINT_MAX, 45),   // cap while AI generation is in flight
    admireSeconds:   envNum(env.KAY_ADMIRE, 3.0),
    cooldownMin:     envNum(env.KAY_COOLDOWN_MIN, 6),
    cooldownRange:   envNum(env.KAY_COOLDOWN_RANGE, 6),
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
    this._lastPersist = 0;
    this._routeSentFor = null;     // targetId whose route we've already broadcast
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
    // Ignore a cached model from an older MODEL_VERSION (e.g. the coarser grid) —
    // leaving sim null makes the next client re-upload the current one.
    if (model && model.version === MODEL_VERSION) {
      this.sim = new KaySim(model, pacing(this.env));
      const saved = await this.storage.get('sim');
      if (saved) this.sim.hydrate(saved);
      await this._reconcilePainted();
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

  async fetch(request) {
    await this._ensureLoaded();
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: { type: 'invalid_request_error', message: 'Expected WebSocket' } }, 426);
    }
    const world = parseInt(new URL(request.url).searchParams.get('world') ?? '', 10);
    if (Number.isFinite(world) && this.worldKey == null) this.worldKey = world;

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
    await this._ensureAlarm(FIRST_TICK_MS);   // first client → start the coarse tick
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
    if (!this.sim) return;
    if ((await this.storage.getAlarm()) == null) await this.storage.setAlarm(Date.now() + ms);
  }

  // The heartbeat — one coarse step every ~2 s, then the object HIBERNATES until
  // the next alarm. sim.advance() sub-steps internally so the trajectory matches
  // continuous ticking; browsers animate the walk smoothly in between from the
  // broadcast route. Broadcasts: a fresh `route` whenever Kay heads to a new wall,
  // and his authoritative `kay` keyframe (position + state) each tick. When nobody
  // is connected it does NOT reschedule → the world freezes and stops billing.
  async alarm() {
    await this._ensureLoaded();
    if (this._sockets().length === 0) {             // nobody watching → freeze
      if (this.sim) await this.storage.put('sim', this.sim.serialize());
      return;
    }
    if (!this.sim) { await this.storage.setAlarm(Date.now() + SIM_STEP_MS); return; }

    const now = Date.now();
    // Real elapsed since the last advance; on the first tick after a hibernation
    // wake (_lastTick lost) assume the scheduled interval.
    let dt = this._lastTick ? (now - this._lastTick) / 1000 : SIM_STEP_MS / 1000;
    this._lastTick = now;
    dt = Math.min(Math.max(dt, 0.05), 6);

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

    if (now - this._lastPersist > PERSIST_MS) { this._lastPersist = now; await this.storage.put('sim', this.sim.serialize()); }
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
      let svg, thought;

      if (this._isDemo()) {
        const PW = 512, PH = Math.round(512 * (wall.wallH / wall.wallW));
        svg     = demoSVG(PW, PH, index);
        thought = DEMO_THOUGHTS[index % DEMO_THOUGHTS.length];
      } else {
        const { text } = buildMuralPrompt(wall, index);
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': this.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: this.env.KAY_MODEL || KAY_MODEL_DEFAULT,
            max_tokens: 2048, temperature: 1,
            messages: [{ role: 'user', content: text }],
          }),
        });
        const data = await upstream.json();
        if (!upstream.ok || data.error) {
          throw new Error(`Anthropic ${upstream.status}: ${data?.error?.message || 'api_error'}`);
        }
        const parsed = parseMural(data?.content?.[0]?.text);
        svg = parsed.svg; thought = parsed.thought;
      }

      if (!svg || svg.length > 60_000 || SVG_FORBIDDEN.test(svg) || !svg.trimStart().startsWith('<svg')) {
        throw new Error('no usable SVG');
      }
      const style = STYLE_NAMES[index % STYLE_NAMES.length];

      if (this.env.DB && Number.isInteger(this.worldKey)) {
        const r3 = (v) => Math.round(v * 1000) / 1000;
        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO murals (world, px, py, pz, nx, nz, wall_w, wall_h, style, thought, svg, user_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
        ).bind(this.worldKey, r3(wall.px), r3(wall.py), r3(wall.pz), r3(wall.nx), r3(wall.nz),
               r3(wall.wallW), r3(wall.wallH), style, thought ?? null, svg, 'kay-server').run();
      }

      this.sim.paintDone({ svg, thought });
      console.log(`[KayDO] painted wall ${wall.id} · ${style} · mural #${index} · world ${this.worldKey}${this._isDemo() ? ' · demo' : ''}`);
      // Broadcast in the SAME shape the client's mural-apply expects (mirrors a
      // /murals row): the browser matches it to the wall slot by anchor.
      this._broadcast({
        type: 'mural',
        px: wall.px, py: wall.py, pz: wall.pz, nx: wall.nx, nz: wall.nz,
        wall_w: wall.wallW, wall_h: wall.wallH,
        style, thought: thought ?? null, svg, user_id: 'kay-server',
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

// ---- Server-side mural prompt (ported from js/mural-factory.js) -------------
function aspectDesc(wall) {
  const r = wall.wallH / wall.wallW;
  if (r > 1.3)   return 'tall portrait';
  if (1 / r > 1.3) return 'wide landscape';
  return 'roughly square';
}

function buildMuralPrompt(wall, index) {
  const PW = 512;
  const PH = Math.round(512 * (wall.wallH / wall.wallW));
  const text =
`You are KAI, a teenage street artist wandering a grey Japanese neighbourhood.
You paint vivid murals on concrete walls — bursts of colour in a monochrome world.
Your painting style is expressive and hand-drawn, never rigid or geometric.

This is mural #${index}. Use (${index} % 8) to choose your style:

STYLE 0 — UKIYO-E
Flowing organic waves, mountains, wind. Flat colour washes in navy·vermillion·gold.
Use <path d="M...C...C...Z"> with smooth bezier curves for every major shape.

STYLE 1 — SUMI-E
Ink-wash meditation. Sweeping brushstroke paths, varying stroke-width (1–18px),
monochrome grey-black washes with one vivid accent colour bleeding through.
Heavy use of <path> with stroke-linecap="round" and opacity layers.

STYLE 2 — MANGA
Dynamic energy. Speed-line paths radiating from a focal point.
High contrast: near-black ground with electric colour pop (one hue).
Use <path> for motion blur lines, <circle>/<ellipse> for focal elements.

STYLE 3 — WOODBLOCK
Hand-printed feel. Bold organic outlines (stroke-width 3–6) on flat colour fields.
Earth tones: indigo·rust·tan·charcoal. Paths with slightly imperfect curves.

STYLE 4 — ANIME
Cel-shaded scene. Hard contour <path> strokes outlining coloured areas.
Primary palette — red, yellow, blue, white, black — no gradients in fills,
but dramatic gradient sky/background behind the composition.

STYLE 5 — KIRIE (paper cut)
Intricate silhouette work cut from a single vivid colour field.
Organic paper-cut <path> shapes: leaves, waves, birds, branches —
delicate negative space. One accent colour + stark black/white.

STYLE 6 — WABI-SABI
Imperfect beauty. Asymmetric brushed shapes, aged textures.
Overlapping semi-transparent washes in ochre·moss·ash·umber.
Let shapes be irregular, "unfinished", with visible layering.

STYLE 7 — KANJI-ART
Abstract calligraphic forms — not letters, but shapes inspired by brushed kanji.
Thick-to-thin <path> strokes (stroke-width varies 1px to 30px along path),
deep ink gradients, bold sweep gestures across the full canvas.

The wall is ${wall.wallW.toFixed(1)}m wide × ${wall.wallH.toFixed(1)}m tall (${aspectDesc(wall)}).

Return your response in EXACTLY this format and nothing else:
THOUGHT: <one sentence, 7-12 words, KAI's raw poetic inner monologue; no quotes, no trailing punctuation, do not start with "I">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">...</svg>

SVG RULES — follow exactly:
TECHNIQUE: Use <path d="..."> with Bezier curve commands (C, Q, S, A) as your PRIMARY drawing tool.
           Avoid using <rect> and <polygon> as main design elements — they produce flat, geometric results.
           Create organic, painted-looking forms with curved paths and expressive strokes.
ALLOWED elements: path circle ellipse line polyline defs linearGradient radialGradient stop g
FORBIDDEN: rect polygon text image use symbol script foreignObject and any href/xlink/url() references
BACKGROUND: first element must be a <rect> or large <path> covering the full viewBox as background only
GRADIENTS: at least 2 gradient definitions in <defs> — use them for depth and painterly washes
COLOUR: at least 5 distinct colours; fill the entire canvas — no bare white areas
STROKES: use stroke attributes on <path> to simulate ink lines and brushwork
LIMIT: maximum 40 elements (not counting <defs> children)
OUTPUT: ONLY the THOUGHT line then the raw SVG. No markdown, no code fences, no comments.`;
  return { PW, PH, text };
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
