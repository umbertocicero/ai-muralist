export const CONFIG = {
  // --- API ---
  // Worker proxy URL. Set to your workers.dev URL or '/api/claude' for Pages Functions.
  // Leave null to run in OFFLINE DEMO mode (no API key needed).
  workerUrl: null,
  model: 'claude-sonnet-4-6',
  maxTokens: 2048,
  requestTimeoutMs: 30000,
  maxSvgBytes: 60000,

  // --- World ---
  sky: '#87CEEB',
  fog: { color: '#aacbe0', near: 65, far: 170 },
  buildingColors: ['#7a7060', '#6e6658', '#6a7474', '#746e62'],
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
  camPolar: 1.0,        // starting angle from vertical (radians)
  camPolarMin: 0.18,
  camPolarMax: 1.38,
  camRadiusMin: 8,
  camRadiusMax: 80,
  camOrbitSpeed: 0.08,  // rad/s auto-orbit while following
  camFollowLerp: 0.04,
  camDragSensitivity: 0.006,

  // --- UI ---
  maxLogEntries: 5,
  styleNames: ['Bauhaus','Organic','Pixel','Op-Art','Surreal','Graffiti','Cosmos','Botanical'],
};

export const SVG_FORBIDDEN =
  /<\s*(script|foreignObject|image|use|symbol|iframe)\b|xlink:href|(?<![a-z])href\s*=|url\s*\(/i;
