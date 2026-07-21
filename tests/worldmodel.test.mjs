// Proof of buildWorldModel's connectivity filter (js/live.js): wall slots whose
// approach is cut off from the street network are dropped from the uploaded
// catalogue and tagged on city.wallSlots, so Kay never targets a wall he can't
// reach and the map shows no forever-blank edge slots.
// Run:  node tests/worldmodel.test.mjs

import assert from 'node:assert';
import { buildWorldModel, tagReachability, MODEL_VERSION } from '../js/live.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

// A fake city: open ground, except a solid block that seals a 1-cell pocket
// around (7,0). Slot 0's approach (0.5,0) is on the open street; slot 1's
// approach (7,0) sits inside the sealed pocket — reachable-looking but islanded.
function makeCity() {
  const sealed = (x, z) => (x > 5.5 && x < 8.5 && z > -1.5 && z < 1.5 && !(Math.abs(x - 7) < 0.4 && Math.abs(z) < 0.4));
  return {
    HALF: 10, spawn: { x: 0, z: 0 },
    isColliding: (x, z) => sealed(x, z),
    approachPoint: (s) => ({ x: s.px + s.nx * 1.5, z: s.pz + s.nz * 1.5 }),
    wallSlots: [
      { px: 2,   py: 1.55, pz: 0, nx: -1, nz: 0, wallW: 3, wallH: 2.7 },   // reachable
      { px: 8.5, py: 1.55, pz: 0, nx: -1, nz: 0, wallW: 3, wallH: 2.7 },   // sealed island
    ],
  };
}

{
  const city = makeCity();
  const m = buildWorldModel(city);
  check('1. unreachable slot dropped from the model, reachable kept', () => {
    assert.equal(m.version, MODEL_VERSION);
    assert.deepEqual(m.walls.map((w) => w.id), [0], 'model should carry only the reachable wall');
    assert.equal(city.wallSlots[0].unreachable, false, 'reachable slot must be tagged false');
    assert.equal(city.wallSlots[1].unreachable, true, 'islanded slot must be tagged true');
  });
}

// Fully open city: nothing dropped, ids preserved as wallSlots indices.
{
  const city = { HALF: 10, spawn: { x: 0, z: 0 }, isColliding: () => false,
    approachPoint: (s) => ({ x: s.px + s.nx * 1.5, z: s.pz + s.nz * 1.5 }),
    wallSlots: [
      { px: 2, py: 1.55, pz: 0, nx: -1, nz: 0, wallW: 3, wallH: 2.7 },
      { px: -2, py: 1.55, pz: 3, nx: 1, nz: 0, wallW: 3, wallH: 2.7 },
      { px: 0, py: 1.55, pz: -4, nx: 0, nz: 1, wallW: 3, wallH: 2.7 },
    ] };
  const m = buildWorldModel(city);
  check('2. open city keeps every wall, ids = wallSlots indices', () => {
    assert.deepEqual(m.walls.map((w) => w.id), [0, 1, 2]);
    assert.ok(city.wallSlots.every((s) => s.unreachable === false));
  });
}

// tagReachability tags EVERY slot (the map reads these to colour all three
// states), independent of building the upload model.
{
  const city = makeCity();
  tagReachability(city);
  check('3. tagReachability flags every slot for the map', () => {
    assert.equal(city.wallSlots[0].unreachable, false);
    assert.equal(city.wallSlots[1].unreachable, true);
    assert.ok(city.wallSlots.every((s) => s._approach && typeof s._approach.x === 'number'));
  });
}

// A noStand slot (kept by city.js only so its building isn't markerless — no
// reachable stand point exists) is pinned unreachable regardless of the grid,
// so it shows a grey marker on the map yet never enters the paintable catalogue.
{
  const city = { HALF: 10, spawn: { x: 0, z: 0 }, isColliding: () => false,
    approachPoint: (s) => ({ x: s.px + s.nx * 1.5, z: s.pz + s.nz * 1.5 }),
    wallSlots: [
      { px: 2, py: 1.55, pz: 0, nx: -1, nz: 0, wallW: 3, wallH: 2.7 },              // normal
      { px: 5, py: 1.55, pz: 0, nx: -1, nz: 0, wallW: 3, wallH: 2.7, noStand: true }, // hemmed-in fallback
    ] };
  const m = buildWorldModel(city);
  check('4. noStand fallback stays on the map but out of the catalogue', () => {
    assert.equal(city.wallSlots[0].unreachable, false);
    assert.equal(city.wallSlots[1].unreachable, true, 'noStand slot must be pinned unreachable');
    assert.deepEqual(m.walls.map((w) => w.id), [0], 'catalogue must exclude the noStand slot');
  });
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll worldmodel checks passed');
process.exit(failures ? 1 : 0);
