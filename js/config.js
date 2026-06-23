export const CONFIG = {
  // --- API ---
  workerUrl: null,
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
  requestTimeoutMs: 30000,
  maxSvgBytes: 60000,

  // --- World (Japanese neighborhood — B&W manga / inked line-art) ---
  // Paper-white sky; buildings near-white so cel shading + ink outlines read
  // as a hand-drawn panel. Murals are the only colour in the scene.
  // Soft paper-grey sky (NOT pure white): gives the additive sun-glow and
  // light-shafts a surface to register against, and lets distance haze read.
  sky: '#e7e5e0',
  fog: { color: '#edebe6', near: 36, far: 112 },

  // --- Sun / atmosphere (manga backlight: low sun, blown-out haze, god-rays) ---
  // Sun sits low over the far end of an avenue → long dramatic shadows and a
  // white-out glow at the vanishing point, like the reference alleys.
  sun: { x: 26, y: 18, z: -66 },
  atmo: {
    glowSize:   50,    // diameter of the blown highlight at the sun
    shaftCount: 12,    // number of radiating light-shafts
    shaftLen:   140,   // shaft length (world units)
    shaftWidth: 8,     // shaft base width
    shaftOpacity: 0.28, // base beam opacity (jittered per beam)
    dustCount:  320,   // floating motes
    dustRange:  90,    // box the motes drift within
    dustSize:   0.15,
  },
  buildingColors: ['#ffffff', '#f3f1ed', '#ebe9e5', '#f7f5f1', '#eeece8'],
  buildingPositions: [
    [-12,-12],[12,-12],[-12,12],[12,12],
    [-30,-12],[-30,12],[30,-12],[30,12],
    [-12,-30],[12,-30],[-12,30],[12,30],
    [-30,-30],[30,-30],[-30,30],[30,30],
  ],

  // --- Agent / physics ---
  charRadius: 0.4,
  moveSpeed: 3.2,
  approachOffset: 1.5,
  wanderMin: 3.5,
  wanderRange: 4.0,
  thinkSeconds: 2.0,
  paintSeconds: 2.2,
  muralCoverW: 0.88,
  muralCoverH: 0.85,

  // --- Camera ---
  camFov: 50,
  camRadius: 24,
  camPolar: 1.16,
  camPolarMin: 0.18,
  camPolarMax: 1.38,
  camRadiusMin: 8,
  camRadiusMax: 80,
  camOrbitSpeed: 0.06,
  camFollowLerp: 0.04,
  camDragSensitivity: 0.006,

  // --- UI ---
  maxLogEntries: 5,
  styleNames: ['Ukiyo-e','Sumi-e','Manga','Woodblock','Anime','Kirie','Wabi-sabi','Kanji'],
};

export const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(/i;
