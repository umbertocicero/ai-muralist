import * as THREE from 'three';
import { CONFIG } from './config.js';

// ===========================================================================
//  Tiny planet (Petit Prince) wrapping.
//
//  The whole simulation — city generation, collision, the agent, KAI's walk —
//  stays in the original FLAT (x, z) coordinate system. Only the *rendering* is
//  wrapped onto a small sphere: every flat ground point (x, z) at height y is
//  mapped onto a sphere of radius R via an azimuth-equidistant projection from
//  the north pole, so the town forms a cap on top of a little planet you can
//  orbit like Google Earth.
//
//    ρ = hypot(x, z)         arc distance from the pole
//    φ = atan2(x, z)         azimuth around the pole
//    θ = ρ / R               polar angle (so arc length on the sphere = ρ)
//    dir = (sinθ sinφ, cosθ, sinθ cosφ)
//    point = dir · (R + y)
//
//  Objects keep their shape (rigid): they're repositioned to dir·(R+y) and
//  re-oriented so their local +Y points along `dir`, with a transport rotation
//  Ry(φ)·Rx(θ)·Ry(-φ) that also carries their heading. Normals come along for
//  free, so lighting and shadows stay correct.
// ===========================================================================

export const PLANET_R = CONFIG.planet.radius;

const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _qt = new THREE.Quaternion();

// flat ground point (x, z) at height y → world point on the planet
export function planetPoint(x, y, z, out = new THREE.Vector3(), R = PLANET_R) {
  const rho = Math.hypot(x, z);
  const phi = Math.atan2(x, z);
  const theta = rho / R;
  const st = Math.sin(theta), ct = Math.cos(theta);
  return out.set(st * Math.sin(phi), ct, st * Math.cos(phi)).multiplyScalar(R + y);
}

// outward (up) unit normal at flat (x, z)
export function planetUp(x, z, out = new THREE.Vector3(), R = PLANET_R) {
  const rho = Math.hypot(x, z);
  const phi = Math.atan2(x, z);
  const theta = rho / R;
  const st = Math.sin(theta), ct = Math.cos(theta);
  return out.set(st * Math.sin(phi), ct, st * Math.cos(phi));
}

// transport quaternion taking the north-pole frame to the surface frame at (x, z)
export function planetQuat(x, z, out = new THREE.Quaternion(), R = PLANET_R) {
  const rho = Math.hypot(x, z);
  const phi = Math.atan2(x, z);
  const theta = rho / R;
  _qa.setFromAxisAngle(_yAxis, phi);
  _qb.setFromAxisAngle(_xAxis, theta);
  _qc.setFromAxisAngle(_yAxis, -phi);
  return out.copy(_qa).multiply(_qb).multiply(_qc);
}

// Place an object on the planet. `x,z` = flat ground anchor, `y` = height above
// the ground (defaults to the object's current .position.y). `baseQuat` is the
// object's flat orientation (defaults to its current quaternion) and is carried
// through the transport rotation.
export function placeOnPlanet(obj, x, y, z, baseQuat, R = PLANET_R) {
  if (y === undefined) y = obj.position.y;
  if (baseQuat === undefined) baseQuat = _qt.copy(obj.quaternion);
  planetPoint(x, y, z, obj.position, R);
  planetQuat(x, z, obj.quaternion, R);
  obj.quaternion.multiply(baseQuat);
}
