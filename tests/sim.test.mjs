// Deterministic proof of Kay's server-side simulation (js/sim.mjs) — no browser.
// Run:  node tests/sim.test.mjs
//
// Proves the four behavioural requirements of the task:
//   1. CONTINUITY — Kay never teleports (the Pac-Man/toroidal wrap is gone).
//   2. PROXIMITY  — each new target is one of the nearest free walls.
//   3. COVERAGE   — given time, every reachable wall gets painted.
//   4. REVISIT    — a wall skipped while unreachable is painted once it frees up.

import assert from 'node:assert';
import { KaySim, SIM_STATE, mulberry32 } from '../js/sim.mjs';

// ── Build a synthetic world model ────────────────────────────────────────────
// An open field (no obstacles) with a grid of walls, so pathing always succeeds
// and reachability is guaranteed. Approach + spawn cells are carved free exactly
// as the client (js/live.js) does.
function buildModel({ half = 30, cellSize = 1, wallCoords, block = [] } = {}) {
  const cols = Math.ceil((half * 2) / cellSize);
  const rows = cols;
  const cells = new Uint8Array(cols * rows);
  const cellOf = (x, z) => (((z + half) / cellSize) | 0) * cols + (((x + half) / cellSize) | 0);
  for (const [x, z] of block) cells[cellOf(x, z)] = 1;

  const walls = wallCoords.map(([px, pz, nx, nz], id) => ({
    id, px, py: 1.55, pz, nx, nz, wallW: 3, wallH: 2.7,
    ax: px + nx * 1.5, az: pz + nz * 1.5,
  }));
  // carve every approach + the spawn free (unless the test deliberately blocked it)
  const blockedSet = new Set(block.map(([x, z]) => cellOf(x, z)));
  for (const w of walls) if (!blockedSet.has(cellOf(w.ax, w.az))) cells[cellOf(w.ax, w.az)] = 0;
  cells[cellOf(0, 0)] = 0;

  return { half, cellSize, cols, rows, cells, spawn: { x: 0, z: 0 }, walls, cellOf };
}

const gridWalls = [];
for (const px of [-12, -4, 4, 12])
  for (const pz of [-12, -4, 4, 12])
    gridWalls.push([px, pz, 1, 0]);        // 16 walls, all facing +x

// Drive the sim like the Durable Object does: on a { paint } signal, finish the
// SVG immediately (fake success). Returns a record of every step + each target pick.
function run(sim, { steps, dt = 0.1, onPick } = {}) {
  let maxMove = 0;
  for (let i = 0; i < steps; i++) {
    const before = sim.state, bx = sim.x, bz = sim.z;
    const sig = sim.step(dt);
    maxMove = Math.max(maxMove, Math.hypot(sim.x - bx, sim.z - bz));
    if (sig && sig.paint) sim.paintDone({ svg: '<svg/>', thought: 't' });
    // a WANDERING → MOVING_TO_WALL edge means a wall was just chosen — _pickWall
    // ran from Kay's position AFTER this frame's wander-step, i.e. sim.x/sim.z now.
    if (before === SIM_STATE.WANDERING && sim.state === SIM_STATE.MOVING_TO_WALL)
      onPick?.(sim.byId.get(sim.targetId), sim.x, sim.z);
    if (sim.allPainted()) return { maxMove, done: true, steps: i + 1 };
  }
  return { maxMove, done: sim.allPainted(), steps };
}

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

// ── 1 + 2 + 3: continuity, proximity, coverage on the open grid ──────────────
{
  const model = buildModel({ wallCoords: gridWalls });
  const cfg = { cooldownMin: 0.5, cooldownRange: 0.5 };   // fast pace for the test
  const sim = new KaySim(model, cfg, mulberry32(12345));
  const maxStep = cfg.moveSpeed ?? sim.cfg.moveSpeed;
  const dt = 0.1;

  const picks = [];
  const res = run(sim, {
    steps: 40000, dt,
    onPick: (wall, fromX, fromZ) => {
      // reconstruct the exact pool _pickWall chose from: unpainted + approach-free,
      // minus walls currently deferred (given up on) unless every free wall is deferred.
      const free = model.walls.filter((w) => !sim.painted.has(w.id) && !sim.blocked(w.ax, w.az));
      let pool = free.filter((w) => (sim._defer.get(w.id) ?? 0) <= sim.simTime);
      if (!pool.length) pool = free;
      pool.sort((a, b) => ((a.px - fromX) ** 2 + (a.pz - fromZ) ** 2) - ((b.px - fromX) ** 2 + (b.pz - fromZ) ** 2));
      const nearestK = new Set(pool.slice(0, sim.cfg.nearK).map((w) => w.id));
      picks.push({ wallId: wall.id, inNearestK: nearestK.has(wall.id) });
    },
  });

  check('1. continuity — no teleport (max step ≤ moveSpeed·dt)', () => {
    const limit = sim.cfg.moveSpeed * dt * 1.0001;
    assert(res.maxMove <= limit, `max per-step move ${res.maxMove.toFixed(3)} > ${limit.toFixed(3)}`);
  });

  check('2. proximity — every target is one of the nearest free walls', () => {
    assert(picks.length >= 16, `only ${picks.length} picks observed`);
    const bad = picks.filter((p) => !p.inNearestK);
    assert(bad.length === 0, `${bad.length}/${picks.length} picks were NOT among the nearest ${sim.cfg.nearK}`);
  });

  check('3. coverage — every wall eventually painted', () => {
    assert(res.done, `only ${sim.painted.size}/${model.walls.length} painted after ${res.steps} steps`);
  });
}

// ── 4: revisit — a wall unreachable at first is painted once it opens up ──────
{
  const targetWall = gridWalls[5];                 // its approach cell starts blocked
  const model = buildModel({ wallCoords: gridWalls, block: [[targetWall[0] + 1.5, targetWall[1]]] });
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5 }, mulberry32(777));

  // Phase A: run while blocked — the wall (id 5) must NOT get painted.
  run(sim, { steps: 8000, dt: 0.1 });
  check('4a. skipped while unreachable — blocked wall stays unpainted', () => {
    assert(!sim.painted.has(5), 'wall 5 was painted even though its approach was blocked');
    assert(sim.painted.size >= 3, `expected progress on other walls, got ${sim.painted.size}`);
  });

  // Phase B: open the approach — Kay must come back and paint it.
  model.cells[model.cellOf(targetWall[0] + 1.5, targetWall[1])] = 0;
  const res = run(sim, { steps: 40000, dt: 0.1 });
  check('4b. revisit — the once-blocked wall is painted after it frees up', () => {
    assert(sim.painted.has(5), 'wall 5 never got revisited/painted after unblocking');
    assert(res.done, `full coverage not reached (${sim.painted.size}/${model.walls.length})`);
  });
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll sim checks passed');
process.exit(failures ? 1 : 0);
