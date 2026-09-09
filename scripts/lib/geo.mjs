// Shared geometry helpers for the map-data build scripts (build-routes.mjs,
// build-basemap.mjs). Both scripts must agree byte-for-byte on projection and
// simplification math, or their outputs (bus routes, street basemap) will
// visibly drift apart on screen. Keep this file as the single source of
// truth for that math rather than letting either script re-derive it.

// Web Mercator (EPSG:3857) — the standard projection for web maps, not a
// choice local to this project; GTFS itself specifies none, only that lat/lon
// are WGS84. Returning a 0..1 fraction of the world rather than the metres
// PostGIS/proj4 emit is just a unit choice, since we scale to a viewBox rather
// than to tiles (multiply by 2^zoom and you get OSM tile coordinates). x is
// plain arithmetic because meridians are evenly spaced; y needs a logarithm
// because parallels are not.
export const merc = (lat, lon) => {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
};

// Builds a projector for a given lat/lon bounding box and target viewBox
// width. Height is derived from the projected aspect ratio, never hardcoded,
// so the map is never stretched regardless of how the route network's
// bounding box changes shape between feed updates. A single `scale` is used
// for both axes (rather than independently fitting width and height) so the
// map isn't stretched — Mercator is conformal only if x and y share a scale.
export function makeProjector({ minLat, maxLat, minLon, maxLon, viewBoxWidth }) {
  const [x0] = merc(0, minLon); // west edge in world coordinates
  const [x1] = merc(0, maxLon); // east edge
  const [, y0] = merc(maxLat, 0); // north edge -> smaller y (top of the SVG)
  const [, y1] = merc(minLat, 0); // south edge -> larger y (bottom of the SVG)

  const viewBoxHeight = Math.round((viewBoxWidth * (y1 - y0)) / (x1 - x0));
  const scale = viewBoxWidth / (x1 - x0);

  function project(lat, lon) {
    const [mx, my] = merc(lat, lon);
    return [(mx - x0) * scale, (my - y0) * scale];
  }

  return { project, scale, viewBoxHeight, x0, x1, y0, y1 };
}

// ---------------------------------------------------------------------------
// Douglas-Peucker simplification
// ---------------------------------------------------------------------------
// Simplification runs in PROJECTED PIXEL space, not lat/lon, for two reasons:
// epsilon is a pixel tolerance (it needs to mean "a quarter of a screen
// pixel" regardless of zoom/viewBox scale), and a degree of longitude and a
// degree of latitude are not the same physical distance (at Omaha's latitude
// a degree of longitude is roughly 3/4 the length of a degree of latitude),
// so measuring distance directly in lat/lon degrees would simplify east-west
// wiggles far more aggressively than north-south ones for no good reason.
//
// 0.25 px is deliberately tight: at ~37 m/px that's about 9 m of allowed
// deviation. An OpenStreetMap street basemap will sit underneath these paths,
// and a looser tolerance is visibly enough to slide a route line off the
// street it's supposed to be tracing.
//
// The algorithm: given a polyline from index `start` to `end`, find the point
// between them that is farthest (perpendicularly) from the straight segment
// connecting the endpoints. If that farthest distance exceeds epsilon, the
// segment isn't a good enough approximation — keep that farthest point and
// recurse on the two halves it splits the range into. If no point exceeds
// epsilon, every point in between is redundant (it's already well
// approximated by the straight line) and all of them are discarded.
//
// This is implemented iteratively with an explicit array-as-stack of
// [start, end] index ranges still to be checked, rather than recursively.
// A recursive version is simpler to write, but its call-stack depth tracks
// the *shape* of the simplification tree, not just its size: a long, gently
// curving shape (exactly what transit route shapes look like) can force deep,
// unbalanced recursion. An explicit stack has no call-depth limit — it's
// bounded only by heap memory, which ~30,000 points comes nowhere near.
export function perpendicularDistance(point, segStart, segEnd) {
  const [px, py] = point;
  const [ax, ay] = segStart;
  const [bx, by] = segEnd;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // Project the point onto the *line* through (ax,ay)-(bx,by) and measure
  // how far along the segment that projection falls, as a fraction `t`.
  // Clamping t to [0, 1] is what makes this a distance to the SEGMENT rather
  // than to the infinite line: without the clamp, a point almost even with
  // one endpoint but off to the side would measure its distance to a spot
  // far beyond that endpoint on the extended line, understating how far it
  // actually strays from the drawn segment.
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  const ddx = px - closestX;
  const ddy = py - closestY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

export function simplifyDouglasPeucker(points, epsilon) {
  const n = points.length;
  if (n < 3) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end <= start + 1) continue; // no interior points left to consider

    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }

    if (maxDist > epsilon) {
      // The chord from start to end isn't a good enough stand-in for this
      // range — keep the worst offender and re-check both halves it creates.
      keep[maxIndex] = 1;
      stack.push([start, maxIndex]);
      stack.push([maxIndex, end]);
    }
    // Otherwise every point in (start, end) is within epsilon of the chord
    // already, so none of them get flagged and they're all dropped.
  }

  const result = [];
  for (let i = 0; i < n; i++) if (keep[i]) result.push(points[i]);
  return result;
}

// Distance from a point to the nearest segment of a polyline (the minimum of
// perpendicularDistance over every consecutive pair of polyline vertices).
// Used below to check simplification quality: how far did we let the drawn
// line stray from where the original GTFS shape actually was?
function distanceToPolyline(point, polyline) {
  let minDist = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const d = perpendicularDistance(point, polyline[i - 1], polyline[i]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function maxPointToPolylineDistance(points, polyline) {
  let maxDist = 0;
  for (const point of points) {
    const d = distanceToPolyline(point, polyline);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

// One decimal place is about 3.7 m of precision (0.1 px * ~37 m/px) — far
// below anything visible on screen — and roughly halves the string length
// versus full float precision, which matters once this repeats 3,200 times.
export function toPathString(points) {
  return "M" + points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
}

// Reparses our own emitted "d" string ("M12.3 45.6L78.9 10.1L...") back into
// [x, y] pairs, so the rounded output can be checked the same way the
// unrounded simplification is checked.
export function parsePathString(d) {
  return d
    .slice(1) // drop the leading "M"
    .split("L")
    .map((pair) => pair.split(" ").map(Number));
}
