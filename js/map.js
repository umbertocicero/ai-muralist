// ===========================================================================
//  City map — draws the generated town onto a 2D canvas, in the same inked
//  manga language as the panel: paper ground, black ink buildings, grey road
//  ribbons, orange only where the murals are. Handy as a debug overview and
//  as an exportable "print" of the procedurally built city.
//
//  Usage:  drawCityMap(city)               → HTMLCanvasElement
//          drawCityMap(city, { agent })    → also marks KAI's position
//  Debug:  with ?debugcam, window.__map() opens it in an overlay (main.js).
// ===========================================================================

export function drawCityMap(city, { size = 1200, agent = null } = {}) {
  const half = city.HALF + 4;               // world half-extent + margin
  const S = size / (half * 2);              // world → pixel scale
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const px = (x) => (x + half) * S;
  const pz = (z) => (z + half) * S;

  // paper ground + a faint grid so distances read
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(0,0,0,0.05)'; g.lineWidth = 1;
  for (let v = -60; v <= 60; v += 10) {
    g.beginPath(); g.moveTo(px(v), 0); g.lineTo(px(v), size); g.stroke();
    g.beginPath(); g.moveTo(0, pz(v)); g.lineTo(size, pz(v)); g.stroke();
  }

  // main roads — grey ribbons with an ink edge
  for (const r of city.mainRoads) {
    for (const [w, col] of [[(r.half + 0.35) * 2 * S, '#2a2824'], [r.half * 2 * S, '#d2d0cc']]) {
      g.strokeStyle = col; g.lineWidth = w; g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      r.pts.forEach((p, i) => i ? g.lineTo(px(p.x), pz(p.z)) : g.moveTo(px(p.x), pz(p.z)));
      g.stroke();
    }
  }

  // buildings — oriented rectangles, white fill + heavy ink outline (manga)
  for (const b of city.buildings) {
    g.save();
    g.translate(px(b.cx), pz(b.cz));
    g.rotate(-b.rot);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1a1814';
    g.lineWidth = Math.max(1.5, S * 0.16);
    g.beginPath(); g.rect(-b.hw * S, -b.hd * S, b.hw * 2 * S, b.hd * 2 * S);
    g.fill(); g.stroke();
    // roof hatching diagonal, so blocks read as built volumes
    g.clip();
    g.strokeStyle = 'rgba(26,24,20,0.28)'; g.lineWidth = 1;
    const span = Math.max(b.hw, b.hd) * 2 * S;
    for (let d = -span; d <= span; d += 5) {
      g.beginPath(); g.moveTo(d - span, -span); g.lineTo(d + span, span); g.stroke();
    }
    g.restore();
  }

  // utility poles — small grey dots (lamp heads are stored spherified, so the
  // pole net is the readable flat proxy for the street lighting on the map)
  g.fillStyle = '#8d897f';
  for (const p of city.poles) { g.beginPath(); g.arc(px(p.x), pz(p.z), 2, 0, 7); g.fill(); }

  // mural slots — orange where painted, hollow where still blank
  for (const s of city.wallSlots) {
    const X = px(s.px), Z = pz(s.pz);
    if (s.used && s.mesh) { g.fillStyle = '#ff6b35'; g.fillRect(X - 3.5, Z - 3.5, 7, 7); }
    else { g.strokeStyle = 'rgba(255,107,53,0.45)'; g.lineWidth = 1; g.strokeRect(X - 2, Z - 2, 4, 4); }
  }

  // KAI
  if (agent?.char?.pos) {
    const X = px(agent.char.pos.x), Z = pz(agent.char.pos.z);
    g.fillStyle = '#ff6b35'; g.strokeStyle = '#1a1814'; g.lineWidth = 2;
    g.beginPath(); g.arc(X, Z, 7, 0, 7); g.fill(); g.stroke();
  }

  // frame + title, like a printed panel
  g.strokeStyle = '#1a1814'; g.lineWidth = 4;
  g.strokeRect(8, 8, size - 16, size - 16);
  g.fillStyle = '#1a1814';
  g.font = `bold ${Math.round(size * 0.022)}px "Courier New", monospace`;
  g.fillText('AI MURALIST — CITY MAP', 26, size - 26);
  g.fillStyle = '#ff6b35';
  const painted = city.wallSlots.filter(s => s.used && s.mesh).length;
  g.fillText(`● ${painted} murals`, size - 200, size - 26);

  return cv;
}
