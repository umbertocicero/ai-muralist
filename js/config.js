export const CONFIG = {
  // --- API ---
  workerUrl: null,
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
  requestTimeoutMs: 30000,
  maxSvgBytes: 60000,

  // --- World (narrow Japanese alley — B&W manga / inked line-art) ---
  // Soft paper-grey sky (NOT pure white): gives the additive sun-glow and
  // light-shafts a surface to register against, and lets distance haze read.
  sky: '#e7e5e0',
  fog: { color: '#edebe6', near: 30, far: 96 },

  // --- Sun / atmosphere (manga backlight down the alley) ---
  // Sun sits low, centred over the FAR end of the lane → the bright white-out
  // at the vanishing point, long shadows thrown toward the viewer, and god-rays
  // pouring straight down the corridor, exactly like the reference photos.
  sun: { x: 9, y: 15, z: -84 },
  atmo: {
    glowSize:   46,    // diameter of the blown highlight at the sun
    shaftCount: 12,    // number of radiating light-shafts
    shaftLen:   150,   // shaft length (world units)
    shaftWidth: 8,     // shaft base width
    shaftOpacity: 0.30, // base beam opacity (jittered per beam)
    dustCount:  340,   // floating motes
    dustRange:  44,    // box the motes drift within (kept to the alley width)
    dustSize:   0.14,
  },
  // Concrete-grey facade palette (apartment blocks).
  buildingColors: ['#eceae6', '#e4e2dd', '#dddbd6', '#f0eeea', '#d9d7d2'],

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

  // --- Character / camera start (near, open end of the lane) ---
  charStart: { x: 0, z: 24 },

  // --- Camera ---
  // Locked to look DOWN the alley toward the bright end. Azimuth is clamped to
  // a narrow arc (± range) and gently sways, so the framing stays a one-point
  // perspective corridor instead of orbiting outside the walls.
  camFov: 52,
  camRadius: 17,
  camPolar: 1.3,
  camPolarMin: 0.55,
  camPolarMax: 1.46,
  camRadiusMin: 6,
  camRadiusMax: 34,
  camAzimuth: Math.PI / 2,   // looking toward −z (down the lane)
  camAzimuthRange: 0.6,      // how far the view may swing each way
  camOrbitSpeed: 0.05,
  camFollowLerp: 0.05,
  camDragSensitivity: 0.006,

  // --- UI ---
  maxLogEntries: 5,
  styleNames: ['Ukiyo-e','Sumi-e','Manga','Woodblock','Anime','Kirie','Wabi-sabi','Kanji'],
};

export const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(/i;
