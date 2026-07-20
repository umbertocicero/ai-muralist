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
    // a SEEKING → MOVING_TO_WALL edge means a wall was just chosen + routed to;
    // _pickWall ran from Kay's current cell (he doesn't move during SEEKING).
    if (before === SIM_STATE.SEEKING && sim.state === SIM_STATE.MOVING_TO_WALL)
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

// ── 5: stuck-escape — trapped in an isolated pocket, he relocates out ─────────
{
  const model = buildModel({ wallCoords: gridWalls });
  const s = model.cellSize;
  // Wall Kay into a 1-cell pocket at spawn: block all 8 neighbours of (0,0).
  for (const [dx, dz] of [[s, 0], [-s, 0], [0, s], [0, -s], [s, s], [s, -s], [-s, s], [-s, -s]])
    model.cells[model.cellOf(dx, dz)] = 1;
  model.cells[model.cellOf(0, 0)] = 0;   // the pocket itself stays free
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5, stuckSeconds: 3 }, mulberry32(9));

  // Confirm he really is boxed in at the start (no route out of the pocket).
  const trappedAtStart = sim._findPath(0, 0, 10, 0) === null;
  run(sim, { steps: 200, dt: 0.1 });
  check('5. stuck-escape — a trapped Kay relocates to an open street', () => {
    assert(trappedAtStart, 'test setup failed: Kay was not actually boxed in');
    assert(Math.hypot(sim.x, sim.z) > 1.0, `Kay never left the pocket (at ${sim.x.toFixed(2)},${sim.z.toFixed(2)})`);
    assert(!sim.blocked(sim.x, sim.z), 'Kay relocated onto a blocked cell');
    assert(sim._openNeighbors(sim.x, sim.z) >= 5, 'Kay relocated into another cramped spot');
  });
}

// ── 6: hibernation resume — serialize mid-walk, hydrate, walk continues ──────
// The DO persists the sim every tick and can be evicted between ticks. A wake
// must RESUME the active walk (same target, same route, same progress), not
// re-seek: re-seeking rolled Kay back on screen and re-broadcast the route.
{
  const model = buildModel({ wallCoords: gridWalls });
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5 }, mulberry32(11));
  // Step until he is walking, then a bit further so he's clearly mid-route.
  let guard = 5000;
  while (sim.state !== SIM_STATE.MOVING_TO_WALL && guard-- > 0) sim.step(0.1);
  for (let i = 0; i < 5; i++) sim.step(0.1);
  const before = { x: sim.x, z: sim.z, target: sim.targetId, state: sim.state };

  const revived = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5 }, mulberry32(12))
    .hydrate(JSON.parse(JSON.stringify(sim.serialize())));   // through-storage round trip
  check('6. hibernation resume — mid-walk serialize/hydrate keeps the walk', () => {
    assert(before.state === SIM_STATE.MOVING_TO_WALL, 'test setup failed: never started walking');
    assert.equal(revived.state, SIM_STATE.MOVING_TO_WALL, 'walk was not resumed (fell back to SEEKING)');
    assert.equal(revived.targetId, before.target, 'resumed toward a different wall');
    assert(Math.hypot(revived.x - before.x, revived.z - before.z) < 1e-9, 'position rolled back');
    const r = revived.currentRoute();
    assert(r && r.waypoints.length > 0, 'no route to hand a mid-walk joiner');
    // And the walk actually completes: he reaches the wall and starts the cycle.
    let g = 3000, sig = null;
    while (g-- > 0 && !sig) sig = revived.step(0.1);
    assert(sig && sig.paint && sig.paint.id === before.target, 'resumed walk never reached the wall');
  });
}

// ── 6b: route start breaks the coarse tick — no pre-walk before broadcast ────
// advance() must STOP the moment a route is chosen: the DO broadcasts the route
// right after, and consuming the rest of the tick first would walk Kay metres
// into it before any browser knows it exists (clients then trail by a tick and
// he appears to start painting from the middle of the street).
{
  const model = buildModel({ wallCoords: gridWalls });
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5 }, mulberry32(21));
  const sig = sim.advance(2.0);   // a full coarse tick from cold
  check('6b. advance() breaks at route start (route broadcast from its true start)', () => {
    assert(sig && sig.routeStarted, 'no routeStarted signal from advance()');
    assert.equal(sim.state, SIM_STATE.MOVING_TO_WALL);
    assert(Math.hypot(sim.x - model.spawn.x, sim.z - model.spawn.z) < 1e-9,
      `already walked ${Math.hypot(sim.x - model.spawn.x, sim.z - model.spawn.z).toFixed(2)} m into the route before the broadcast`);
    const r = sim.currentRoute(true);
    assert(r && r.waypoints.length >= 1, 'no route to broadcast');
  });
}

// ── 6c: OBSERVE never outlasts observeMaxSeconds, even with cooldown to spare ─
// Two walls placed right next to each other: travel is near-instant, so almost
// the whole 18-32 s cooldown is still on the clock when Kay arrives. Before the
// fix, OBSERVE inherited that full remaining cooldown — he'd stand at the wall
// for up to ~30 s before spraying. It must now cap at cfg.observeMaxSeconds.
{
  const model = buildModel({ wallCoords: [[0, 0, 1, 0], [0, 1.2, 1, 0]] });
  const cfg = { cooldownMin: 18, cooldownRange: 14, observeMaxSeconds: 1.0 };
  const sim = new KaySim(model, cfg, mulberry32(31));
  // Walk to and paint the first wall (short trip — the model's approach points
  // are only 1.5 m from spawn), then watch how long OBSERVE holds before wall 2.
  let guard = 4000, sig = null;
  while (guard-- > 0 && !(sig && sig.paint)) sig = sim.step(0.1);
  sim.paintDone({ svg: '<svg/>', thought: 't' });
  guard = 4000;
  while (guard-- > 0 && sim.state !== SIM_STATE.ADMIRING) sim.step(0.1);

  let observeElapsed = 0, sawObserve = false, sig2 = null;
  guard = 4000;
  while (guard-- > 0 && !(sig2 && sig2.paint)) {
    sig2 = sim.step(0.1);
    if (sim.state === SIM_STATE.OBSERVE) { sawObserve = true; observeElapsed += 0.1; }
  }
  check('6c. OBSERVE caps at observeMaxSeconds regardless of leftover cooldown', () => {
    assert(sawObserve, 'test setup failed: never entered OBSERVE for the second wall');
    assert(observeElapsed <= cfg.observeMaxSeconds + 0.15,
      `stood observing for ${observeElapsed.toFixed(2)} s, expected ≤ ${cfg.observeMaxSeconds} s`);
  });
}

// ── 7: legacy snapshot (no walk field) still hydrates to SEEKING ─────────────
{
  const model = buildModel({ wallCoords: gridWalls });
  const revived = new KaySim(model, {}, mulberry32(13))
    .hydrate({ x: 3, z: 4, muralCount: 2, painted: [0], defer: [] });
  check('7. legacy snapshot without walk hydrates to SEEKING', () => {
    assert.equal(revived.state, SIM_STATE.SEEKING);
    assert.equal(revived.targetId, null);
    assert.equal(revived.muralCount, 2);
  });
}

// ── 8: NO_MORE_WALL — a fully-painted city → wander + admire the gallery ─────
// After coverage, Kay must not freeze: he enters NO_MORE_WALL, strolls to a
// finished mural (MOVING_TO_WALL with _roamAdmire), ADMIREs it (never repaints),
// then keeps touring — and drops back to SEEKING the instant a wall frees up.
{
  const model = buildModel({ wallCoords: gridWalls });
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5, roamPauseSeconds: 0.5 }, mulberry32(41));
  // Paint everything.
  const cov = run(sim, { steps: 60000, dt: 0.1 });
  const paintedBefore = sim.painted.size;
  // Now roam for a while and record what he does.
  const states = new Set();
  let admireMoves = 0, repainted = 0, prev = sim.state;
  for (let i = 0; i < 6000; i++) {
    const sig = sim.step(0.1);
    if (sig && sig.paint) { repainted++; sim.paintDone({ svg: '<svg/>', thought: 't' }); }
    states.add(sim.state);
    if (prev !== SIM_STATE.ADMIRING && sim.state === SIM_STATE.ADMIRING) admireMoves++;
    prev = sim.state;
  }
  check('8. NO_MORE_WALL — full city: wanders + admires, never repaints', () => {
    assert(cov.done, `coverage not reached first (${paintedBefore}/${model.walls.length})`);
    assert(states.has(SIM_STATE.NO_MORE_WALL), 'never entered NO_MORE_WALL');
    assert(states.has(SIM_STATE.MOVING_TO_WALL), 'never strolled to a mural to admire');
    assert(admireMoves >= 2, `expected repeated admiring while roaming, got ${admireMoves}`);
    assert.equal(repainted, 0, 'repainted an already-finished wall while roaming');
    assert.equal(sim.painted.size, paintedBefore, 'painted set changed while only admiring');
  });
}

// ── 9: NO_MORE_WALL → SEEKING the moment a wall frees up ─────────────────────
{
  const model = buildModel({ wallCoords: gridWalls });
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5, roamPauseSeconds: 0.5 }, mulberry32(42));
  run(sim, { steps: 60000, dt: 0.1 });
  // free one wall (as a D1 wipe / rebuildPainted would) and let him notice
  sim.painted.delete(3);
  let resumed = false;
  for (let i = 0; i < 400; i++) { sim.step(0.1); if (sim.state === SIM_STATE.SEEKING || sim.state === SIM_STATE.MOVING_TO_WALL) { if (!sim._roamAdmire) { resumed = true; break; } } }
  check('9. a freed wall pulls Kay out of NO_MORE_WALL back to painting', () => {
    assert(resumed, 'Kay kept roaming instead of resuming painting when a wall freed up');
  });
}

// ── 10: unroutable walls are blacklisted, never a teleport loop ──────────────
// An approach cell can be carved free yet WALLED IN (alley walls). The old
// logic blamed Kay and teleported him to spawn after 30 consecutive routing
// failures — with only unroutable walls left he cycled pick→fail→jump forever,
// visibly teleporting around town while people watched. Now: three strikes
// while Kay is provably mobile → the wall is blacklisted; when only blacklisted
// walls remain he settles into NO_MORE_WALL. Position must stay CONTINUOUS.
{
  const wallCoords = [[-12, -12, 1, 0], [12, -12, -1, 0], [-12, 12, 1, 0], [12, 12, -1, 0], [4, 4, 1, 0]];
  const model = buildModel({ wallCoords });
  // Wall id 4's approach is at (5.5, 4): wall it in — block every neighbour of
  // its cell while the approach cell itself stays free (exactly the trap).
  const apx = 5.5, apz = 4, s = model.cellSize;
  for (const [dx, dz] of [[s,0],[-s,0],[0,s],[0,-s],[s,s],[s,-s],[-s,s],[-s,-s]])
    model.cells[model.cellOf(apx + dx, apz + dz)] = 1;
  model.cells[model.cellOf(apx, apz)] = 0;
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5, roamPauseSeconds: 0.5 }, mulberry32(77));
  // sanity: the trap is real (wall 4 unroutable), Kay is mobile
  const trapped = sim._findPath(model.spawn.x, model.spawn.z, apx, apz) === null;

  let maxStep = 0, prevX = sim.x, prevZ = sim.z, roamed = false;
  for (let i = 0; i < 30000; i++) {
    const sig = sim.step(0.1);
    if (sig && sig.paint) sim.paintDone({ svg: '<svg/>', thought: 't' });
    maxStep = Math.max(maxStep, Math.hypot(sim.x - prevX, sim.z - prevZ));
    prevX = sim.x; prevZ = sim.z;
    if (sim.state === SIM_STATE.NO_MORE_WALL) roamed = true;
  }
  check('10. unroutable wall → blacklist + NO_MORE_WALL roaming, zero teleports', () => {
    assert(trapped, 'test setup failed: wall 4 was actually routable');
    assert.equal(sim.painted.size, 4, `expected the 4 reachable walls painted, got ${sim.painted.size}`);
    assert(sim._unreachable.has(4), 'the walled-in wall was never blacklisted');
    assert(maxStep <= sim.cfg.moveSpeed * 0.1 + 1e-6,
      `position jumped ${maxStep.toFixed(2)} m in one step — still teleporting`);
    // He settled into the gallery-roam cycle (NO_MORE_WALL ↔ stroll ↔ admire),
    // not a SEEKING fail-loop; the exact end state depends where the loop cut.
    assert(roamed, 'never settled into NO_MORE_WALL roaming');
    const okEnd = sim.state === SIM_STATE.NO_MORE_WALL || sim.state === SIM_STATE.ADMIRING ||
                  (sim.state === SIM_STATE.MOVING_TO_WALL && sim._roamAdmire);
    assert(okEnd, `ended outside the roam cycle: ${sim.state}`);
  });
}

// ── 11: a sealed baked stand cell → an alternate stand still paints the wall ─
// Production geometry (0.5 m cells): the baked approach cell is carved free but
// ringed by blocked cells (grid quantisation in a narrow spot). The candidates
// slid ±0.75 m along the face land OUTSIDE the seal and route fine — the wall
// must get its mural, not a blacklist entry.
{
  const wallCoords = [[4, 4, 1, 0]];
  const model = buildModel({ wallCoords, cellSize: 0.5 });
  const apx = 5.5, apz = 4, s = model.cellSize;
  for (const [dx, dz] of [[s,0],[-s,0],[0,s],[0,-s],[s,s],[s,-s],[-s,s],[-s,-s]])
    model.cells[model.cellOf(apx + dx, apz + dz)] = 1;
  model.cells[model.cellOf(apx, apz)] = 0;      // carved free, but sealed at cell scale
  const sim = new KaySim(model, { cooldownMin: 0.5, cooldownRange: 0.5 }, mulberry32(88));
  const sealed = sim._findPath(model.spawn.x, model.spawn.z, apx, apz) === null;
  let sig = null, guard = 20000;
  while (guard-- > 0 && !(sig && sig.paint)) sig = sim.step(0.1);
  check('11. sealed baked stand cell → alternate stand point paints the wall anyway', () => {
    assert(sealed, 'test setup failed: the baked approach was not actually sealed');
    assert(sig && sig.paint && sig.paint.id === 0, 'wall never painted via an alternate stand');
    assert(!sim._unreachable.has(0), 'wall was wrongly blacklisted despite a viable stand');
  });
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll sim checks passed');
process.exit(failures ? 1 : 0);
