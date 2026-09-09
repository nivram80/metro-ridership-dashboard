// Converts cached OpenStreetMap Overpass API responses into pre-projected SVG
// path strings for a street/water basemap, drawn UNDERNEATH the bus routes
// produced by build-routes.mjs.
//
// Source: OpenStreetMap, via the Overpass API
//         https://overpass-api.de/api/interpreter
// Data © OpenStreetMap contributors, licensed under the Open Database
// License (ODbL) — https://www.openstreetmap.org/copyright. Any UI that
// renders this basemap MUST display "© OpenStreetMap contributors" visibly;
// that's a licence obligation, not decoration.
//
// Run:  node scripts/build-basemap.mjs           (use the cached osm/*.json)
//       node scripts/build-basemap.mjs --refresh  (re-fetch from Overpass)
//
// The cache lives at osm/osm-roads.json and osm/osm-water.json, fetched with
// bbox 41.1236,-96.2282,41.3625,-95.7666 — the route bounding box now that
// build-routes.mjs pads it 8% on each side, so roads don't visibly stop short
// at the map edge.
// The exact Overpass QL queries used to build the cache are recorded below as
// constants, so a refresh is reproducible rather than "whatever query someone
// typed into overpass-turbo that day."
//
// THE HARD REQUIREMENT: this basemap must land in exactly the same coordinate
// system as data/routes-geo.json. It reads that file's bounds/viewBox and
// reuses the shared makeProjector() from scripts/lib/geo.mjs rather than
// recomputing anything — if the two files ever disagree on projection by even
// a fraction of a pixel, streets and bus routes visibly drift apart. See the
// "Coordinate-system assertions" section below for how this is verified on
// every run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeProjector, simplifyDouglasPeucker, toPathString } from "./lib/geo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = "41.1236,-96.2282,41.3625,-95.7666";

// Overpass QL queries used to populate the cache. Recorded verbatim (not just
// described) so `--refresh` is reproducible and reviewable. Every class the
// query fetches is now drawn (see ROAD_CLASSES below) — motorway through
// tertiary — so there's no unused surplus in the cache to account for here.
const ROADS_QUERY = `
[out:json][timeout:120];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${BBOX});
out geom;
`.trim();

const WATER_QUERY = `
[out:json][timeout:120];
(
  way["natural"="water"](${BBOX});
  way["waterway"="river"](${BBOX});
);
out geom;
`.trim();

const ROADS_CACHE_PATH = join(repoRoot, "osm", "osm-roads.json");
const WATER_CACHE_PATH = join(repoRoot, "osm", "osm-water.json");

const refresh = process.argv.includes("--refresh");

// ---------------------------------------------------------------------------
// Fetch (or load cached) Overpass responses
// ---------------------------------------------------------------------------
// Overpass mirrors intermittently return a "server too busy" HTML page
// instead of JSON (HTTP 200, so a status check alone won't catch it) — always
// validate the response text starts with "{" before treating it as JSON or
// writing it to the cache.
async function fetchOverpass(query, label) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) {
    throw new Error(
      `Overpass response for ${label} doesn't look like JSON (mirror likely returned a "server too busy" page). ` +
        `First 200 chars: ${text.slice(0, 200)}`
    );
  }
  return text;
}

async function loadLayer(cachePath, query, label) {
  if (refresh) {
    console.log(`Fetching ${label} from Overpass...`);
    const text = await fetchOverpass(query, label);
    writeFileSync(cachePath, text);
    console.log(`Wrote ${cachePath} (${(text.length / 1024).toFixed(1)} KB)`);
    return JSON.parse(text);
  }
  if (!existsSync(cachePath)) {
    throw new Error(`Missing OSM cache: ${cachePath}\nRun with --refresh to fetch it from Overpass, or restore the cached file.`);
  }
  return JSON.parse(readFileSync(cachePath, "utf8"));
}

const roadsRaw = await loadLayer(ROADS_CACHE_PATH, ROADS_QUERY, "roads");
const waterRaw = await loadLayer(WATER_CACHE_PATH, WATER_QUERY, "water");

// ---------------------------------------------------------------------------
// Read the shared coordinate system from routes-geo.json — never recompute it
// ---------------------------------------------------------------------------
const routesGeoPath = join(repoRoot, "data", "routes-geo.json");
if (!existsSync(routesGeoPath)) {
  throw new Error(`Missing ${routesGeoPath}. Run "node scripts/build-routes.mjs" first to generate the shared coordinate system.`);
}
const routesGeo = JSON.parse(readFileSync(routesGeoPath, "utf8"));
const { minLat, maxLat, minLon, maxLon } = routesGeo.bounds;
const { project, viewBoxHeight } = makeProjector({ minLat, maxLat, minLon, maxLon, viewBoxWidth: routesGeo.viewBox.width });

// ---------------------------------------------------------------------------
// Coordinate-system assertions
// ---------------------------------------------------------------------------
// Prove — don't just assume — that this file's projector produces exactly the
// same viewBox as routes-geo.json's, and that the projected bounding-box
// corners land exactly on [0,0] and [width, height].
if (routesGeo.viewBox.width !== 900) {
  throw new Error(`Unexpected routes-geo.json viewBox width: ${routesGeo.viewBox.width} (expected 900)`);
}
if (viewBoxHeight !== routesGeo.viewBox.height) {
  throw new Error(`Computed viewBoxHeight (${viewBoxHeight}) does not match routesGeo.viewBox.height (${routesGeo.viewBox.height}).`);
}
const VIEWBOX_WIDTH = routesGeo.viewBox.width;
const VIEWBOX_HEIGHT = routesGeo.viewBox.height;

const cornerNW = project(maxLat, minLon); // top-left
const cornerSE = project(minLat, maxLon); // bottom-right
const X_TOLERANCE = 1e-6; // x is exact arithmetic (no logarithm), so this stays tight
// y goes through makeProjector's rounded viewBoxHeight (height is Math.round()-ed
// to an integer pixel count), so the true projected south edge can be up to
// ~0.5px off that rounded integer — that's expected, not a coordinate-system bug.
const Y_TOLERANCE = 0.5 + 1e-6;
if (Math.abs(cornerNW[0] - 0) > X_TOLERANCE || Math.abs(cornerNW[1] - 0) > X_TOLERANCE) {
  throw new Error(`Projected NW corner should land on [0, 0], got [${cornerNW[0]}, ${cornerNW[1]}]`);
}
if (Math.abs(cornerSE[0] - VIEWBOX_WIDTH) > X_TOLERANCE || Math.abs(cornerSE[1] - VIEWBOX_HEIGHT) > Y_TOLERANCE) {
  throw new Error(`Projected SE corner should land on [${VIEWBOX_WIDTH}, ${VIEWBOX_HEIGHT}], got [${cornerSE[0]}, ${cornerSE[1]}]`);
}

// Sample a handful of routes' own vertices and confirm they parse and fall
// within (or extremely near) the viewBox — a second, independent sanity
// check that both files agree on scale, beyond the corner-projection check
// above.
const sampleRoutes = routesGeo.routes.slice(0, 5);
for (const route of sampleRoutes) {
  for (const path of route.paths) {
    const pts = path.d
      .slice(1)
      .split("L")
      .map((pair) => pair.split(" ").map(Number));
    for (const [x, y] of pts) {
      if (x < -1 || x > VIEWBOX_WIDTH + 1 || y < -1 || y > VIEWBOX_HEIGHT + 1) {
        throw new Error(`Route ${route.id} vertex [${x}, ${y}] falls well outside the shared viewBox ${VIEWBOX_WIDTH}x${VIEWBOX_HEIGHT}.`);
      }
    }
  }
}

console.log(`Coordinate-system assertions passed:`);
console.log(`  viewBox: ${VIEWBOX_WIDTH}x${VIEWBOX_HEIGHT} (matches routes-geo.json exactly)`);
console.log(`  Projected NW bounds corner -> [${cornerNW[0].toFixed(6)}, ${cornerNW[1].toFixed(6)}] (expected [0, 0])`);
console.log(`  Projected SE bounds corner -> [${cornerSE[0].toFixed(6)}, ${cornerSE[1].toFixed(6)}] (expected [${VIEWBOX_WIDTH}, ${VIEWBOX_HEIGHT}])`);
console.log(`  ${sampleRoutes.length} sample routes' vertices all fall within the shared viewBox`);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const EPSILON_PX = 0.05; // same tolerance as build-routes.mjs — see its comment on why 0.05px

// Road classes to draw. Measured at eps 0.25 in the padded box: motorway+
// trunk+primary is ~27 KB gzipped, adding secondary brings it to ~49 KB, and
// adding tertiary on top reaches ~74 KB.
//
// Secondary is included because it is the level at which the cross-streets a
// bus actually turns onto become visible — without it a route appears to run
// between arterials through blank space.
//
// Tertiary is deliberately excluded. It was tried and rendered side by side:
// it costs ~27 KB gzipped (a 42% increase) and what it adds is minor
// residential streets — Rainwood, Ida, Mudhollow — which nobody uses to
// locate a bus route, while the extra mesh visibly competes with the coloured
// route lines the map exists to show. The one real loss is south-central
// Omaha, which is genuinely sparse at this level. The cache still holds
// tertiary (see ROADS_QUERY), so it can be reinstated here — but the better
// home for it is a lazy-loaded detail layer once the map gains zoom, where
// the bytes are only spent by users who zoom in far enough to benefit.
//
// Visual hierarchy (see route-map.js) is what keeps four classes of road from
// reading as a uniform grey mat.
const ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary"];

const EDGE_PAD_PX = 30; // keep a way if any point falls within the viewBox padded by this much
const MIN_WATER_AREA_PX2 = 25; // closed water polygons smaller than this (shoelace) are dropped
const MIN_RIVER_LENGTH_PX = 20; // open river lines shorter than this (total length) are dropped

// ---------------------------------------------------------------------------
// Geometry helpers local to basemap processing
// ---------------------------------------------------------------------------
function isWithinPaddedViewBox([x, y]) {
  return x >= -EDGE_PAD_PX && x <= VIEWBOX_WIDTH + EDGE_PAD_PX && y >= -EDGE_PAD_PX && y <= VIEWBOX_HEIGHT + EDGE_PAD_PX;
}

function wayAnyPointVisible(points) {
  return points.some(isWithinPaddedViewBox);
}

// Shoelace formula: signed area of a (possibly non-convex) polygon from its
// vertices. Used to drop closed water polygons too small to read at this
// scale (e.g. tiny stormwater ponds) before they're even simplified.
function shoelaceArea(points) {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function isClosed(geometry) {
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  return first.lat === last.lat && first.lon === last.lon;
}

// ---------------------------------------------------------------------------
// Process roads
// ---------------------------------------------------------------------------
// Road layers are derived from ROAD_CLASSES rather than listed again here, so
// adding a class in one place cannot leave this object missing its bucket.
const layers = { ...Object.fromEntries(ROAD_CLASSES.map((c) => [c, []])), water: [], river: [] };

const stats = {
  roads: { waysSeen: 0, waysKept: 0, pointsBefore: 0, pointsAfter: 0, droppedOffscreen: 0 },
  water: { waysSeen: 0, waysKept: 0, pointsBefore: 0, pointsAfter: 0, droppedOffscreen: 0, droppedSmallArea: 0 },
  river: { waysSeen: 0, waysKept: 0, pointsBefore: 0, pointsAfter: 0, droppedOffscreen: 0, droppedShort: 0 },
};

// Candidate label sources, collected alongside the drawn paths (one entry per
// way on a DRAWN class with usable text) and reduced to `labels` below. Built
// from the full (unsimplified) projected geometry, not the Douglas-Peucker
// output above — that simplification exists to shrink stroked line data, and
// there's no reason to let it also blur where a label's midpoint/angle land.
const labelCandidates = [];

for (const el of roadsRaw.elements) {
  const highway = el.tags && el.tags.highway;
  if (!ROAD_CLASSES.includes(highway)) continue;
  if (!el.geometry || el.geometry.length < 2) continue;

  stats.roads.waysSeen++;
  const projected = el.geometry.map((p) => project(p.lat, p.lon));
  stats.roads.pointsBefore += projected.length;

  if (!wayAnyPointVisible(projected)) {
    stats.roads.droppedOffscreen++;
    continue;
  }

  const simplified = projected.length < 3 ? projected : simplifyDouglasPeucker(projected, EPSILON_PX);
  stats.roads.pointsAfter += simplified.length;
  stats.roads.waysKept++;

  layers[highway].push(toPathString(simplified));

  const tags = el.tags || {};
  // Motorways are best identified by their route ref ("I 80"); a name would
  // usually just repeat the freeway's informal name or be absent entirely.
  // Everything else (trunk/primary) uses the street name instead, since those
  // rarely carry a meaningful ref.
  let text;
  if (highway === "motorway" && tags.ref) {
    // OSM concurrency refs are semicolon-separated ("I 480;US 75") — only the
    // first is used, rather than trying to render or dedupe a compound label.
    text = tags.ref.split(";")[0].trim();
  } else if (tags.name) {
    text = tags.name;
  }
  if (!text) continue;

  // `nodes` (OSM node ids, aligned 1:1 with `projected`) is what lets the
  // reduction step below tell whether two ways are physically the same road
  // continuing past an intersection, versus two unrelated roads that happen
  // to share a name.
  labelCandidates.push({ text, highway, projected, nodes: el.nodes, length: polylineLength(projected) });
}

// ---------------------------------------------------------------------------
// Process water (closed polygons -> lakes; open lines -> rivers)
// ---------------------------------------------------------------------------
for (const el of waterRaw.elements) {
  const tags = el.tags || {};
  const isRiverTag = tags.waterway === "river";
  const isWaterTag = tags.natural === "water";
  if (!isRiverTag && !isWaterTag) continue;
  if (!el.geometry || el.geometry.length < 2) continue;

  const closed = isClosed(el.geometry);
  const projected = el.geometry.map((p) => project(p.lat, p.lon));

  if (closed) {
    // Closed water polygon -> "water" layer (filled lakes/ponds).
    stats.water.waysSeen++;
    stats.water.pointsBefore += projected.length;

    if (!wayAnyPointVisible(projected)) {
      stats.water.droppedOffscreen++;
      continue;
    }

    const area = shoelaceArea(projected);
    if (area < MIN_WATER_AREA_PX2) {
      stats.water.droppedSmallArea++;
      continue;
    }

    const simplified = projected.length < 3 ? projected : simplifyDouglasPeucker(projected, EPSILON_PX);
    stats.water.pointsAfter += simplified.length;
    stats.water.waysKept++;
    layers.water.push(toPathString(simplified) + "Z");
  } else {
    // Open way -> "river" layer (stroked centerlines). Do NOT area-filter —
    // the shoelace area of an open centerline is meaningless.
    stats.river.waysSeen++;
    stats.river.pointsBefore += projected.length;

    if (!wayAnyPointVisible(projected)) {
      stats.river.droppedOffscreen++;
      continue;
    }

    const length = polylineLength(projected);
    if (length < MIN_RIVER_LENGTH_PX) {
      stats.river.droppedShort++;
      continue;
    }

    const simplified = projected.length < 3 ? projected : simplifyDouglasPeucker(projected, EPSILON_PX);
    stats.river.pointsAfter += simplified.length;
    stats.river.waysKept++;
    layers.river.push(toPathString(simplified));
  }
}

// ---------------------------------------------------------------------------
// Build street labels from labelCandidates
// ---------------------------------------------------------------------------
const MIN_LABEL_WAY_LENGTH_PX = 25; // too short a stretch to be worth naming

// Walk the way's projected points by cumulative arc length and return the
// [x, y] sitting at `targetLength` along the polyline, clamped to the
// polyline's actual ends (targetLength < 0 -> first point, > total -> last).
function pointAtLength(points, targetLength) {
  if (targetLength <= 0) return points[0];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    if (walked + segLen >= targetLength) {
      const t = segLen === 0 ? 0 : (targetLength - walked) / segLen;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    walked += segLen;
  }
  return points[points.length - 1];
}

// A road's position is a point somewhere along its stitched chain (see
// CANDIDATE_FRACTIONS below for which points get tried). The label's ANGLE,
// though, is deliberately not just the local segment direction at that one
// point: a long, basically-straight arterial still has plenty of
// single-segment jogs (a slight offset at an intersection, a
// construction-era kink) that would tilt the label even though the road
// reads as straight. Instead, walk BEARING_WINDOW_PX out from the chosen
// point in each direction along the polyline and take the bearing of the
// chord between those two window endpoints — that averages out local jogs
// while still following genuine curvature over a longer stretch.
//
// That window has to actually fit: a point too near either end of the chain
// would have its window silently clamped down to something much shorter
// (and, right at an end, close to zero-length), producing a noisy or
// meaningless bearing rather than a merely imprecise one. Positions where
// the window doesn't fully fit are reported as unusable (null) rather than
// computed anyway — see CANDIDATE_FRACTIONS below for how the caller reacts.
const BEARING_WINDOW_PX = 30;
function positionAndBearingAt(points, fraction) {
  const total = polylineLength(points);
  const target = total * fraction;
  if (target - BEARING_WINDOW_PX < 0 || target + BEARING_WINDOW_PX > total) return null;
  const [x, y] = pointAtLength(points, target);
  const [wx0, wy0] = pointAtLength(points, target - BEARING_WINDOW_PX);
  const [wx1, wy1] = pointAtLength(points, target + BEARING_WINDOW_PX);
  let angle = (Math.atan2(wy1 - wy0, wx1 - wx0) * 180) / Math.PI;
  // Never let text render upside down: a bearing outside -90..90 reads
  // upside down along its own baseline, so flip it 180 degrees back into
  // range — atan2's output can land on either side of -90/90, so the
  // correction direction (+180 vs -180) has to match which side it's on.
  if (angle < -90) angle += 180;
  else if (angle > 90) angle -= 180;
  return { x, y, angle };
}

// OSM chops a single physical road into a separate "way" at nearly every
// intersection, so most individual ways are only a block long — nowhere near
// MIN_LABEL_WAY_LENGTH_PX. "The longest way for a name" only makes sense once
// those blocks are stitched back into the continuous road they actually
// form. Ways sharing a name are merged into one polyline wherever they share
// an OSM node id at an endpoint, and the longest resulting stretch is what
// gets labeled.
function mergeConnectedWays(ways) {
  // Union-find over way indices, unioned whenever two ways share an endpoint
  // node id (i.e. they meet at an intersection with no other name change).
  const parent = ways.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const endpointOwner = new Map(); // node id -> way index that first claimed it
  ways.forEach((w, i) => {
    for (const nodeId of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
      const owner = endpointOwner.get(nodeId);
      if (owner === undefined) endpointOwner.set(nodeId, i);
      else union(owner, i);
    }
  });

  const groups = new Map(); // root -> way indices
  ways.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });

  // A divided highway (separate carriageways per direction) is common enough
  // in this data that it needs its own handling: both carriageways share the
  // road's name and meet at each end, so union-find alone treats them as ONE
  // connected group shaped like a narrow loop, not a line. A walk that just
  // takes the first unvisited way at each junction has no way to tell "the
  // road continues" from "the only way out is a U-turn onto the parallel
  // carriageway" — it'll happily walk all the way down one carriageway and
  // back up the other, doubling the length and putting the midpoint at the
  // U-turn itself (which is exactly why South 72nd Street's label used to
  // come out pointing almost due east: the "midpoint" sat at the road's
  // south end cul-de-sac, not partway along it).
  //
  // Fix: at each junction, only extend onto whichever unvisited way keeps
  // the walk going roughly the same direction it was already headed
  // (smallest turn angle), and refuse to extend at all once every remaining
  // option is closer to a reversal than a continuation. A real intersection
  // bends the road by some modest angle and keeps going; a carriageway
  // U-turn reverses it. TURN_LIMIT_DEG separates the two.
  const TURN_LIMIT_DEG = 120;
  function angleBetween(v1, v2) {
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const det = v1[0] * v2[1] - v1[1] * v2[0];
    return Math.abs((Math.atan2(det, dot) * 180) / Math.PI); // 0 = same direction, 180 = reversed
  }
  // A single segment's direction is noisy at junctions (short stub segments,
  // rounding), so directions are measured a short distance in from the
  // connecting node rather than to the very next raw point.
  const DIRECTION_LOOKAHEAD_PX = 5;
  // Direction of travel arriving at the END of `points` (pointing the way
  // the walk is already headed).
  function tailDirection(points) {
    const total = polylineLength(points);
    const [ox, oy] = pointAtLength(points, total - DIRECTION_LOOKAHEAD_PX);
    const [tx, ty] = points[points.length - 1];
    return [tx - ox, ty - oy];
  }
  // Direction of travel leaving the START of `points` (pointing the way a
  // walk would head if it continued onto this way from its first point).
  function headDirection(points) {
    const [ox, oy] = points[0];
    const [tx, ty] = pointAtLength(points, DIRECTION_LOOKAHEAD_PX);
    return [tx - ox, ty - oy];
  }

  // Within each connected group, walk it into a single ordered polyline,
  // starting from a chain end (a node touched by only one way in the group)
  // when one exists, and greedily extending through shared endpoint nodes,
  // always preferring the straightest available continuation (see above).
  return [...groups.values()].map((indices) => {
    const groupWays = indices.map((i) => ways[i]);
    const nodeUseCount = new Map();
    for (const w of groupWays) {
      for (const nodeId of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
        nodeUseCount.set(nodeId, (nodeUseCount.get(nodeId) || 0) + 1);
      }
    }
    const leafWay = groupWays.find((w) => nodeUseCount.get(w.nodes[0]) === 1 || nodeUseCount.get(w.nodes[w.nodes.length - 1]) === 1);
    const startWay = leafWay || groupWays[0];
    const startsAtFirstNode = !leafWay || nodeUseCount.get(startWay.nodes[0]) === 1;

    const used = new Set([startWay]);
    let points = startsAtFirstNode ? startWay.projected.slice() : startWay.projected.slice().reverse();
    let tailNode = startsAtFirstNode ? startWay.nodes[startWay.nodes.length - 1] : startWay.nodes[0];
    let highwayForLength = { highway: startWay.highway, length: startWay.length };

    let extended = true;
    while (extended) {
      extended = false;
      const incomingDir = tailDirection(points); // chain's current direction of travel, at its tail
      let best = null; // { way, reversed, turnDeg }
      for (const w of groupWays) {
        if (used.has(w)) continue;
        const firstNode = w.nodes[0];
        const lastNode = w.nodes[w.nodes.length - 1];
        let reversed;
        if (firstNode === tailNode) reversed = false;
        else if (lastNode === tailNode) reversed = true;
        else continue;
        const candidateDir = headDirection(reversed ? w.projected.slice().reverse() : w.projected);
        const turnDeg = angleBetween(incomingDir, candidateDir);
        if (!best || turnDeg < best.turnDeg) best = { way: w, reversed, turnDeg };
      }
      if (!best || best.turnDeg > TURN_LIMIT_DEG) break; // no continuation, only U-turns left
      const w = best.way;
      const nextPoints = best.reversed ? w.projected.slice().reverse() : w.projected;
      points = points.concat(nextPoints.slice(1));
      tailNode = best.reversed ? w.nodes[0] : w.nodes[w.nodes.length - 1];
      used.add(w);
      if (w.length > highwayForLength.length) highwayForLength = { highway: w.highway, length: w.length };
      extended = true;
    }

    return { points, length: polylineLength(points), highway: highwayForLength.highway };
  });
}

// Group candidates by label text, merge each text's ways into connected
// stretches, and keep only the single longest stretch per text — one label
// per road name, placed on its longest run.
const waysByText = new Map();
for (const c of labelCandidates) {
  if (!waysByText.has(c.text)) waysByText.set(c.text, []);
  waysByText.get(c.text).push(c);
}
const longestByText = new Map();
for (const [text, ways] of waysByText) {
  const merged = mergeConnectedWays(ways);
  let longest = merged[0];
  for (const m of merged) if (m.length > longest.length) longest = m;
  longestByText.set(text, { text, projected: longest.points, length: longest.length, highway: longest.highway });
}

// Drop near-duplicate freeway variants: if a label's text is another
// surviving label's text plus a trailing word ("I 80 Local" alongside
// "I 80"), the longer variant is redundant on the map and gets dropped.
// Simple substring/prefix check, not a general text-similarity algorithm —
// this only needs to catch the freeway ref-plus-suffix pattern OSM uses.
const texts = [...longestByText.keys()];
for (const text of texts) {
  const isSuffixVariant = texts.some((base) => base !== text && text.startsWith(base + " "));
  if (isSuffixVariant) longestByText.delete(text);
}

// Build one placement candidate per surviving (text, longest-run) pair —
// position, rotation, and an approximate rendered text box — before deciding
// which ones actually get drawn.
const FONT_SIZE_PX = 9.5;
const AVG_CHAR_WIDTH_EM = 0.5; // rough average glyph width for this font at this size
const TEXT_HEIGHT_PX = 10.5; // line height incl. a little vertical breathing room
const LABEL_BOX_PAD_PX = 2.5; // separation added on top of the raw text box so labels don't merely touch

// The text is drawn centered (text-anchor=middle) and rotated about (x, y),
// so its footprint is a w x h box centered on the anchor and rotated by
// `angle`. What matters for collision/edge checks is that box's AXIS-ALIGNED
// bounding box, which for a centered box rotated by `angle` is the standard
// rotated-rect formula: w*|cos| + h*|sin| by w*|sin| + h*|cos|.
function labelBox({ x, y, angle, text }) {
  // Unrotated text box: width from the average-char-width approximation
  // (textWidth ~= text.length * 4.75 at these constants), height from the
  // font's line box. Padding is added here, before rotation, so it reads as
  // "extra margin around the glyphs" on every side rather than only on the
  // box's eventual x/y axes.
  const rawW = text.length * AVG_CHAR_WIDTH_EM * FONT_SIZE_PX + LABEL_BOX_PAD_PX * 2;
  const rawH = TEXT_HEIGHT_PX + LABEL_BOX_PAD_PX * 2;
  // Axis-aligned extent of that box once rotated by `angle` (standard
  // rotated-rectangle bounding-box formula): w*|cos| + h*|sin| by
  // w*|sin| + h*|cos|.
  const rad = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const extentX = rawW * cos + rawH * sin;
  const extentY = rawW * sin + rawH * cos;
  return { minX: x - extentX / 2, maxX: x + extentX / 2, minY: y - extentY / 2, maxY: y + extentY / 2 };
}

function boxesOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function isWithinViewBox(box) {
  return box.minX >= 0 && box.maxX <= VIEWBOX_WIDTH && box.minY >= 0 && box.maxY <= VIEWBOX_HEIGHT;
}

// ---------------------------------------------------------------------------
// Abbreviate for display (standard US cartographic abbreviations)
// ---------------------------------------------------------------------------
// Display-only: this runs on the way OUT to placementCandidates, after every
// matching/grouping/dedup step above (waysByText grouping, mergeConnectedWays
// stitching, the suffix-variant dedup) has already run on the full OSM name.
// Those steps must keep comparing full names, or ways that are the same real
// road under OSM's naming would stop matching each other.
//
// Applied BEFORE the collision-placement pass below (not after): a shorter
// abbreviated string makes a smaller label box, which means fewer collisions
// and more labels surviving greedy placement — abbreviating first is what
// actually earns back some of the labels lost to collision dropping.
const SUFFIX_ABBREVIATIONS = {
  Street: "St", Road: "Rd", Avenue: "Ave", Boulevard: "Blvd",
  Highway: "Hwy", Expressway: "Expy", Parkway: "Pkwy", Drive: "Dr",
  Lane: "Ln", Court: "Ct", Place: "Pl", Circle: "Cir",
  Terrace: "Ter", Freeway: "Fwy", Bridge: "Br",
};
// Directional words abbreviate wherever they appear as a whole word — leading
// ("West Center Road"), trailing ("Fort Crook Road South"), or (rarely)
// mid-name — not just when leading. Compound directions are listed before
// their simple prefixes purely for readability; \b-anchored whole-word
// matching already keeps "North" from matching inside "Northwest", so the
// two groups can't collide with each other regardless of list order.
const DIRECTIONAL_ABBREVIATIONS = {
  Northwest: "NW", Northeast: "NE", Southwest: "SW", Southeast: "SE",
  North: "N", South: "S", East: "E", West: "W",
};

// Both maps merged into one lookup so a single regex pass can abbreviate
// every qualifying word in a name at once, rather than making separate
// trailing-only and leading-only passes over the string.
const ROAD_NAME_ABBREVIATIONS = { ...SUFFIX_ABBREVIATIONS, ...DIRECTIONAL_ABBREVIATIONS };
// \b on both sides, not just anchored at one end of the string: this is what
// makes "Fort Crook Road South" -> "Fort Crook Rd S" abbreviate BOTH words
// without also touching "Westbrook" (no word-boundary between "West" and
// "brook" — they're one token) or "Broadway" (contains the letters of "Road"
// but never as its own word, so \bRoad\b can't land on it either). Matching
// whole words, not positions, is what makes this safe to run everywhere at
// once instead of only at the string's edges.
const ABBREVIATION_RE = new RegExp(`\\b(${Object.keys(ROAD_NAME_ABBREVIATIONS).join("|")})\\b`, "g");

function abbreviateRoadName(name) {
  return name.replace(ABBREVIATION_RE, (word) => ROAD_NAME_ABBREVIATIONS[word]);
}

// Derived from ROAD_CLASSES, which is already in descending importance order.
// Listing the ranks separately meant that adding a class to ROAD_CLASSES left
// it absent here, so CLASS_RANK[cls] was undefined and the comparator returned
// NaN — which makes sort order implementation-defined, silently scattering
// those labels through the priority list instead of ranking them last.
const CLASS_RANK = Object.fromEntries(ROAD_CLASSES.map((cls, i) => [cls, i]));

// Each road gets several candidate positions along its chain, not just its
// midpoint, so two roads that happen to cross near their midpoints (e.g.
// Center St and S 42nd St, two perpendicular arterials) aren't forced to
// fight over the same single spot with only one able to win. The midpoint is
// tried first and preferred; the rest walk outward from it as fallbacks, in
// the order the greedy loop below will try them.
const CANDIDATE_FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8];

const placementCandidates = [];
for (const c of longestByText.values()) {
  if (c.length < MIN_LABEL_WAY_LENGTH_PX) continue;
  const positions = CANDIDATE_FRACTIONS.map((f) => positionAndBearingAt(c.projected, f)).filter(Boolean);
  if (positions.length === 0) continue; // chain too short for ANY position's window to fit
  placementCandidates.push({ text: abbreviateRoadName(c.text), positions, class: c.highway, length: c.length });
}

// Most important first: motorway ref shields beat trunk beat primary street
// names, and within a class a longer road is a more useful landmark than a
// short one. Walking the list in this order and keeping greedily is what
// makes dropping a label (for a collision or edge overflow) an acceptable
// tradeoff — it's always the LEAST useful of the two labels in conflict that
// gets dropped, never an arbitrary one.
placementCandidates.sort((a, b) => CLASS_RANK[a.class] - CLASS_RANK[b.class] || b.length - a.length);

// Derived from ROAD_CLASSES for the same reason CLASS_RANK is: a class added
// there without a matching bucket here would silently turn into `undefined++`
// (NaN) the first time a label of that class was placed, rather than 0.
const labelStats = Object.fromEntries(ROAD_CLASSES.map((c) => [c, 0]));
const labels = [];
const placedBoxes = [];
let placedAtFallbackPosition = 0; // labels placed at a non-midpoint candidate
let droppedForCollision = 0;
let droppedForEdgeOverflow = 0;
for (const cand of placementCandidates) {
  let placed = false;
  let anyPositionOnscreen = false; // did at least one candidate position clear the edge test?
  for (let i = 0; i < cand.positions.length; i++) {
    const pos = cand.positions[i];
    const box = labelBox({ ...pos, text: cand.text });
    // A label whose text would run off the map and get clipped mid-word
    // reads as a rendering bug to whoever's looking at it, not as "the map
    // is slightly cramped" — try the next candidate position rather than
    // ever placing a clipped one.
    if (!isWithinViewBox(box)) continue;
    anyPositionOnscreen = true;
    if (placedBoxes.some((placedBox) => boxesOverlap(box, placedBox))) continue;
    placedBoxes.push(box);
    labels.push({
      text: cand.text,
      x: Number(pos.x.toFixed(1)),
      y: Number(pos.y.toFixed(1)),
      angle: Number(pos.angle.toFixed(1)),
      class: cand.class,
    });
    labelStats[cand.class]++;
    if (i > 0) placedAtFallbackPosition++;
    placed = true;
    break;
  }
  if (!placed) {
    // A road only counts as "dropped for collision" if some position of its
    // was actually in-bounds and lost to an overlap; if every position ran
    // off the map, it's an edge-overflow drop instead. A road can't be both.
    if (anyPositionOnscreen) droppedForCollision++;
    else droppedForEdgeOverflow++;
  }
}

// The five biggest landmarks on this map must survive greedy placement. If
// one of them didn't, that's a sign the importance ordering above is wrong
// (or a genuinely conflicting higher-priority label needs its own fix) —
// not something to special-case around here.
const REQUIRED_LABELS = ["I 80", "I 680", "I 480", "Dodge St", "Center St"]; // post-abbreviation forms — these are what actually ends up in the output
const placedTexts = new Set(labels.map((l) => l.text));
const missingRequired = REQUIRED_LABELS.filter((t) => !placedTexts.has(t));
if (missingRequired.length > 0) {
  throw new Error(`Greedy label placement dropped required landmark label(s): ${missingRequired.join(", ")}. Investigate the ordering/collision logic rather than special-casing these back in.`);
}

// ---------------------------------------------------------------------------
// Validate every emitted path string
// ---------------------------------------------------------------------------
const PATH_RE = /^M[0-9.\-\sML]+Z?$/;
for (const [layerName, paths] of Object.entries(layers)) {
  for (const d of paths) {
    if (!PATH_RE.test(d)) {
      throw new Error(`Invalid path string in layer "${layerName}": ${d.slice(0, 80)}...`);
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const totalPointsBefore = stats.roads.pointsBefore + stats.water.pointsBefore + stats.river.pointsBefore;
const totalPointsAfter = stats.roads.pointsAfter + stats.water.pointsAfter + stats.river.pointsAfter;

const data = {
  generated: new Date().toISOString(),
  source: {
    name: "OpenStreetMap",
    attribution: "© OpenStreetMap contributors",
    license: "ODbL",
    licenseUrl: "https://www.openstreetmap.org/copyright",
    api: OVERPASS_URL,
    bbox: BBOX,
    fetched: roadsRaw.osm3s.timestamp_osm_base,
  },
  viewBox: { width: routesGeo.viewBox.width, height: routesGeo.viewBox.height },
  bounds: { minLat, maxLat, minLon, maxLon },
  simplification: {
    epsilonPx: EPSILON_PX,
    pointsBefore: totalPointsBefore,
    pointsAfter: totalPointsAfter,
  },
  // Listed here (not just implied by the keys of `layers`) so a consumer can
  // draw the right road groups, in the right stacking order, without having
  // to hardcode a class list of its own that could silently drift out of
  // sync with ROAD_CLASSES — that drift is exactly what left secondary roads
  // shipped in `layers` but never drawn by route-map.js.
  roadClasses: ROAD_CLASSES,
  layers,
  labels,
};

const outPath = join(repoRoot, "data", "basemap-geo.json");
const json = JSON.stringify(data, null, 2) + "\n";
writeFileSync(outPath, json);
const gzipped = gzipSync(Buffer.from(json));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("");
console.log("Layer summary:");
for (const cls of ROAD_CLASSES) {
  console.log(`  ${cls}: ${layers[cls].length} paths`);
}
console.log(`  water (closed lakes/ponds): ${layers.water.length} paths`);
console.log(`  river (open centerlines): ${layers.river.length} paths`);

console.log("");
console.log(`Street labels: ${labels.length} (of ${placementCandidates.length} roads with a usable position)`);
for (const cls of ROAD_CLASSES) {
  console.log(`  ${cls}: ${labelStats[cls]}`);
}
console.log(`  placed at a non-midpoint fallback position: ${placedAtFallbackPosition}`);
console.log(`  dropped for collision with a higher-priority label: ${droppedForCollision}`);
console.log(`  dropped for text overflowing the viewBox: ${droppedForEdgeOverflow}`);

console.log("");
console.log("Roads:");
console.log(`  Ways seen (motorway/trunk/primary): ${stats.roads.waysSeen}, kept: ${stats.roads.waysKept}, dropped offscreen: ${stats.roads.droppedOffscreen}`);
console.log(`  Points: ${stats.roads.pointsBefore.toLocaleString()} -> ${stats.roads.pointsAfter.toLocaleString()}`);

console.log("Water (closed polygons):");
console.log(
  `  Ways seen: ${stats.water.waysSeen}, kept: ${stats.water.waysKept}, dropped offscreen: ${stats.water.droppedOffscreen}, ` +
    `dropped small-area (< ${MIN_WATER_AREA_PX2}px²): ${stats.water.droppedSmallArea}`
);
console.log(`  Points: ${stats.water.pointsBefore.toLocaleString()} -> ${stats.water.pointsAfter.toLocaleString()}`);

console.log("River (open lines):");
console.log(
  `  Ways seen: ${stats.river.waysSeen}, kept: ${stats.river.waysKept}, dropped offscreen: ${stats.river.droppedOffscreen}, ` +
    `dropped short (< ${MIN_RIVER_LENGTH_PX}px): ${stats.river.droppedShort}`
);
console.log(`  Points: ${stats.river.pointsBefore.toLocaleString()} -> ${stats.river.pointsAfter.toLocaleString()}`);

const percentRemoved = (((totalPointsBefore - totalPointsAfter) / totalPointsBefore) * 100).toFixed(1);
console.log("");
console.log(`Total simplification: ${totalPointsBefore.toLocaleString()} points -> ${totalPointsAfter.toLocaleString()} points (${percentRemoved}% removed) at epsilon ${EPSILON_PX}px`);
console.log(`Output: ${outPath} (${(json.length / 1024).toFixed(1)} KB, ${(gzipped.length / 1024).toFixed(1)} KB gzipped)`);
