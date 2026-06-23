export const DEMO_THOUGHTS = [
  'power lines trace the sky the way rivers trace the land',
  'this concrete wall has memorized every face that passed',
  'morning mist sits on the rooftops like a patient thought',
  'the city grew so fast it forgot to grow wise',
  'every crack in this wall is a year the rain was gentle',
  'telephone wires hold the neighbourhood together like stitches',
  'somewhere beneath this street a river still knows its name',
  'grey is not the absence of colour but its memory',
];

export function demoSVG(PW, PH, i) {
  // Japanese art style palettes matching the 8 style rotation
  const palettes = [
    // Ukiyo-e — navy, vermillion, gold, ivory, charcoal
    ['#1a2e5e', '#c0392b', '#d4a017', '#f5f0e8', '#1a1a1a'],
    // Sumi-e — ink blacks/greys, white, single crimson accent
    ['#0a0a0a', '#484848', '#888888', '#f0eeea', '#8b1a1a'],
    // Manga — stark B&W + electric blue hit
    ['#0a0a0a', '#e8e8e8', '#f0f0f0', '#1a6eb5', '#c8c8c8'],
    // Woodblock — earth inks: indigo, rust, tan, black
    ['#2c3e6b', '#8b3a1e', '#c8a05a', '#1a1410', '#d4c8a8'],
    // Anime — flat primaries: red, yellow, blue, white, black
    ['#d42020', '#f5c518', '#1a6eb5', '#f0f0f0', '#0a0a0a'],
    // Kirie — single vermillion + black/white negative space
    ['#c0281e', '#1a1a1a', '#f0eeea', '#e8e0d8', '#0a0808'],
    // Wabi-sabi — ochre, moss, ash, umber
    ['#b8924a', '#5a6e3a', '#9a9490', '#4a3c28', '#d0c8b8'],
    // Kanji-art — deep ink gradient, gold accent
    ['#0a0808', '#2a2420', '#6a5c48', '#c8a830', '#f0eeea'],
  ];
  const p = palettes[i % palettes.length];
  const r = () => Math.random();

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">`;
  s += `<defs>` +
       `<linearGradient id="g${i}" x1="0" y1="0" x2="0.4" y2="1">` +
       `<stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/>` +
       `</linearGradient>` +
       `<radialGradient id="rg${i}" cx="0.5" cy="0.4" r="0.55">` +
       `<stop offset="0" stop-color="${p[2]}" stop-opacity="0.9"/>` +
       `<stop offset="1" stop-color="${p[0]}" stop-opacity="0"/>` +
       `</radialGradient>` +
       `</defs>`;

  // Background fill
  s += `<rect width="${PW}" height="${PH}" fill="url(#g${i})"/>`;
  s += `<rect width="${PW}" height="${PH}" fill="url(#rg${i})"/>`;

  // Large structural shapes (Japanese compositional asymmetry)
  for (let k = 0; k < 18; k++) {
    const c   = p[k % p.length];
    const op  = (0.35 + r() * 0.55).toFixed(2);
    const t   = k % 4;

    if (t === 0) {
      // Bold circle / ellipse
      s += `<ellipse cx="${(r()*PW).toFixed(1)}" cy="${(r()*PH).toFixed(1)}" rx="${(15+r()*80).toFixed(1)}" ry="${(15+r()*70).toFixed(1)}" fill="${c}" opacity="${op}"/>`;
    } else if (t === 1) {
      // Rotated rectangle (dynamic angle)
      const rx = (r()*PW).toFixed(1), ry = (r()*PH).toFixed(1);
      const rw = (20+r()*110).toFixed(1), rh = (10+r()*90).toFixed(1);
      s += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${c}" opacity="${op}" transform="rotate(${(r()*60-30).toFixed(1)} ${(+rx+rw/2).toFixed(1)} ${(+ry+rh/2).toFixed(1)})"/>`;
    } else if (t === 2) {
      // Triangle / polygon
      const bx = r()*PW, by = r()*PH;
      s += `<polygon points="${bx.toFixed(1)},${by.toFixed(1)} ${(bx+40+r()*100).toFixed(1)},${(by+15).toFixed(1)} ${(bx+20).toFixed(1)},${(by+80+r()*70).toFixed(1)}" fill="${c}" opacity="${op}"/>`;
    } else {
      // Horizontal band (woodblock / kirie style)
      const bw = (60+r()*120).toFixed(1);
      s += `<rect x="${(r()*(PW-bw)).toFixed(1)}" y="${(r()*PH).toFixed(1)}" width="${bw}" height="${(4+r()*18).toFixed(1)}" fill="${c}" opacity="${op}"/>`;
    }
  }

  // Accent focal element — centred radial
  s += `<circle cx="${(PW*0.5).toFixed(1)}" cy="${(PH*0.42).toFixed(1)}" r="${(PW*0.16).toFixed(1)}" fill="${p[3]}" opacity="0.80"/>`;
  s += `<circle cx="${(PW*0.5).toFixed(1)}" cy="${(PH*0.42).toFixed(1)}" r="${(PW*0.09).toFixed(1)}" fill="${p[4]}" opacity="0.70"/>`;

  s += `</svg>`;
  return s;
}
