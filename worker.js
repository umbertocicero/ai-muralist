// AI Muralist — Cloudflare Worker API proxy
// Hides the Anthropic API key, adds CORS, validates input and rate-limits per IP.
// Deploy: wrangler deploy   ·   Secret: wrangler secret put ANTHROPIC_API_KEY

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT_MS = 8_000; // max 1 request / 8s per IP

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: { type: 'invalid_request_error', message: 'Method not allowed' } }, 405);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: { type: 'config_error', message: 'Server missing ANTHROPIC_API_KEY' } }, 500);
    }

    // Rate limiting via KV (optional — skipped if binding not configured)
    const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.RATE_LIMIT_KV) {
      const last = await env.RATE_LIMIT_KV.get(`rl:${clientIP}`);
      if (last && Date.now() - parseInt(last, 10) < RATE_LIMIT_MS) {
        return json({ error: { type: 'rate_limit_error', message: 'Too many requests. Wait a moment.' } }, 429);
      }
      await env.RATE_LIMIT_KV.put(`rl:${clientIP}`, String(Date.now()), { expirationTtl: 60 });
    }

    // Parse + validate body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }
    if (!body.model || !body.messages || !body.max_tokens) {
      return json({ error: { type: 'invalid_request_error', message: 'Missing required fields: model, messages, max_tokens' } }, 400);
    }

    // Proxy to Anthropic — propagate upstream status so the client can react.
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
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
