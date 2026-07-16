// The mural prompt — shared by the Worker Durable Object (server-side Kay) and
// the browser MuralFactory (offline/local fallback), so both paint the same way.
//
// NO fixed style list. The FIRST mural of a world starts from a generic, open
// prompt: KAI invents his own visual language. Every LATER mural is CONDITIONED
// by the one painted before it — the previous piece's style name, thought and
// raw SVG source are embedded in the prompt, and KAI is asked to respond to it:
// evolve a motif, push the palette, answer the gesture. The city becomes one
// continuous visual conversation instead of eight looping presets.
//
// `prev` = { style, thought, svg } of the mural painted before (null → first).
// The caller supplies it: the Worker reads the latest D1 row of this world (so
// the chain resets naturally when the murals table is wiped), the local factory
// remembers its last result for the session.

function aspectDesc(wall) {
  const r = wall.wallH / wall.wallW;
  if (r > 1.3) return 'tall portrait';
  if (1 / r > 1.3) return 'wide landscape';
  return 'roughly square';
}

// Keep the embedded previous SVG small enough that the whole prompt stays well
// under the 12 KB the murals table stores (and token cost stays sane). Murals
// average 2-3 KB; a rare huge one gets its tail cut — the opening defs/paths
// carry the palette and gesture, which is what the conditioning needs.
const PREV_SVG_MAX = 3500;

export function buildMuralPrompt(wall, index, prev = null) {
  const PW = 512;
  const PH = Math.round(512 * (wall.wallH / wall.wallW));

  const intro =
`You are KAI, a teenage street artist wandering a grey Japanese neighbourhood.
You paint vivid murals on concrete walls - bursts of colour in a monochrome world.
Your painting style is expressive and hand-drawn, never rigid or geometric.`;

  let brief;
  if (prev && typeof prev.svg === 'string' && prev.svg) {
    // A raster previous piece (data-url image, e.g. painted by gpt-image) has no
    // SVG source worth embedding — base64 noise teaches the model nothing. Its
    // style name + thought still carry the conversation.
    const isRaster = prev.svg.startsWith('data:');
    const svgSrc = isRaster ? null
      : prev.svg.length > PREV_SVG_MAX
        ? prev.svg.slice(0, PREV_SVG_MAX) + '... (truncated)'
        : prev.svg;
    brief =
`This is mural #${index}. It must be CONDITIONED by the piece you painted just
before it${svgSrc ? ', shown below' : ', described below'}. Study it - its palette, its gestures, its mood - and let
this new piece RESPOND to it: evolve a motif, push the palette somewhere new,
answer its gesture with a counter-gesture. A visible thread must connect the two,
yet this one must be clearly its own work - never a copy, never a repetition of
the same composition. If you feel the conversation has run its course, break from
it deliberately and start a new visual sentence.

YOUR PREVIOUS MURAL${prev.style ? ` (you called its style "${prev.style}")` : ''}:
${prev.thought ? `Its thought was: "${prev.thought}"\n` : ''}${svgSrc ? `Its SVG source:\n${svgSrc}` : 'It was a painted raster piece (no source available).'}`;
  } else {
    brief =
`This is mural #${index}, the first wall of a fresh conversation with this city.
There is no house style and no preset list: INVENT the visual language of this
piece yourself - any tradition, any palette, any energy, as long as it is
expressive, hand-drawn in spirit, and alive. Name the style you invent.`;
  }

  const text =
`${intro}

${brief}

The wall is ${wall.wallW.toFixed(1)}m wide x ${wall.wallH.toFixed(1)}m tall (${aspectDesc(wall)}).

Return your response in EXACTLY this format and nothing else:
STYLE: <the name you give this piece's style, 1-3 words>
THOUGHT: <one sentence, 7-12 words, KAI's raw poetic inner monologue; no quotes, no trailing punctuation, do not start with "I">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">...</svg>

SVG RULES - follow exactly:
TECHNIQUE: Use <path d="..."> with Bezier curve commands (C, Q, S, A) as your PRIMARY drawing tool.
           Avoid using <rect> and <polygon> as main design elements - they produce flat, geometric results.
           Create organic, painted-looking forms with curved paths and expressive strokes.
ALLOWED elements: path circle ellipse line polyline defs linearGradient radialGradient stop g
FORBIDDEN: rect polygon text image use symbol script foreignObject and any href/xlink/url() references
BACKGROUND: first element must be a <rect> or large <path> covering the full viewBox as background only
GRADIENTS: at least 2 gradient definitions in <defs> - use them for depth and painterly washes
COLOUR: at least 5 distinct colours; fill the entire canvas - no bare white areas
STROKES: use stroke attributes on <path> to simulate ink lines and brushwork
LIMIT: maximum 40 elements (not counting <defs> children)
OUTPUT: ONLY the STYLE line, the THOUGHT line, then the raw SVG. No markdown, no code fences, no comments.`;
  return { PW, PH, text };
}

// Pull the self-named STYLE off a model response (shared by both parsers).
// Bounded to the murals table's 40-char style column; 'Freestyle' when absent.
export function parseStyle(raw) {
  if (typeof raw !== 'string') return 'Freestyle';
  const m = raw.match(/STYLE:\s*(.+)/i);
  const s = m ? m[1].split('\n')[0].trim().replace(/^["']|["']$/g, '') : '';
  return (s || 'Freestyle').slice(0, 40);
}

// ── Image-model variant (OpenAI gpt-image-1-mini) ───────────────────────────
// Same artist, same conversation, different medium: a raster model returns a
// finished picture, not SVG — so no SVG rules, and the conditioning is TEXTUAL
// (the previous piece's style name + thought; raster models can't read SVG
// source, and a previous raster piece has no source to read anyway).

// The generation size closest to the wall's aspect (the only sizes the model
// offers) — the texture is stretched onto the wall, so the nearer the aspect,
// the less distortion.
export function pickImageSize(wall) {
  const r = wall.wallH / wall.wallW;
  if (r > 1.3)     return '1024x1536';   // tall portrait
  if (1 / r > 1.3) return '1536x1024';   // wide landscape
  return '1024x1024';
}

export function buildImageMuralPrompt(wall, index, prev = null) {
  const cond = prev
    ? `It is the next piece in one continuous visual conversation: the mural painted just before it${
        prev.style ? ` was in a style he called "${prev.style}"` : ''}${
        prev.thought ? ` and carried the thought "${prev.thought}"` : ''}. This new piece must visibly RESPOND to that one — evolve a motif, push the palette somewhere new, answer its gesture — while being clearly its own work, never a copy.`
    : `It is the first piece of a fresh conversation with this city: invent its visual language freely — any tradition, any palette, any energy.`;
  return (
`A vivid hand-painted street-art mural filling an entire concrete wall in a grey Japanese neighbourhood, painted by KAI, a teenage street artist — a burst of colour in a monochrome world. Expressive and hand-drawn in spirit, never rigid or geometric. ${cond} The artwork fills the whole canvas edge to edge (the wall is ${wall.wallW.toFixed(1)}m x ${wall.wallH.toFixed(1)}m). Flat frontal view of the painted surface only — no wall edges, no street, no people, no photograph framing. No text, no letters, no words, no signature, no watermark.`);
}
