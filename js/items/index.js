import * as nature from './nature.js';
import * as props from './props.js';

// ===========================================================================
//  Item factory. The city no longer hand-builds these props inline; it calls
//  createItem(ctx, type, opts). Each item lives in this folder as a small,
//  parametric builder, registered here by name. Adding a new prop = drop a
//  builder in nature.js / props.js (or a new module) and add one line below.
//
//  `ctx` is the City instance (provides scene, rng, _rand, colliders, lampHeads);
//  `opts` parametrise the item (size, height, angle, fullness, …).
// ===========================================================================

const BUILDERS = {
  // greenery (nature.js)
  leaf:    nature.makeLeaf,
  bush:    nature.makeBush,
  tree:    nature.makeTree,
  plant:   nature.makePottedPlant,
  vine:    nature.makeVine,
  // street furniture (props.js)
  bicycle:       props.makeBicycle,
  vending:       props.makeVendingMachine,
  cone:          props.makeTrafficCone,
  bench:         props.makeBench,
  lamppost:      props.makeLamppost,
  antenna:       props.makeAntenna,
  waterTower:    props.makeWaterTower,
  plankFence:    props.makePlankFence,
  acUnit:        props.makeAcUnit,
  nobori:        props.makeNobori,
  planterBox:    props.makePlanterBox,
  roadSign:      props.makeRoadSign,
  curveMirror:   props.makeCurveMirror,
  aFrameBarrier: props.makeAFrameBarrier,
  scooter:       props.makeScooter,
  stairs:        props.makeStairs,
  keiCar:        props.makeKeiCar,
};

export function createItem(ctx, type, opts = {}) {
  const fn = BUILDERS[type];
  if (!fn) throw new Error('[items] unknown item type: ' + type);
  return fn(ctx, opts);
}

export { nature, props };
