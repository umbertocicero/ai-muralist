// AI Muralist — Cloudflare Worker API proxy + mural persistence
// Hides the Anthropic API key, adds CORS, validates/normalizes input and
// rate-limits per IP. With a D1 binding (DB) it also stores every painted
// mural at GET/POST <worker>/murals, so the world survives a refresh.
// Deploy: `wrangler deploy` · Secret: `wrangler secret put ANTHROPIC_API_KEY`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-user-api-key',
};

const RATE_LIMIT_MS = 8_000;      // max 1 request / 8s per IP
const MAX_BODY_BYTES = 16_000;    // reject oversized payloads early
const MAX_TOKENS_CAP = 4_096;     // clamp to bound per-request cost
const ALLOWED_MODELS = new Set([  // only models this app is meant to call
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-8',
]);

// ---- Mural persistence (D1) ------------------------------------------------
const MURAL_MAX_BODY = 80_000;    // svg (≤60 KB) + metadata
const MURAL_RATE_MS  = 3_000;     // max 1 save / 3s per IP (a paint takes ≥8s anyway)
const MURAL_LIST_CAP = 500;       // rows returned per world
// Server-side copy of the client's SVG_FORBIDDEN guard (js/config.js).
const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(/i;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (new URL(request.url).pathname.endsWith('/murals')) {
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
    return json({ murals: results ?? [] });
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
  // svg re-checked server-side with the same guard the client uses.
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const { world, px, py, pz, nx, nz, wallW, wallH, style, thought, svg, userId } = body ?? {};
  const ok =
    Number.isInteger(world) &&
    num(px, -200, 200) && num(py, 0, 50) && num(pz, -200, 200) &&
    num(nx, -1.01, 1.01) && num(nz, -1.01, 1.01) &&
    num(wallW, 0.5, 30) && num(wallH, 0.5, 30) &&
    typeof style === 'string' && style.length <= 40 &&
    (thought == null || (typeof thought === 'string' && thought.length <= 300)) &&
    typeof svg === 'string' && svg.length <= 60_000 &&
    svg.trimStart().startsWith('<svg') && !SVG_FORBIDDEN.test(svg) &&
    typeof userId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(userId);
  if (!ok) {
    return json({ error: { type: 'invalid_request_error', message: 'Invalid mural record' } }, 400);
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
