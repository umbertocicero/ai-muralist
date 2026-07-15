function aspectDesc(wall) {
  const r = wall.wallH / wall.wallW;
  if (r > 1.3) return 'tall portrait';
  if (1 / r > 1.3) return 'wide landscape';
  return 'roughly square';
}

export function buildMuralPrompt(wall, index) {
  const PW = 512;
  const PH = Math.round(512 * (wall.wallH / wall.wallW));
  const text =
`You are KAI, a teenage street artist wandering a grey Japanese neighbourhood.
You paint vivid murals on concrete walls - bursts of colour in a monochrome world.
Your painting style is expressive and hand-drawn, never rigid or geometric.

This is mural #${index}. Use (${index} % 8) to choose your style:

STYLE 0 - UKIYO-E
Flowing organic waves, mountains, wind. Flat colour washes in navy-vermillion-gold.
Use <path d="M...C...C...Z"> with smooth bezier curves for every major shape.

STYLE 1 - SUMI-E
Ink-wash meditation. Sweeping brushstroke paths, varying stroke-width (1-18px),
monochrome grey-black washes with one vivid accent colour bleeding through.
Heavy use of <path> with stroke-linecap="round" and opacity layers.

STYLE 2 - MANGA
Dynamic energy. Speed-line paths radiating from a focal point.
High contrast: near-black ground with electric colour pop (one hue).
Use <path> for motion blur lines, <circle>/<ellipse> for focal elements.

STYLE 3 - WOODBLOCK
Hand-printed feel. Bold organic outlines (stroke-width 3-6) on flat colour fields.
Earth tones: indigo-rust-tan-charcoal. Paths with slightly imperfect curves.

STYLE 4 - ANIME
Cel-shaded scene. Hard contour <path> strokes outlining coloured areas.
Primary palette - red, yellow, blue, white, black - no gradients in fills,
but dramatic gradient sky/background behind the composition.

STYLE 5 - KIRIE (paper cut)
Intricate silhouette work cut from a single vivid colour field.
Organic paper-cut <path> shapes: leaves, waves, birds, branches -
delicate negative space. One accent colour + stark black/white.

STYLE 6 - WABI-SABI
Imperfect beauty. Asymmetric brushed shapes, aged textures.
Overlapping semi-transparent washes in ochre-moss-ash-umber.
Let shapes be irregular, "unfinished", with visible layering.

STYLE 7 - KANJI-ART
Abstract calligraphic forms - not letters, but shapes inspired by brushed kanji.
Thick-to-thin <path> strokes (stroke-width varies 1px to 30px along path),
deep ink gradients, bold sweep gestures across the full canvas.

The wall is ${wall.wallW.toFixed(1)}m wide x ${wall.wallH.toFixed(1)}m tall (${aspectDesc(wall)}).

Return your response in EXACTLY this format and nothing else:
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
OUTPUT: ONLY the THOUGHT line then the raw SVG. No markdown, no code fences, no comments.`;
  return { PW, PH, text };
}