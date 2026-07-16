export const rand  = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Gallery/log thumbnail source for a mural's art field: SVG murals become an
// inline SVG data URI; raster murals (gpt-image pieces) already ARE a data URL.
export const muralThumb = (art) =>
  !art ? null : art.startsWith('data:') ? art : 'data:image/svg+xml;utf8,' + encodeURIComponent(art);

export function lerpAngle(a, b, f) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

export function rotateY2D(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}
