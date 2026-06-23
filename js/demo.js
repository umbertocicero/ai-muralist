export const DEMO_THOUGHTS = [
  'this grey wall has been holding its breath for years',
  'concrete forgets but paint insists on remembering',
  'every blank surface is a confession waiting to happen',
  'the city built walls then begged someone to break them',
  'color is the only language this street still understands',
  'silence here is just noise that finally gave up',
  'walls remember everything cities try to forget',
  'somewhere under this primer a sunset is trying to escape',
];

export function demoSVG(PW, PH, i) {
  const palettes = [
    ['#ff6b35','#004e89','#ffd23f','#1a1a2e','#f7f7ff'],
    ['#2d6a4f','#95d5b2','#d8f3dc','#ffb703','#fb8500'],
    ['#e63946','#f1faee','#a8dadc','#457b9d','#1d3557'],
    ['#7209b7','#3a0ca3','#4361ee','#4cc9f0','#f72585'],
  ];
  const p = palettes[i % palettes.length];
  const r = Math.random;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">`;
  s += `<defs>` +
       `<linearGradient id="g${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient>` +
       `<radialGradient id="r${i}"><stop offset="0" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[4]}"/></radialGradient>` +
       `</defs>`;
  s += `<rect width="${PW}" height="${PH}" fill="url(#g${i})"/>`;
  for (let k = 0; k < 16; k++) {
    const c = p[k % p.length], op = (0.4 + r() * 0.5).toFixed(2);
    if (k % 3 === 0) {
      s += `<circle cx="${(r()*PW).toFixed(1)}" cy="${(r()*PH).toFixed(1)}" r="${(20+r()*90).toFixed(1)}" fill="${c}" opacity="${op}"/>`;
    } else if (k % 3 === 1) {
      const rx = (r()*PW).toFixed(1), ry = (r()*PH).toFixed(1);
      s += `<rect x="${rx}" y="${ry}" width="${(30+r()*120).toFixed(1)}" height="${(30+r()*120).toFixed(1)}" fill="${c}" opacity="${op}" transform="rotate(${(r()*90).toFixed(1)} ${rx} ${ry})"/>`;
    } else {
      const x = r()*PW, y = r()*PH;
      s += `<polygon points="${x.toFixed(1)},${y.toFixed(1)} ${(x+60+r()*80).toFixed(1)},${(y+20).toFixed(1)} ${(x+30).toFixed(1)},${(y+90+r()*60).toFixed(1)}" fill="${c}" opacity="${op}"/>`;
    }
  }
  s += `<circle cx="${(PW*0.5).toFixed(1)}" cy="${(PH*0.5).toFixed(1)}" r="${(PW*0.18).toFixed(1)}" fill="url(#r${i})" opacity="0.85"/>`;
  s += `</svg>`;
  return s;
}
