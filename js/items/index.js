import * as nature from './nature.js';
import * as vehicles from './vehicles.js';
import * as infrastructure from './infrastructure.js';
import * as furniture from './furniture.js';
import * as signs from './signs.js';
import * as house from './house.js';

// ===========================================================================
//  Item factory. The city no longer hand-builds these props inline; it calls
//  createItem(ctx, type, opts). Each item lives in this folder as a small,
//  parametric builder, clustered by theme into a module and registered here by
//  name. Adding a new prop = drop a builder in the right module (or a new one)
//  and add one line below.
//
//  `ctx` is the City instance (provides scene, rng, _rand, colliders, barriers,
//  lampHeads, _roofSeg, _wireSeg, _toWorld, R, animators, _leaf); `opts`
//  parametrise the item (position, size, angle, …).
// ===========================================================================

const BUILDERS = {
  // greenery (nature.js)
  leaf:          nature.makeLeaf,
  bush:          nature.makeBush,
  tree:          nature.makeTree,
  plant:         nature.makePottedPlant,
  vine:          nature.makeVine,
  // vehicles (vehicles.js)
  bicycle:       vehicles.makeBicycle,
  scooter:       vehicles.makeScooter,
  keiCar:        vehicles.makeKeiCar,
  // infrastructure (infrastructure.js)
  lamppost:      infrastructure.makeLamppost,
  pole:          infrastructure.makePole,
  wire:          infrastructure.makeWire,
  antenna:       infrastructure.makeAntenna,
  waterTower:    infrastructure.makeWaterTower,
  // street furniture (furniture.js)
  bench:         furniture.makeBench,
  planterBox:    furniture.makePlanterBox,
  cone:          furniture.makeTrafficCone,
  aFrameBarrier: furniture.makeAFrameBarrier,
  plankFence:    furniture.makePlankFence,
  stairs:        furniture.makeStairs,
  vending:       furniture.makeVendingMachine,
  manhole:       furniture.makeManhole,
  // signage (signs.js)
  nobori:        signs.makeNobori,
  roadSign:      signs.makeRoadSign,
  curveMirror:   signs.makeCurveMirror,
  // the house itself (house.js): roofs, balcony (+porta-finestra +futon), shop
  // dressing, siding seams and the facade-mounted fixtures
  gableRoof:     house.makeGableRoof,
  hipRoof:       house.makeHipRoof,
  roofTiles:     house.makeRoofTiles,
  corrugated:    house.makeCorrugated,
  sidingLines:   house.makeSidingLines,
  balcony:       house.makeBalcony,
  shopfront:     house.makeShopfront,
  roofSign:      house.makeRoofSign,
  acUnit:        house.makeAcUnit,
  door:          house.makeDoor,
};

export function createItem(ctx, type, opts = {}) {
  const fn = BUILDERS[type];
  if (!fn) throw new Error('[items] unknown item type: ' + type);
  return fn(ctx, opts);
}

export { nature, vehicles, infrastructure, furniture, signs, house };
