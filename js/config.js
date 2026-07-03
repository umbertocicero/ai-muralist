export const CONFIG = {
  // --- API ---
//  workerUrl: 'https://ai-muralist-proxy.ucicero.workers.dev',
  workerUrl: null,
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
  requestTimeoutMs: 30000,
  maxSvgBytes: 60000,

  // The city generator's seed — ALSO the persistence "world" key: saved murals
  // are stored under this number and re-attached to the identical town it
  // generates. Changing it starts a fresh town with a fresh (empty) mural set.
  worldSeed: 20260623,

  // --- World (Japanese neighbourhood GRID — B&W manga / inked line-art) ---
  // Soft paper-grey sky (NOT pure white): gives the additive sun-glow and
  // light-shafts a surface to register against, and lets distance haze read.
  sky: '#f8f6f2',
  fog: { color: '#f6f4f0', near: 110, far: 340 },

  // Overhead power-line density (see city.js _buildPolesAndWires)
  wires: {
    neighbors:    2,          // connect each pole to N nearest (was 3)
    maxSpan:      14,         // max pole-to-pole distance
    heights:      [7.8],      // single cable run (was two stacked)
    poleScatter:  28,         // random poles on open lots (was 60)
    roadStep:     0.58,       // spacing along main roads
    shopStep:     0.46,       // spacing on shopping street
  },

  // A grid of low apartment blocks separated by narrow lanes (= the traverse
  // cross-streets). Wider world than the single alley.
  // Procedural Setagaya-style town: organic, crooked streets of varying width,
  // irregular plots, a couple of winding main roads, some open lots. `half` is
  // the world half-extent (bigger world).
  world: { half: 60 },

  // The town is wrapped onto a small navigable planet (Petit Prince style): the
  // flat city becomes a cap on a sphere of this radius that you orbit like
  // Google Earth. Smaller radius = more curvature; this fits the ~120-wide town
  // over the top hemisphere and a little down the sides.
  planet: { radius: 44 },

  // The town is "in" Setagaya, Tokyo: the sun tracks the real solar position
  // for this location and the current time, so it's day or night in sync with
  // real Japan time.
  location: { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo', name: 'Setagaya, Tokyo' },

  // --- Sun / atmosphere (manga backlight: low sun, blown-out haze, god-rays) ---
  sun: { x: 34, y: 22, z: -78 },
  atmo: {
    glowSize:   22,             // BIGGER sun glow (was 18)
    shaftCount: 6,              // MORE light shafts (was 3)
    shaftLen:   120,            // LONGER rays (was 90)
    shaftWidth: 7,              // WIDER beams (was 5)
    shaftOpacity: 0.12,         // STRONGER god-rays (was 0.06)
  },
  // Near-white facades: colour comes from cel shadow + ink outline, not grey paint.
  buildingColors: ['#f5f3ef', '#f0eeea', '#eceae6', '#faf8f4', '#e8e6e2'],

  // ── Manga look — ULTRA ENHANCED: ombre drammatiche, contrasto estremo ─
  visual: {
    celShade: [16, 96, 255],    // OMBRE NERE più forti per un look manga estremo
    toneScale:      6.0,        // tratto FITTO e FINE (linee sottili e ravvicinate)
    hatchCut:       0.50,       // hatching inizia ancora prima
    crossHatchAt:   0.64,       // cross-hatch nelle ombre profonde
    hatchStrength:  0.92,       // hatching più intensa e più nera
    skipHorizHatch: false,      // hatch EVERYWHERE for true manga feel
    edgeStrength:   0.95,       // SOBEL MASSIMO (era 0.85)
    edgeThreshold:  [0.10, 0.28],  // edge detection ULTRA sensibile
    grain:          0.032,      // TEXTURE CARTA MASSIMA (era 0.024)
    vignetteDark:   0.75,       // VIGNETTE MOLTO PIÙ SCURA (era 0.82)
    inkWeight:      0.65,       // LINEE PIÙ SOTTILI (era 0.95)
    inkDefault:     1.022,      // INK EXPANSIONE MASSIMA (era 1.018)
    keyLight:       2.8,        // HIGHLIGHTS BRILLANTISSIMI (era 2.45)
    ambientLight:   0.18,       // OMBRE ancora più dense e inchiostrate
  },

  // --- Commercial shopping street (商店街) ---
  // One of the winding main roads is dressed as a shōtengai: taller, narrower
  // mixed-use blocks line both sides, with ground-floor shopfronts (awning +
  // storefront glass + projecting sign) and rooftop signboards. Recreates the
  // dense "hero shot" Japanese high-street look of the reference photos.
  shop: {
    enabled: true,
    band: 7.5,         // plots within this distance of the chosen road become shops
    minTop: 7.0,       // shop blocks are taller…
    topRange: 5.0,     // …minTop + rand*topRange
    awningTones: ['#cfccc4', '#c4c1b9', '#d6d3cb'],  // greyscale (stays B&W)
    roofSignChance: 0.55,   // chance a shop block carries a rooftop billboard
    nightGlow: true,        // shop signs / vending machines register a night-glow lamp
    // Street-prop caps for the new reference dressing
    vendingMax: 8,
    mirrorMax:  4,
    coneMax:    10,
    carMax:     5,
    scooterMax: 5,
    crateMax:   6,
    trashMax:   5,
  },

  // --- Agent / physics ---
  charStart: { x: 0, z: 0 },  // relocated to city.spawn at startup if blocked
  charRadius: 0.4,
  moveSpeed: 3.2,
  approachOffset: 1.5,
  wanderMin: 3.5,
  wanderRange: 4.0,
  thinkSeconds: 2.0,
  paintSeconds: 2.2,
  admireSeconds: 3.0,  // KAI + camera pause to admire the finished mural
  reachTimeout: 9.0,   // give up on a wall KAI can't reach (then it's released)
  muralCoverW: 0.88,
  muralCoverH: 0.85,
  muralOpacity: 0.93,   // mostly opaque so a near-black shaded wall barely bleeds through (murals stay readable); still a faint hint of the door/window beneath

  // --- Camera (Apple-style: damped orbit with inertia, smooth zoom-to-cursor,
  //     two-finger / shift-drag pan). Open-world free orbit. ---
  camFov: 48,
  camRadius: 22,
  camPolar: 0.58,   // street-level 3/4 — less bird's-eye chaos
  camPolarMin: 0.28,
  camPolarMax: 1.35,
  camRadiusMin: 6,
  camRadiusMax: 160,
  camAzimuth: Math.PI * 0.22,
  camLookY: 1.55,   // eye-level on KAI, not rooftops

  camDragSensitivity: 0.005,    // rad per pixel of drag
  camInertiaTau: 0.13,          // orbit momentum decay time-constant (s)
  camZoomStep: 0.0016,          // wheel delta → fractional radius change
  camZoomLerp: 13,              // radius easing rate (higher = snappier)
  camZoomToCursor: 0.55,        // 0..1 how much zoom pulls focus to the cursor
  camPanSpeed: 1.0,             // pan gain (scaled by distance)
  camFollowLerp: 3.2,           // pivot follow easing rate (per second)
  camFollowSpin: 2.2,           // how fast the follow-cam swings behind KAI

  // --- UI ---
  maxLogEntries: 5,
  styleNames: ['Ukiyo-e','Sumi-e','Manga','Woodblock','Anime','Kirie','Wabi-sabi','Kanji'],
};

// url(#…) fragment references are ALLOWED — they're how fills point at the
// <defs> gradients the murals are built on (demo and AI alike). Only external
// url(...) targets (http:, data:, //…) stay forbidden.
export const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(\s*(?!#)/i;
