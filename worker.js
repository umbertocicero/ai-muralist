// AI Muralist — Cloudflare Worker API proxy
// Hides the Anthropic API key, adds CORS, validates/normalizes input and
// rate-limits per IP. Deploy: `wrangler deploy` · Secret: `wrangler secret put ANTHROPIC_API_KEY`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT_MS = 8_000;      // max 1 request / 8s per IP
const MAX_BODY_BYTES = 16_000;    // reject oversized payloads early
const MAX_TOKENS_CAP = 4_096;     // clamp to bound per-request cost
const ALLOWED_MODELS = new Set([  // only models this app is meant to call
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-8',
]);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json({ error: { type: 'invalid_request_error', message: 'Method not allowed' } }, 405);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: { type: 'config_error', message: 'Server missing ANTHROPIC_API_KEY' } }, 500);
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
          'x-api-key': env.ANTHROPIC_API_KEY,
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
