// Which bake tiles to draw and fetch. Plain data in, plain data out; baked.js
// does the three.js part. Tested in tests/js/bakegrid.test.mjs.
//
// Input is bake/<level>/tiles.json from scripts/stage_site.py: rows run south to
// north (y = 0 starts at lat -90), columns west to east from lon -180, and each
// level-n tile (x, y) splits into four level-(n+1) tiles (2x..2x+1, 2y..2y+1).
//
// The rule is the spec's: a level serves while its texel stays under about 1.2
// device pixels, and the next level takes over where it does not. A parent stays
// wanted under its children, so a child still loading shows the parent, never a hole.

import { angleBetweenDeg, lonLatToVec } from "./geo.js";

const D = Math.PI / 180;
export const MAX_TEXEL_PX = 1.2;

export function parseLevel(json) {
  const { level, cols, rows, tilePx } = json;
  const tiles = json.tiles.map(([x, y, lon0, lat0, lon1, lat1, colourBytes, surfaceBytes]) => {
    const centre = [(lon0 + lon1) / 2, (lat0 + lat1) / 2];
    const radiusDeg = Math.max(...[[lon0, lat0], [lon1, lat0], [lon0, lat1], [lon1, lat1]]
      .map((c) => angleBetweenDeg(centre, c)));
    return { level, x, y, lon0, lat0, lon1, lat1, colourBytes, surfaceBytes, tilePx,
             centre, radiusDeg, key: `${level}/${y}/${x}` };
  });
  const byXY = new Map(tiles.map((t) => [t.y * cols + t.x, t]));
  const at = (x, y) => byXY.get(y * cols + x);
  const tileAt = (lon, lat) => at(
    Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols))),
    Math.min(rows - 1, Math.max(0, Math.floor(((lat + 90) / 180) * rows))));
  return { level, cols, rows, tilePx, tiles, at, tileAt };
}

export function childrenOf(t) {
  const x = 2 * t.x, y = 2 * t.y;
  return [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
}

// view: { camPos, sub: [lon, lat] under the camera, radius, capDeg, focalPx }
function visible(t, view) {
  return angleBetweenDeg(t.centre, view.sub) < view.capDeg + t.radiusDeg;
}

export function visibleTiles(level, view) {
  return level.tiles.filter((t) => visible(t, view));
}

// The largest a texel of this tile gets on screen, in device pixels: its
// north-south size on the ground, seen from the point of the tile nearest the camera.
export function texelPixels(t, view) {
  const texelMm = ((t.lat1 - t.lat0) / t.tilePx) * D * view.radius;
  const halfLon = (t.lon1 - t.lon0) / 2;
  const dl = ((((view.sub[0] - t.centre[0]) % 360) + 540) % 360) - 180;
  const lon = t.centre[0] + Math.max(-halfLon, Math.min(halfLon, dl));
  const lat = Math.max(t.lat0, Math.min(t.lat1, view.sub[1]));
  const p = lonLatToVec(lon, lat, view.radius);
  const dist = Math.hypot(view.camPos[0] - p[0], view.camPos[1] - p[1], view.camPos[2] - p[2]);
  return (texelMm * view.focalPx) / dist;
}

// Every tile to draw, parents under children: coarser levels first, so the globe
// is whole after a few fetches, and within a level the view's centre first.
export function selectTiles(levels, view, maxPx = MAX_TEXEL_PX) {
  const out = [];
  const walk = (t, depth) => {
    out.push(t);
    const next = levels[depth + 1];
    if (!next || texelPixels(t, view) <= maxPx) return;
    for (const [x, y] of childrenOf(t)) {
      const c = next.at(x, y);
      if (c && visible(c, view)) walk(c, depth + 1);
    }
  };
  for (const t of visibleTiles(levels[0], view)) walk(t, 0);
  const dist = new Map(out.map((t) => [t.key, angleBetweenDeg(t.centre, view.sub)]));
  return out.sort((a, b) => a.level - b.level || dist.get(a.key) - dist.get(b.key));
}
