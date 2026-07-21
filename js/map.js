// ===========================================================================
//  City map — the generated town drawn in the same inked manga language as the
//  panel: paper ground, black ink buildings, grey road ribbons, orange only
//  where the murals (and KAI) are.
//
//  Split in two layers so the LIVE map view stays free:
//    • drawBaseMap  — paper/grid/roads/buildings/poles, drawn ONCE and cached
//    • drawLive     — mural markers, KAI's fading trail, KAI + heading
//  renderLiveMap composites the two onto a target canvas (~8 fps from the map
//  overlay); drawCityMap produces the one-shot printable map (debug __map()).
// ===========================================================================

export function drawBaseMap(city, { size = 1100 } = {}) {
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

  // utility poles — small grey dots (the readable proxy for the street net)
  g.fillStyle = '#8d897f';
  for (const p of city.poles) { g.beginPath(); g.arc(px(p.x), pz(p.z), 2, 0, 7); g.fill(); }

  // frame + title, like a printed panel
  g.strokeStyle = '#1a1814'; g.lineWidth = 4;
  g.strokeRect(8, 8, size - 16, size - 16);
  g.fillStyle = '#1a1814';
  g.font = `bold ${Math.round(size * 0.022)}px "Courier New", monospace`;
  g.fillText('AI MURALIST — CITY MAP', 26, size - 26);
  return cv;
}

// The live layer: mural markers, KAI's fading trail and KAI himself.
// `trail` is a flat [x0,z0, x1,z1, …] array of recent flat positions.
export function drawLive(g, city, agent, trail, size, t = performance.now() / 1000) {
  const half = city.HALF + 4, S = size / (half * 2);
  const px = (x) => (x + half) * S;
  const pz = (z) => (z + half) * S;

  // Mural slots. Murals live on VERTICAL walls, so on this top-down map you
  // never see the artwork itself — only these markers say what's done. The
  // three states are drawn UNMISTAKABLY differently so no wall reads wrong:
  //   • PAINTED       — small muted orange dot (done, de-emphasised)
  //   • TO PAINT       — bold BLUE hollow ring (reachable + still blank) that pops
  //   • UNREACHABLE    — faint grey hollow (approach cut off from the street
  //                      network; can't be painted) — shown, NOT hidden, so a
  //                      building whose only walls are these doesn't look like a
  //                      forgotten blank house with no marker at all.
  let painted = 0, blank = 0;
  for (const s of city.wallSlots) {
    const X = px(s.px), Z = pz(s.pz);
    if (s.used && s.mesh) {
      painted++;
      g.fillStyle = 'rgba(255,107,53,0.75)'; g.strokeStyle = 'rgba(26,24,20,0.5)'; g.lineWidth = 1;
      g.fillRect(X - 3, Z - 3, 6, 6); g.strokeRect(X - 3, Z - 3, 6, 6);
    } else if (s.unreachable) {
      g.strokeStyle = 'rgba(120,120,120,0.55)'; g.lineWidth = 1;
      g.strokeRect(X - 3, Z - 3, 6, 6);
    } else {
      blank++;
      g.strokeStyle = '#1a6fff'; g.lineWidth = 2.5;
      g.strokeRect(X - 5, Z - 5, 10, 10);
    }
  }

  // KAI's trail — drawn in short segments with fading alpha (older = fainter)
  if (trail && trail.length >= 4) {
    const n = trail.length / 2;
    g.lineWidth = 3; g.lineJoin = g.lineCap = 'round';
    // Breadcrumbs land ~7×/s while Kay walks ≤2.6 m/s, so consecutive points sit
    // well under a metre apart. Any longer gap is a discontinuity (teleport
    // guard, relocate, Pac-Man wrap) — drawing it would streak a straight line
    // across the map through buildings, so skip the segment instead.
    const JUMP = 5;
    for (let i = 1; i < n; i++) {
      const ax = trail[(i - 1) * 2], az = trail[(i - 1) * 2 + 1];
      const bx = trail[i * 2],       bz = trail[i * 2 + 1];
      if (Math.abs(bx - ax) > JUMP || Math.abs(bz - az) > JUMP) continue;  // don't streak a jump
      g.strokeStyle = `rgba(255,107,53,${(0.08 + 0.72 * (i / n)).toFixed(3)})`;
      g.beginPath();
      g.moveTo(px(ax), pz(az));
      g.lineTo(px(bx), pz(bz));
      g.stroke();
    }
  }

  // KAI — orange dot with an ink ring, a heading tick and a soft pulse
  if (agent?.char?.pos) {
    const X = px(agent.char.pos.x), Z = pz(agent.char.pos.z);
    const pulse = 10 + 3 * Math.sin(t * 4);
    g.strokeStyle = 'rgba(255,107,53,0.4)'; g.lineWidth = 2;
    g.beginPath(); g.arc(X, Z, pulse, 0, 7); g.stroke();
    const yaw = agent.char.yaw ?? 0;
    g.strokeStyle = '#1a1814'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X, Z); g.lineTo(X + Math.sin(yaw) * 15, Z + Math.cos(yaw) * 15); g.stroke();
    g.fillStyle = '#ff6b35'; g.strokeStyle = '#1a1814'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(X, Z, 7, 0, 7); g.fill(); g.stroke();
  }

  // live legend (bottom-right, over the base frame): painted count + how many
  // walls are still to paint, so the map's two marker styles are self-explaining.
  g.fillStyle = '#f4f1ea';
  g.fillRect(size - 250, size - 46, 230, 30);
  g.font = `bold ${Math.round(size * 0.022)}px "Courier New", monospace`;
  g.fillStyle = '#ff6b35';
  g.fillText(`● ${painted} painted`, size - 242, size - 24);
  g.fillStyle = '#1a6fff';
  g.fillText(blank ? `□ ${blank} to paint` : '✓ all done', size - 118, size - 24);
}

// Composite base + live onto `canvas` — called ~8×/s by the map overlay while
// it is open. The base is rendered once and cached per (city, size).
let _base = null;
export function renderLiveMap(canvas, city, agent, trail) {
  const size = canvas.width;
  if (!_base || _base.width !== size || _base._city !== city) {
    _base = drawBaseMap(city, { size });
    _base._city = city;
  }
  const g = canvas.getContext('2d');
  g.drawImage(_base, 0, 0);
  drawLive(g, city, agent, trail, size);
}

// One-shot printable map (debug window.__map()).
export function drawCityMap(city, { size = 1200, agent = null, trail = null } = {}) {
  const cv = drawBaseMap(city, { size });
  drawLive(cv.getContext('2d'), city, agent, trail, size);
  return cv;
}
