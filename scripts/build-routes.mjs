// Converts Omaha Metro's GTFS static feed into pre-projected SVG path strings
// so the browser does zero geometry math at runtime.
//
// Source: Omaha Metro GTFS static feed
//         https://www.ometro.com/wp-content/uploads/GTFSRT/google_transit.zip
// The feed publishes every route TWICE, once per service period (spring and
// fall schedules), under two different route_ids. This script picks whichever
// period covers today's date, dedupes to one route_id per route_short_name,
// picks the single longest shape per (route, direction), simplifies it with
// Douglas-Peucker in projected pixel space, and emits ready-to-draw "d"
// attributes plus an accessible display color per route.
//
// Run:  node scripts/build-routes.mjs [path-to-gtfs-dir]
//
// Defaults to <repo>/gtfs/. Re-run whenever Metro publishes a new GTFS export
// (new service period, changed shapes, or changed route colors) to regenerate
// data/routes-geo.json. Only routes.txt, trips.txt, shapes.txt, calendar.txt,
// and feed_info.txt are read — stops.txt, stop_times.txt, calendar_dates.txt,
// and agency.txt are not needed for route geometry.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { makeProjector, perpendicularDistance, simplifyDouglasPeucker, maxPointToPolylineDistance, toPathString, parsePathString } from "./lib/geo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const GTFS_DOWNLOAD_URL = "https://www.ometro.com/wp-content/uploads/GTFSRT/google_transit.zip";
const gtfsDir = resolve(process.argv[2] ?? join(repoRoot, "gtfs"));

const REQUIRED_FILES = ["routes.txt", "trips.txt", "shapes.txt", "calendar.txt", "feed_info.txt"];

if (!existsSync(gtfsDir)) {
  console.error(`GTFS directory not found: ${gtfsDir}`);
  console.error(`Download the feed from ${GTFS_DOWNLOAD_URL} and extract it there`);
  console.error(`(or pass a path: node scripts/build-routes.mjs <path-to-gtfs-dir>).`);
  process.exit(1);
}
for (const name of REQUIRED_FILES) {
  if (!existsSync(join(gtfsDir, name))) {
    console.error(`Missing required GTFS file "${name}" in ${gtfsDir}`);
    console.error(`Download the feed from ${GTFS_DOWNLOAD_URL} and extract it there.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
// GTFS files are CSV but not always tidy CSV: this feed's exports have shown
// a UTF-8 BOM on the first line and CRLF line endings, and the spec allows
// double-quoted fields containing commas or escaped "" quotes. A naive
// `line.split(",")` breaks on any of those, so this is a small character-by-
// character parser rather than a split.
function parseCsv(text) {
  // Strip a UTF-8 BOM if present (a bare split would otherwise glue it onto
  // the first header name and silently break every lookup on that column).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside a quoted field ("").
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      endField();
    } else if (c === "\r") {
      // Swallow the \r of a CRLF pair; the following \n (if any) ends the row.
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") {
      endRow();
    } else {
      field += c;
    }
  }
  // Handle a final line with no trailing newline.
  if (field.length > 0 || row.length > 0) endRow();

  // Drop blank lines (a fully empty line parses as a single empty-string field).
  const cleaned = rows.filter((r) => !(r.length === 1 && r[0] === ""));

  const header = cleaned[0];
  return cleaned.slice(1).map((cols) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = cols[idx] ?? "";
    });
    return obj;
  });
}

function readCsv(name) {
  return parseCsv(readFileSync(join(gtfsDir, name), "utf8"));
}

const routesRaw = readCsv("routes.txt");
const tripsRaw = readCsv("trips.txt");
const calendarRaw = readCsv("calendar.txt");
const feedInfoRaw = readCsv("feed_info.txt");

// ---------------------------------------------------------------------------
// 1. Select the active service period
// ---------------------------------------------------------------------------
// This feed contains every route TWICE under two different route_ids. They
// are NOT directions (each duplicate carries both direction_id 0 and 1) —
// they're two service periods (e.g. spring and fall schedules), distinguished
// via trips.service_id -> calendar.txt start_date/end_date. Route ids are
// never hardcoded here; the period is derived from calendar.txt every run so
// this keeps working after Metro republishes the feed with new ids.
const calendarByService = new Map(calendarRaw.map((row) => [row.service_id, { start: row.start_date, end: row.end_date }]));

function periodKey(period) {
  return `${period.start}|${period.end}`;
}
const periodsByKey = new Map();
for (const period of calendarByService.values()) {
  periodsByKey.set(periodKey(period), period);
}
const periods = [...periodsByKey.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

function todayYyyymmdd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
const today = todayYyyymmdd();

let activePeriod = periods.find((p) => p.start <= today && today <= p.end);
let periodChoiceReason;
if (activePeriod) {
  periodChoiceReason = `today (${today}) falls within this period's start_date/end_date range`;
} else {
  activePeriod = [...periods].sort((a, b) => (a.start > b.start ? -1 : 1))[0];
  periodChoiceReason = `today (${today}) is outside every period in the feed; fell back to the latest start_date`;
  console.warn(
    `WARNING: the GTFS feed looks stale — today (${today}) is not covered by any service period ` +
      `(latest is ${activePeriod.start}-${activePeriod.end}). Falling back to that period. ` +
      `Download a fresh feed from ${GTFS_DOWNLOAD_URL}.`
  );
}

const activeServiceIds = new Set(
  [...calendarByService.entries()].filter(([, p]) => p.start === activePeriod.start && p.end === activePeriod.end).map(([serviceId]) => serviceId)
);
const activeTrips = tripsRaw.filter((t) => activeServiceIds.has(t.service_id));

// ---------------------------------------------------------------------------
// 2. Dedupe to 26 routes, keyed by route_short_name
// ---------------------------------------------------------------------------
const routeById = new Map(routesRaw.map((r) => [r.route_id, r]));
const activeRouteIds = new Set(activeTrips.map((t) => t.route_id));

const shortNameToRouteId = new Map();
for (const routeId of activeRouteIds) {
  const route = routeById.get(routeId);
  if (!route) throw new Error(`trips.txt references unknown route_id "${routeId}" (not present in routes.txt)`);
  const shortName = route.route_short_name;
  const existing = shortNameToRouteId.get(shortName);
  if (existing !== undefined && existing !== routeId) {
    throw new Error(
      `Duplicate route_short_name "${shortName}" appears under both route_id ${existing} and ${routeId} ` +
        `within the chosen service period (${activePeriod.start}-${activePeriod.end}). Period selection should ` +
        `leave exactly one route_id per short name active at a time.`
    );
  }
  shortNameToRouteId.set(shortName, routeId);
}

// ---------------------------------------------------------------------------
// 3. Map GTFS short names to the dashboard's route ids
// ---------------------------------------------------------------------------
// GTFS route_short_name matches the dashboard id for every route except
// ORBT, whose short name in the feed is "00". No fuzzy matching — anything
// else that doesn't match exactly is a real mismatch worth failing loudly on.
const SHORT_NAME_ALIASES = { "00": "orbt" };

const idToRoute = new Map(); // dashboard id -> { routeId, shortName, route }
for (const [shortName, routeId] of shortNameToRouteId) {
  const id = SHORT_NAME_ALIASES[shortName] ?? shortName;
  idToRoute.set(id, { routeId, shortName, route: routeById.get(routeId) });
}

const estimatesPath = join(repoRoot, "data", "route-estimates-2026.json");
const estimates = JSON.parse(readFileSync(estimatesPath, "utf8"));
const expectedIds = estimates.routes.map((r) => r.id);
const expectedIdSet = new Set(expectedIds);
const producedIdSet = new Set(idToRoute.keys());

const missingIds = expectedIds.filter((id) => !producedIdSet.has(id));
const extraIds = [...producedIdSet].filter((id) => !expectedIdSet.has(id));
if (missingIds.length > 0 || extraIds.length > 0) {
  throw new Error(
    `Route id mismatch between the GTFS feed and data/route-estimates-2026.json.\n` +
      `  Missing (expected by the dashboard, not found in GTFS): ${missingIds.join(", ") || "(none)"}\n` +
      `  Extra (found in GTFS, not expected by the dashboard):    ${extraIds.join(", ") || "(none)"}`
  );
}
if (idToRoute.size !== 26) {
  throw new Error(`Expected exactly 26 deduped routes, got ${idToRoute.size}.`);
}

// ---------------------------------------------------------------------------
// 4. Pick one representative shape per (route, direction_id)
// ---------------------------------------------------------------------------
// A route can have 2-12 shape_ids per direction: short-turns, detours, and
// the full-length pattern. We pick the LONGEST shape, measured by cumulative
// great-circle distance, rather than the shape used by the most trips.
// "Longest" was chosen deliberately: this map exists to answer "where does
// this route go?", not "what does the average trip look like?" — a short-turn
// pattern run on most weekday trips would visually amputate the route. Verified
// against this feed: the longest-shape and most-used-shape choices disagree
// for 39 of the 48 route-directions here, so the choice is consequential, not
// a rare edge case.
const shapesRaw = readCsv("shapes.txt");
const shapePointsById = new Map();
for (const row of shapesRaw) {
  let pts = shapePointsById.get(row.shape_id);
  if (!pts) {
    pts = [];
    shapePointsById.set(row.shape_id, pts);
  }
  pts.push({
    lat: Number(row.shape_pt_lat),
    lon: Number(row.shape_pt_lon),
    seq: Number(row.shape_pt_sequence),
    dist: row.shape_dist_traveled === "" ? null : Number(row.shape_dist_traveled),
  });
}

// BUG SOURCE: shapes.txt is NOT stored sorted by shape_pt_sequence in this
// feed (rows are grouped by shape_id, but within a shape_id the sequence
// numbers jump around). Sorting numerically here, before anything else touches
// these points, is what keeps every path from coming out scrambled.
for (const pts of shapePointsById.values()) {
  pts.sort((a, b) => a.seq - b.seq);
}

const EARTH_RADIUS_M = 6371000;
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function shapeLengthMeters(points) {
  // Prefer the feed's own shape_dist_traveled column (points aren't sorted by
  // sequence on disk, but the column itself is populated per-point, so the
  // shape's total length is just its max value, wherever that row landed).
  if (points.every((p) => p.dist !== null)) {
    return Math.max(...points.map((p) => p.dist));
  }
  // Fall back to summing haversine distance along the now-sequence-sorted points.
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}

function pickLongestShape(shapeIds) {
  let bestShapeId = null;
  let bestLength = -1;
  for (const shapeId of shapeIds) {
    const points = shapePointsById.get(shapeId);
    if (!points || points.length < 2) continue;
    const length = shapeLengthMeters(points);
    if (length > bestLength) {
      bestLength = length;
      bestShapeId = shapeId;
    }
  }
  if (!bestShapeId) throw new Error(`No usable shape found among candidates: ${[...shapeIds].join(", ")}`);
  return { shapeId: bestShapeId, points: shapePointsById.get(bestShapeId), lengthMeters: bestLength };
}

// Every trip's shape_id used per (route_id, direction_id), for the active period only.
const shapeIdsByRouteDirection = new Map(); // "routeId|directionId" -> Set<shapeId>
for (const t of activeTrips) {
  const key = `${t.route_id}|${t.direction_id}`;
  let set = shapeIdsByRouteDirection.get(key);
  if (!set) {
    set = new Set();
    shapeIdsByRouteDirection.set(key, set);
  }
  set.add(t.shape_id);
}

// Keep BOTH directions where they exist. Most routes trace the same streets
// each way, but Route 11 (Leavenworth) is a genuine one-way pair diverging by
// up to 3.3 km, so dropping a direction would silently lose half the route.
// Four routes (200, 26, 41, 43) are one-way loops with only direction 0 —
// a missing direction here is expected, not an error.
const selected = []; // { id, shortName, route, directionId, points, lengthMeters }
for (const id of expectedIds) {
  const info = idToRoute.get(id);
  for (const directionId of [0, 1]) {
    const key = `${info.routeId}|${directionId}`;
    const shapeIds = shapeIdsByRouteDirection.get(key);
    if (!shapeIds) continue;
    const { shapeId, points, lengthMeters } = pickLongestShape(shapeIds);
    selected.push({ id, shortName: info.shortName, route: info.route, directionId, shapeId, points, lengthMeters });
  }
}

// ---------------------------------------------------------------------------
// 5. Compute the bounding box (selected shapes only) and project. 
// ---------------------------------------------------------------------------
// In other words, the smallest rectangle containing every point of every 
// route.
let minLat = Infinity;
let maxLat = -Infinity;
let minLon = Infinity;
let maxLon = -Infinity;
for (const s of selected) {
  for (const p of s.points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
}

// Routes otherwise run flush to the map edge and get visually clipped there.
// Padding is applied to each axis's own span (not a shared value) so the
// aspect ratio of the bounding box — and therefore the viewBox — is
// unchanged. This runs BEFORE makeProjector() deliberately: the padded box
// IS the coordinate system everything downstream (including build-basemap.mjs,
// which reads these bounds back out) projects into.
const PAD_FRACTION = 0.08;
const latPad = (maxLat - minLat) * PAD_FRACTION;
const lonPad = (maxLon - minLon) * PAD_FRACTION;
minLat -= latPad;
maxLat += latPad;
minLon -= lonPad;
maxLon += lonPad;

const VIEWBOX_WIDTH = 900;
const { project, viewBoxHeight } = makeProjector({ minLat, maxLat, minLon, maxLon, viewBoxWidth: VIEWBOX_WIDTH });

const midLat = (minLat + maxLat) / 2;
const widthMeters = haversineMeters(midLat, minLon, midLat, maxLon);
const metersPerPixel = widthMeters / VIEWBOX_WIDTH;

// ---------------------------------------------------------------------------
// 6. Douglas-Peucker simplification at epsilon = 0.25 px
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
// 0.05px (~1.9m at 37 m/px), not the 0.25px this once used. Epsilon is a
// SCREEN-space tolerance, so it is only honest at the zoom it was baked for:
// geometry simplified to a quarter-pixel at 1x shows a visible 1.25px wobble
// once magnified 5x. Baking at 0.05 buys clean detail out to roughly 5x zoom
// for about 27% more bytes, which is cheap because these polylines were never
// dense enough for Douglas-Peucker to remove much beyond the easy collinear
// runs. Tighten this further if the map ever zooms deeper than 5x.
const EPSILON_PX = 0.05;
// A tiny allowance for floating-point arithmetic noise (sin/log/sqrt aren't
// exact), not a loosening of the actual epsilon guarantee.
const FLOAT_TOLERANCE = 1e-9;
let pointsBefore = 0;
let pointsAfter = 0;
let maxRoundedDeviation = 0;
let maxRoundedDeviationAt = null;
const pathsByRouteId = new Map(); // dashboard id -> [{ directionId, shapeId, d }]
for (const s of selected) {
  const projected = s.points.map((p) => project(p.lat, p.lon));
  pointsBefore += projected.length;
  const simplified = simplifyDouglasPeucker(projected, EPSILON_PX);
  pointsAfter += simplified.length;

  // Self-verification: Douglas-Peucker's guarantee is that every ORIGINAL
  // point ends up within epsilon of the simplified segment that replaced its
  // neighborhood. Check that here, on the un-rounded projected coordinates
  // and the un-rounded simplified polyline, so a violation can only mean a
  // real bug in project()/perpendicularDistance()/simplifyDouglasPeucker() —
  // not an artifact of the 1-decimal rounding applied when the "d" string is
  // built below.
  const maxUnroundedDeviation = maxPointToPolylineDistance(projected, simplified);
  if (maxUnroundedDeviation > EPSILON_PX + FLOAT_TOLERANCE) {
    throw new Error(
      `Simplification bug: route ${s.id} direction ${s.directionId} (shape ${s.shapeId}) has an original point ` +
        `${maxUnroundedDeviation.toFixed(4)}px from the simplified polyline, exceeding epsilon (${EPSILON_PX}px). ` +
        `This should be mathematically impossible if simplifyDouglasPeucker/perpendicularDistance are correct.`
    );
  }

  // ---------------------------------------------------------------------
  // 7. Emit an SVG path string
  // ---------------------------------------------------------------------
  // One decimal place is about 3.7 m of precision (0.1 px * ~37 m/px) — far
  // below anything visible on screen — and roughly halves the string length
  // versus full float precision, which matters once this repeats 3,200 times.
  const d = toPathString(simplified);

  // Separately (and not asserted — rounding is a deliberate size tradeoff,
  // not a bug) measure deviation against the ROUNDED path actually emitted,
  // by parsing our own "d" string back into points. Comparing this number to
  // the un-rounded check above isolates how much of any overshoot is purely
  // the cost of toFixed(1) versus a flaw in the algorithm itself.
  const roundedPolyline = parsePathString(d);
  const roundedDeviation = maxPointToPolylineDistance(projected, roundedPolyline);
  if (roundedDeviation > maxRoundedDeviation) {
    maxRoundedDeviation = roundedDeviation;
    maxRoundedDeviationAt = { id: s.id, directionId: s.directionId, shapeId: s.shapeId };
  }

  if (!pathsByRouteId.has(s.id)) pathsByRouteId.set(s.id, []);
  pathsByRouteId.get(s.id).push({ directionId: s.directionId, shapeId: s.shapeId, d });
}

// ---------------------------------------------------------------------------
// 8. displayColor for accessibility
// ---------------------------------------------------------------------------
// route_color in the feed is Metro's official brand color for the route.
// Some fail WCAG contrast against a light (white/OSM) basemap — e.g. Route 43
// is #FFDE17, which measures about 1.3:1 on white. `color` always carries the
// official value unmodified; `displayColor` is what the map should actually
// draw, darkened (hue preserved) just enough to clear a 3:1 contrast ratio.
function hexToRgb(hex) {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}
function rgbToHex({ r, g, b }) {
  const c = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function relativeLuminance({ r, g, b }) {
  const lin = (channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

const WHITE = { r: 255, g: 255, b: 255 };
const MIN_CONTRAST = 3;
const LIGHTNESS_STEP = 0.02;
const MAX_DARKEN_ITERATIONS = 50;

function darkenForContrast(hex) {
  const rgb = hexToRgb(hex);
  if (contrastRatio(rgb, WHITE) >= MIN_CONTRAST) return hex;
  let hsl = rgbToHsl(rgb);
  for (let i = 0; i < MAX_DARKEN_ITERATIONS && hsl.l > 0; i++) {
    hsl = { ...hsl, l: Math.max(0, hsl.l - LIGHTNESS_STEP) };
    const candidate = hslToRgb(hsl);
    if (contrastRatio(candidate, WHITE) >= MIN_CONTRAST) return rgbToHex(candidate);
  }
  // Every real hue reaches 3:1 well before pure black (~21:1), so this is
  // an unreachable safety net, not an expected path.
  return "#000000";
}

const displayColorLog = [];
const outputRoutes = expectedIds.map((id) => {
  const info = idToRoute.get(id);
  const officialColor = `#${info.route.route_color.toUpperCase()}`;
  const displayColor = darkenForContrast(officialColor);
  if (displayColor !== officialColor) {
    displayColorLog.push({ id, officialColor, displayColor });
  }
  const paths = (pathsByRouteId.get(id) || []).slice().sort((a, b) => a.directionId - b.directionId);
  return {
    id,
    shortName: info.shortName,
    name: info.route.route_long_name,
    color: officialColor,
    displayColor,
    paths,
  };
});

if (selected.length !== outputRoutes.reduce((sum, r) => sum + r.paths.length, 0)) {
  throw new Error("Internal error: path count lost or gained a route mapping paths back to routes.");
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function formatIsoDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

const feedInfo = feedInfoRaw[0];
const data = {
  generated: new Date().toISOString(),
  source: {
    name: "Omaha Metro GTFS static feed",
    url: GTFS_DOWNLOAD_URL,
    feedVersion: feedInfo.feed_version,
    servicePeriod: { start: formatIsoDate(activePeriod.start), end: formatIsoDate(activePeriod.end) },
  },
  viewBox: { width: VIEWBOX_WIDTH, height: viewBoxHeight },
  bounds: { minLat, maxLat, minLon, maxLon },
  simplification: {
    epsilonPx: EPSILON_PX,
    metersPerPixel: Number(metersPerPixel.toFixed(1)),
    pointsBefore,
    pointsAfter,
  },
  routes: outputRoutes,
};

const outPath = join(repoRoot, "data", "routes-geo.json");
const json = JSON.stringify(data, null, 2) + "\n";
writeFileSync(outPath, json);
const gzipped = gzipSync(Buffer.from(json));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const pathCount = outputRoutes.reduce((sum, r) => sum + r.paths.length, 0);
const percentRemoved = (((pointsBefore - pointsAfter) / pointsBefore) * 100).toFixed(1);

console.log(`Service period chosen: ${activePeriod.start}-${activePeriod.end} (${periodChoiceReason})`);
console.log(`Routes: ${outputRoutes.length}`);
console.log(`Paths (route-directions): ${pathCount}`);
console.log(`Simplification: ${pointsBefore.toLocaleString()} points -> ${pointsAfter.toLocaleString()} points (${percentRemoved}% removed) at epsilon ${EPSILON_PX}px`);
console.log(`Max deviation before rounding: <= ${EPSILON_PX}px on all ${selected.length} paths (asserted; see self-check above)`);
console.log(
  `Max deviation after rounding: ${maxRoundedDeviation.toFixed(3)} px` +
    (maxRoundedDeviationAt ? ` (route ${maxRoundedDeviationAt.id}, direction ${maxRoundedDeviationAt.directionId}, shape ${maxRoundedDeviationAt.shapeId})` : "")
);
console.log(`Projection: ${metersPerPixel.toFixed(1)} m/px, viewBox ${VIEWBOX_WIDTH}x${viewBoxHeight}`);
console.log(`Output: ${outPath} (${(json.length / 1024).toFixed(1)} KB, ${(gzipped.length / 1024).toFixed(1)} KB gzipped)`);
if (displayColorLog.length > 0) {
  console.log(`Display colors darkened for contrast (${displayColorLog.length}):`);
  for (const { id, officialColor, displayColor } of displayColorLog) {
    console.log(`  Route ${id}: ${officialColor} -> ${displayColor}`);
  }
} else {
  console.log("Display colors darkened for contrast: none");
}
