import * as THREE from 'three';

// ===========================================================================
//  Shared materials + geometries used by BOTH the city layout (city.js) and the
//  parametric item factory (js/items/*). Kept in one place so a window pane on a
//  facade and the pane on a vending machine are literally the same material —
//  one GL state, one source of truth.
//
//  polygonOffset pushes glass/shutter panes a hair in front of their wall in
//  depth so they never z-fight it (the cause of "striped" windows at a distance).
// ===========================================================================

export const GLASS   = new THREE.MeshBasicMaterial({ color: '#2b2b2b', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
export const SHUTTER = new THREE.MeshBasicMaterial({ color: '#9a9894', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

// Foliage tones + one shared blob geometry (scaled per leaf).
export const LEAF     = ['#2c2a26', '#363430', '#23211d', '#3c3a34'];
export const LEAF_GEO = new THREE.IcosahedronGeometry(1, 0);
