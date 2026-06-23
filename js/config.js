export const CONFIG = {
  // --- API ---
  workerUrl: null,
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
  requestTimeoutMs: 30000,
  maxSvgBytes: 60000,

  // --- World (Japanese neighborhood — overcast B&W palette) ---
  sky: '#d4d0cc',
  fog: { color: '#bebab6', near: 55, far: 145 },
  buildingColors: ['#ccc8c2', '#c4c0ba', '#d0ccc6', '#bab6b0', '#dad6d0'],
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
  camFov: 55,
  camRadius: 26,
  camPolar: 1.0,
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
