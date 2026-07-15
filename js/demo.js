export const DEMO_THOUGHTS = [
  'power lines trace the sky the way rivers trace the land',
  'this concrete wall has memorized every face that passed',
  'morning mist sits on the rooftops like a patient thought',
  'the city grew so fast it forgot to grow wise',
  'every crack in this wall is a year the rain was gentle',
  'telephone wires hold the neighbourhood together like stitches',
  'somewhere beneath this street a river still knows its name',
  'grey is not the absence of colour but its memory',
  'the mural remembers when the neighbourhood was young',
  'bricks are just compressed time and dust',
  'rain writes stories on walls that only walls understand',
  'this street has weathered a thousand quiet revolutions',
  'shadows climb these walls like slow growing ivy',
  'the city breathes through its painted lungs',
  'every layer of paint is a forgotten conversation',
  'wind plays music against these stone surfaces',
  'the wall keeps watch over the street like a guardian',
  'colour fades but memory persists in the mortar',
  'this corner has heard more secrets than it can hold',
  'the city writes its autobiography on every wall',
  'dawn paints these walls in shades the night refuses to name',
  'each mural is a prayer the city whispers to itself',
  'the wall stands as monument to ordinary lives',
  'these bricks remember the hands that laid them',
  'the city grows like coral, slowly covering itself',
  'murals are the dreams that concrete finally allows itself',
  'every wall is a page in the city\'s unfinished story',
  'the street arranges itself around these paintings',
  'colour brings life to a structure built for endurance',
  'this mural is a conversation between time and space',
  'the wall transforms when someone decides to listen',
  'the city hums its truths through the paint',
  'these colours hold the weight of choices made visible',
  'the street is a living gallery of forgotten moments',
  'each brushstroke is an act of rebellion and tenderness',
  'the wall receives the city\'s confessions',
  'time moves differently here, in this coloured space',
  'the mural breathes life into concrete stillness',
  'the city speaks through these painted stories',
  'brick and mortar dream in technicolour',
  'the wall is a mirror that shows the city to itself',
  'these paintings are the city\'s truest language',
  'the street remembers every artist who ever looked',
  'colour is the city\'s way of saying it is alive',
  'the wall stands between memory and desire',
  'these murals are footnotes in an endless urban poem',
  'the city leaves its fingerprints in paint',
  'each wall holds the weight of countless glances',
  'the street is dressed in the dreams of artists',
  'the mural is where the city finally becomes honest',
  'colour flows through these walls like blood through veins',
  'the wall keeps time in shades of fading paint',
  'the city writes itself in murals and stone',
  'these paintings are proof the city has a soul',
  'the wall holds stories that buildings alone cannot tell',
  'each layer of paint is a year the wall has lived',
  'the street gathers its beauty like scattered flowers',
  'the mural speaks the language of the forgotten',
  'the city dreams in colour and concrete',
  'these walls are pages turned by wind and weather',
  'the street arranges its poetry in pigment',
  'the wall is an archive of singular moments',
  'colour bleeds into the city like water into stone',
  'the mural transforms the ordinary into the sacred',
  'the city breathes through these painted portraits',
  'the wall stands as witness to passing time',
  'each painting is a prayer the street offers up',
  'the street collects its beauty on these surfaces',
  'the mural is the city\'s truest autobiography',
  'these walls remember what the city wants to forget',
  'colour is the city\'s rebellion against grey',
  'the wall receives the weight of countless stories',
  'the street speaks through these murals',
  'the city is painted in the dreams of its people',
  'these colours are the city\'s last honest words',
  'the wall holds the city\'s breath',
  'the mural is where concrete learns to sing',
  'the street arranges itself around beauty',
  'the city leaves its heart on these walls',
  'each painting is a seed planted in concrete',
  'the wall remembers every eye that has seen it',
  'the street is illuminated by paint and purpose',
  'the mural bridges memory and moment',
  'colour cascades down these walls like rain',
  'the city speaks truth through its murals',
  'these walls are the city\'s unfiltered thoughts',
  'the street holds colour like a cup holds water',
  'the mural is the city\'s most honest mirror',
  'paint transforms these walls into monuments',
  'the city whispers its secrets to the street',
  'these colours are the city\'s blood made visible',
  'the wall is patient with the city\'s becoming',
  'the mural teaches the street to remember',
  'the city dreams itself into colour',
  'these walls are the city\'s diary written large',
  'the street collects these paintings like precious stones',
  'the mural is where the ordinary becomes eternal',
  'colour settles on these walls like benediction',
  'the city\'s heart beats in rhythm with the painted walls',
  'the wall stands as proof of beauty\'s persistence',
  'the street is alive with the colours of human longing',
  'the mural is the city\'s only completely honest speech',
  'these walls remember what we choose to forget',
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
