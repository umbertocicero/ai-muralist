// ===========================================================================
//  Settings — three layers, later wins:
//
//    1. CONFIG defaults        (js/config.js — code)
//    2. config.yaml            (repo root — the SITE OWNER's no-code switches)
//    3. localStorage           (the VISITOR's own Settings panel: mode, api
//                               key, model, save toggle — never leaves the browser)
//
//  The resolved settings are written back onto CONFIG before the app boots:
//  CONFIG.workerUrl / CONFIG.model as before, plus CONFIG.mode ('demo'|'ai'),
//  CONFIG.userApiKey (visitor's own Anthropic key, optional) and
//  CONFIG.saveMurals (persist to D1 or not).
// ===========================================================================

const LS_KEY = 'muralist_settings';

// Tiny YAML subset parser — flat `key: value` lines, # comments, booleans and
// bare strings. Plenty for a hand-edited flags file; no dependency needed.
export function parseYaml(text) {
  const out = {};
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (val === '') continue;
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (val !== '' && !isNaN(Number(val))) val = Number(val);
    out[key] = val;
  }
  return out;
}

async function loadSiteConfig() {
  try {
    const res = await fetch('config.yaml', { cache: 'no-cache' });
    if (!res.ok) return {};
    return parseYaml(await res.text());
  } catch { return {}; }
}

export function loadUserSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'); }
  catch { return {}; }
}

export function saveUserSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

// Merge the three layers onto CONFIG (mutates it) and return the effective
// settings. Call once at boot, before the app is constructed.
export async function applySettings(CONFIG) {
  const site = await loadSiteConfig();
  const user = loadUserSettings();

  const workerUrl = user.workerUrl ?? site.worker_url ?? CONFIG.workerUrl;
  const apiKey    = user.apiKey    ?? null;                       // visitor-only, never in yaml
  const model     = user.model     ?? site.model ?? CONFIG.model;
  // mode: explicit wins; otherwise 'ai' when something can generate, else demo
  const mode      = user.mode ?? site.mode ?? ((workerUrl || apiKey) ? 'ai' : 'demo');
  // save flag: visitor toggle > site yaml > default ON (needs a worker to land)
  const saveMurals = (user.saveMurals ?? site.save_murals ?? true) !== false;

  CONFIG.workerUrl  = workerUrl || null;
  CONFIG.model      = model;
  CONFIG.mode       = mode;
  CONFIG.userApiKey = apiKey;
  CONFIG.saveMurals = saveMurals;
  return { workerUrl: CONFIG.workerUrl, apiKey, model, mode, saveMurals };
}
