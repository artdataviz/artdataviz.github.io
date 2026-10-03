// Sphere maths shared by the runtime's parts. Plain arrays, no three.js, so
// node can test it (tests/js/geo.test.mjs).
//
// Axes: the Python side is z-up (quilling.worldio.lonlat_to_xyz). three.js is
// y-up. Python (x, y, z) is three (x, z, -y): a rotation, so the tangent frame
// below is tiles.frame_basis's exactly, and the baked tangent-space normals
// (east in R, north in G) light the same way they were baked.

const D = Math.PI / 180;

export function lonLatToVec(lon, lat, r = 1) {
  const cl = Math.cos(lat * D);
  return [r * cl * Math.cos(lon * D), r * Math.sin(lat * D), -r * cl * Math.sin(lon * D)];
}

export function vecToLonLat([x, y, z]) {
  return [Math.atan2(-z, x) / D, Math.atan2(y, Math.hypot(x, z)) / D];
}

// Outward, east and north unit vectors at lon/lat: tiles.frame_basis, rotated.
export function frameAt(lon, lat) {
  const sl = Math.sin(lon * D), cl = Math.cos(lon * D);
  const sp = Math.sin(lat * D), cp = Math.cos(lat * D);
  return {
    up: [cp * cl, sp, -cp * sl],
    east: [-sl, 0, -cl],
    north: [-sp * cl, cp, sp * sl],
  };
}

// Distance along a unit ray to the near side of a centred sphere, or null.
export function raySphere(o, dir, r) {
  const b = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// Angle from the sub-camera point to where a ray `a` off the view axis meets
// the sphere, for a camera at distance d looking at the centre. The horizon
// when the ray misses.
function groundAngle(a, d, r) {
  const b = d * Math.sin(a);
  if (b >= r) return Math.acos(r / d);
  const t = d * Math.cos(a) - Math.sqrt(r * r - b * b);
  return Math.atan2(t * Math.sin(a), d - t * Math.cos(a));
}

// The great-circle span the view covers across, in degrees, for a camera at
// distance d with half-angle `half` (radians) along that direction.
export function degreesAcross(d, r, half) {
  return (2 * groundAngle(half, d, r)) / D;
}

// The camera distance at which the view spans `deg` degrees across.
export function distanceForDegrees(deg, r, half) {
  let lo = r * (1 + 1e-9), hi = r * 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (degreesAcross(mid, r, half) < deg) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Angular radius, in degrees, of the patch of sphere the camera can see: the
// view cone's reach along the half-diagonal, or the horizon, whichever is less.
export function visibleCapDeg(d, r, halfDiagonal) {
  return groundAngle(halfDiagonal, d, r) / D;
}

export function angleBetweenDeg(lonLatA, lonLatB) {
  const a = lonLatToVec(...lonLatA), b = lonLatToVec(...lonLatB);
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, c))) / D;
}
