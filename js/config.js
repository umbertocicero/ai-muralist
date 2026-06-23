export const CONFIG = {
  // --- API ---
  workerUrl: null,
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
  requestTimeoutMs: 30000,
  maxSvgBytes: 60000,

  // --- World (Japanese neighbourhood GRID — B&W manga / inked line-art) ---
  // Soft paper-grey sky (NOT pure white): gives the additive sun-glow and
  // light-shafts a surface to register against, and lets distance haze read.
  sky: '#e7e5e0',
  fog: { color: '#edebe6', near: 44, far: 150 },

  // A grid of low apartment blocks separated by narrow lanes (= the traverse
  // cross-streets). Wider world than the single alley.
  // Procedural Setagaya-style town: organic, crooked streets of varying width,
  // irregular plots, a couple of winding main roads, some open lots. `half` is
  // the world half-extent (bigger world).
  world: { half: 60 },

  // The town is "in" Setagaya, Tokyo: the sun tracks the real solar position
  // for this location and the current time, so it's day or night in sync with
  // real Japan time.
  location: { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo', name: 'Setagaya, Tokyo' },

  // --- Sun / atmosphere (manga backlight: low sun, blown-out haze, god-rays) ---
  sun: { x: 34, y: 22, z: -78 },
  atmo: {
    glowSize:   58,    // diameter of the blown highlight at the sun
    shaftCount: 12,    // number of radiating light-shafts
    shaftLen:   170,   // shaft length (world units)
    shaftWidth: 9,     // shaft base width
    shaftOpacity: 0.28, // base beam opacity (jittered per beam)
    dustCount:  360,   // floating motes
    dustRange:  130,   // box the motes drift within
    dustSize:   0.15,
  },
  // Concrete-grey facade palette (apartment blocks).
  buildingColors: ['#eceae6', '#e4e2dd', '#dddbd6', '#f0eeea', '#d9d7d2'],

  // --- Agent / physics ---
  charStart: { x: 0, z: 0 },  // relocated to city.spawn at startup if blocked
  charRadius: 0.4,
  moveSpeed: 3.2,
  approachOffset: 1.5,
  wanderMin: 3.5,
  wanderRange: 4.0,
  thinkSeconds: 2.0,
  paintSeconds: 2.2,
  muralCoverW: 0.88,
  muralCoverH: 0.85,

  // --- Camera (Apple-style: damped orbit with inertia, smooth zoom-to-cursor,
  //     two-finger / shift-drag pan). Open-world free orbit. ---
  camFov: 52,
  camRadius: 32,
  camPolar: 1.12,
  camPolarMin: 0.32,
  camPolarMax: 1.52,
  camRadiusMin: 7,
  camRadiusMax: 120,
  camAzimuth: Math.PI * 0.25,   // pleasant 3/4 view to start
  camLookY: 2.4,                // height the camera aims at

  camDragSensitivity: 0.005,    // rad per pixel of drag
  camInertiaTau: 0.13,          // orbit momentum decay time-constant (s)
  camZoomStep: 0.0016,          // wheel delta → fractional radius change
  camZoomLerp: 13,              // radius easing rate (higher = snappier)
  camZoomToCursor: 0.55,        // 0..1 how much zoom pulls focus to the cursor
  camPanSpeed: 1.0,             // pan gain (scaled by distance)
  camFollowLerp: 3.2,           // pivot follow easing rate (per second)
  camAutoSpin: 0.015,           // tiny idle drift while following (rad/s)

  // --- UI ---
  maxLogEntries: 5,
  styleNames: ['Ukiyo-e','Sumi-e','Manga','Woodblock','Anime','Kirie','Wabi-sabi','Kanji'],
};

export const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(/i;
