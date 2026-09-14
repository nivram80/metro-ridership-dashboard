// Generates data/route-estimates-2026.json from route-level estimates read from
// Metro's "Ridership by Route" bar charts.
//
// Sources: months 1-5 re-measured from the Amended June 2026 Board Packet,
//            PDF pages 101-103 (one chart per month, two charts per page);
//          month 6 from the July 2026 Updated Board Packet, PDF page 31;
//          month 7 from the August 2026 Board Packet, PDF page 116;
//          month 8 from the September 2026 Board Packet, PDF page 31.
//
// Months 1-5 were re-measured because the original pass read several small
// bars as zero - routes 92, 93, 95 and 120 had zero-trip months, which is not
// credible for routes that ran service. Scaling the remainder to the official
// monthly total then pushed that missing ridership onto the largest routes, so
// ORBT and Route 18 were over-stated by 1,000-2,500 trips a month while the
// expresses were under-stated. Re-measuring at 600 DPI from the June packet's
// larger per-month charts removed every zero and moved 93 of 130 records up.
//
// The June packet's charts use a different palette (blue/yellow/navy rather
// than teal/orange/green) and draw a lighter border around each bar, which an
// earlier attempt counted as a fourth series and inflated the total by ~80%.
// Colours whose bars sit at the same x positions are now merged before
// measuring. As a check that does not depend on the official total, the
// measurement recovers the chart's own axis scale: 4,963-4,973 against printed
// gridlines of 5,000, and 9,917 against April's 10,000.
// Method: Bar heights were extracted from high-resolution chart renders,
// calibrated against each chart's y-axis, scaled to the official monthly
// system total, and rounded to the nearest 100 trips.
//
// These are intentionally separate from data/ridership.json because they are
// approximate route-level figures, not official route totals supplied by Metro.
//
// Run: node scripts/build-route-estimates.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Route colors are read from data/routes-geo.json rather than hardcoded here.
// Those are Metro's own route_color values out of the GTFS feed, darkened where
// needed to clear a 3:1 contrast ratio on white (see build-routes.mjs).
//
// One palette, three places: a route's chip, its chart series, and its line on
// the map are guaranteed to be the same color. The previous hand-picked palette
// reused 9 colors across all 26 routes, so multi-selecting estimated routes drew
// two identical red lines on the map (11 and 200, for instance).
//
// This makes build-routes.mjs a prerequisite: run it first if data/routes-geo.json
// is missing.
const GEO_PATH = join(__dirname, "..", "data", "routes-geo.json");
if (!existsSync(GEO_PATH)) {
  console.error(`Missing ${GEO_PATH} — run "node scripts/build-routes.mjs" first.`);
  process.exit(1);
}
const geoColors = new Map(
  JSON.parse(readFileSync(GEO_PATH, "utf8")).routes.map((r) => [r.id, r.displayColor]),
);

const ROUTES = [
  { id: "orbt", name: "ORBT" },
  { id: "3", name: "Route 3" },
  { id: "4", name: "Route 4" },
  { id: "5", name: "Route 5" },
  { id: "8", name: "Route 8" },
  { id: "11", name: "Route 11" },
  { id: "13", name: "Route 13" },
  { id: "14", name: "Route 14" },
  { id: "15", name: "Route 15" },
  { id: "18", name: "Route 18" },
  { id: "24", name: "Route 24" },
  { id: "26", name: "Route 26" },
  { id: "30", name: "Route 30" },
  { id: "35", name: "Route 35" },
  { id: "36", name: "Route 36" },
  { id: "41", name: "Route 41" },
  { id: "43", name: "Route 43" },
  { id: "55", name: "Route 55" },
  { id: "92", name: "Route 92" },
  { id: "93", name: "Route 93" },
  { id: "94", name: "Route 94" },
  { id: "95", name: "Route 95" },
  { id: "97", name: "Route 97" },
  { id: "106", name: "Route 106" },
  { id: "120", name: "Route 120" },
  { id: "200", name: "Route 200" },
].map((route) => {
  const color = geoColors.get(route.id);
  if (!color) throw new Error(`No geometry color for route "${route.id}" in ${GEO_PATH}`);
  return { ...route, color };
});

const OFFICIAL_TOTALS = {
  1: 268640,
  2: 277303,
  3: 307953,
  4: 315938,
  5: 322056,
  6: 319644,
  7: 287348,
  8: 304748,
};

// Estimated monthly passenger trips by route and service-day category.
const ESTIMATES = {
  1: {
    orbt: { weekday: 37900, saturday: 4900, sunday: 2900 },
    "3": { weekday: 15800, saturday: 1600, sunday: 1100 },
    "4": { weekday: 23100, saturday: 2300, sunday: 1600 },
    "5": { weekday: 6600, saturday: 700, sunday: 0 },
    "8": { weekday: 3800, saturday: 500, sunday: 0 },
    "11": { weekday: 7700, saturday: 800, sunday: 300 },
    "13": { weekday: 10900, saturday: 1300, sunday: 800 },
    "14": { weekday: 6200, saturday: 700, sunday: 0 },
    "15": { weekday: 8500, saturday: 1300, sunday: 900 },
    "18": { weekday: 40700, saturday: 4800, sunday: 3300 },
    "24": { weekday: 25900, saturday: 2500, sunday: 1600 },
    "26": { weekday: 4300, saturday: 200, sunday: 200 },
    "30": { weekday: 10400, saturday: 1300, sunday: 900 },
    "35": { weekday: 5700, saturday: 400, sunday: 300 },
    "36": { weekday: 2600, saturday: 200, sunday: 200 },
    "41": { weekday: 4900, saturday: 0, sunday: 0 },
    "43": { weekday: 5300, saturday: 800, sunday: 0 },
    "55": { weekday: 3700, saturday: 400, sunday: 0 },
    "92": { weekday: 200, saturday: 0, sunday: 0 },
    "93": { weekday: 300, saturday: 0, sunday: 0 },
    "94": { weekday: 500, saturday: 0, sunday: 0 },
    "95": { weekday: 500, saturday: 0, sunday: 0 },
    "97": { weekday: 1000, saturday: 0, sunday: 0 },
    "106": { weekday: 2300, saturday: 0, sunday: 0 },
    "120": { weekday: 400, saturday: 0, sunday: 0 },
    "200": { weekday: 700, saturday: 0, sunday: 0 },
  },
  2: {
    orbt: { weekday: 39200, saturday: 4900, sunday: 3800 },
    "3": { weekday: 16000, saturday: 1400, sunday: 1300 },
    "4": { weekday: 23700, saturday: 2500, sunday: 1800 },
    "5": { weekday: 6400, saturday: 600, sunday: 0 },
    "8": { weekday: 3900, saturday: 500, sunday: 0 },
    "11": { weekday: 7600, saturday: 900, sunday: 300 },
    "13": { weekday: 10900, saturday: 1200, sunday: 900 },
    "14": { weekday: 6400, saturday: 800, sunday: 0 },
    "15": { weekday: 9800, saturday: 1200, sunday: 1000 },
    "18": { weekday: 41700, saturday: 4300, sunday: 3200 },
    "24": { weekday: 26400, saturday: 2800, sunday: 1800 },
    "26": { weekday: 4500, saturday: 200, sunday: 200 },
    "30": { weekday: 10700, saturday: 1400, sunday: 1000 },
    "35": { weekday: 5800, saturday: 400, sunday: 300 },
    "36": { weekday: 2500, saturday: 200, sunday: 200 },
    "41": { weekday: 5600, saturday: 0, sunday: 0 },
    "43": { weekday: 5800, saturday: 900, sunday: 0 },
    "55": { weekday: 3800, saturday: 400, sunday: 0 },
    "92": { weekday: 400, saturday: 0, sunday: 0 },
    "93": { weekday: 300, saturday: 0, sunday: 0 },
    "94": { weekday: 500, saturday: 0, sunday: 0 },
    "95": { weekday: 400, saturday: 0, sunday: 0 },
    "97": { weekday: 900, saturday: 0, sunday: 0 },
    "106": { weekday: 2100, saturday: 0, sunday: 0 },
    "120": { weekday: 400, saturday: 0, sunday: 0 },
    "200": { weekday: 700, saturday: 0, sunday: 0 },
  },
  3: {
    orbt: { weekday: 45900, saturday: 5400, sunday: 4300 },
    "3": { weekday: 16400, saturday: 1400, sunday: 1400 },
    "4": { weekday: 26700, saturday: 2700, sunday: 2200 },
    "5": { weekday: 6300, saturday: 600, sunday: 0 },
    "8": { weekday: 4200, saturday: 500, sunday: 0 },
    "11": { weekday: 8600, saturday: 1000, sunday: 500 },
    "13": { weekday: 12100, saturday: 1500, sunday: 1100 },
    "14": { weekday: 7100, saturday: 800, sunday: 0 },
    "15": { weekday: 9900, saturday: 1100, sunday: 1100 },
    "18": { weekday: 47000, saturday: 5100, sunday: 4100 },
    "24": { weekday: 29300, saturday: 2700, sunday: 2100 },
    "26": { weekday: 4900, saturday: 200, sunday: 200 },
    "30": { weekday: 11900, saturday: 1500, sunday: 1400 },
    "35": { weekday: 5800, saturday: 400, sunday: 400 },
    "36": { weekday: 2800, saturday: 200, sunday: 100 },
    "41": { weekday: 6200, saturday: 0, sunday: 0 },
    "43": { weekday: 6500, saturday: 900, sunday: 0 },
    "55": { weekday: 4100, saturday: 300, sunday: 0 },
    "92": { weekday: 500, saturday: 0, sunday: 0 },
    "93": { weekday: 400, saturday: 0, sunday: 0 },
    "94": { weekday: 600, saturday: 0, sunday: 0 },
    "95": { weekday: 400, saturday: 0, sunday: 0 },
    "97": { weekday: 900, saturday: 0, sunday: 0 },
    "106": { weekday: 2500, saturday: 0, sunday: 0 },
    "120": { weekday: 600, saturday: 0, sunday: 0 },
    "200": { weekday: 800, saturday: 0, sunday: 0 },
  },
  4: {
    orbt: { weekday: 47400, saturday: 5500, sunday: 4300 },
    "3": { weekday: 16600, saturday: 1400, sunday: 1300 },
    "4": { weekday: 28200, saturday: 2500, sunday: 2000 },
    "5": { weekday: 7000, saturday: 600, sunday: 0 },
    "8": { weekday: 4300, saturday: 400, sunday: 0 },
    "11": { weekday: 8700, saturday: 1200, sunday: 600 },
    "13": { weekday: 13100, saturday: 1200, sunday: 1000 },
    "14": { weekday: 8000, saturday: 800, sunday: 0 },
    "15": { weekday: 10300, saturday: 1300, sunday: 1100 },
    "18": { weekday: 48300, saturday: 5100, sunday: 3700 },
    "24": { weekday: 30200, saturday: 3100, sunday: 1900 },
    "26": { weekday: 5200, saturday: 200, sunday: 200 },
    "30": { weekday: 12400, saturday: 1500, sunday: 1200 },
    "35": { weekday: 6100, saturday: 400, sunday: 300 },
    "36": { weekday: 2500, saturday: 200, sunday: 0 },
    "41": { weekday: 6100, saturday: 0, sunday: 0 },
    "43": { weekday: 6400, saturday: 900, sunday: 0 },
    "55": { weekday: 4200, saturday: 400, sunday: 0 },
    "92": { weekday: 500, saturday: 0, sunday: 0 },
    "93": { weekday: 400, saturday: 0, sunday: 0 },
    "94": { weekday: 700, saturday: 0, sunday: 0 },
    "95": { weekday: 400, saturday: 0, sunday: 0 },
    "97": { weekday: 900, saturday: 0, sunday: 0 },
    "106": { weekday: 2500, saturday: 0, sunday: 0 },
    "120": { weekday: 500, saturday: 0, sunday: 0 },
    "200": { weekday: 600, saturday: 0, sunday: 0 },
  },
  5: {
    orbt: { weekday: 43900, saturday: 7700, sunday: 5400 },
    "3": { weekday: 16500, saturday: 2100, sunday: 1700 },
    "4": { weekday: 27700, saturday: 3600, sunday: 2800 },
    "5": { weekday: 6700, saturday: 900, sunday: 0 },
    "8": { weekday: 4300, saturday: 700, sunday: 0 },
    "11": { weekday: 8900, saturday: 1500, sunday: 1200 },
    "13": { weekday: 12800, saturday: 2000, sunday: 1600 },
    "14": { weekday: 7500, saturday: 1100, sunday: 0 },
    "15": { weekday: 9600, saturday: 1900, sunday: 1300 },
    "18": { weekday: 47100, saturday: 7900, sunday: 5300 },
    "24": { weekday: 27000, saturday: 4100, sunday: 2900 },
    "26": { weekday: 4300, saturday: 400, sunday: 300 },
    "30": { weekday: 12200, saturday: 2000, sunday: 1600 },
    "35": { weekday: 5600, saturday: 600, sunday: 400 },
    "36": { weekday: 2500, saturday: 300, sunday: 200 },
    "41": { weekday: 6100, saturday: 0, sunday: 0 },
    "43": { weekday: 6400, saturday: 1100, sunday: 0 },
    "55": { weekday: 4100, saturday: 500, sunday: 0 },
    "92": { weekday: 600, saturday: 0, sunday: 0 },
    "93": { weekday: 500, saturday: 0, sunday: 0 },
    "94": { weekday: 500, saturday: 0, sunday: 0 },
    "95": { weekday: 400, saturday: 0, sunday: 0 },
    "97": { weekday: 800, saturday: 0, sunday: 0 },
    "106": { weekday: 2200, saturday: 0, sunday: 0 },
    "120": { weekday: 400, saturday: 0, sunday: 0 },
    "200": { weekday: 600, saturday: 0, sunday: 0 },
  },
  6: {
    orbt: { weekday: 45200, saturday: 6200, sunday: 4300 },
    "3": { weekday: 17300, saturday: 1700, sunday: 1200 },
    "4": { weekday: 27900, saturday: 3000, sunday: 2200 },
    "5": { weekday: 5900, saturday: 700, sunday: 0 },
    "8": { weekday: 4200, saturday: 500, sunday: 0 },
    "11": { weekday: 9300, saturday: 1300, sunday: 1000 },
    "13": { weekday: 14600, saturday: 1500, sunday: 1200 },
    "14": { weekday: 7700, saturday: 900, sunday: 0 },
    "15": { weekday: 11100, saturday: 1400, sunday: 900 },
    "18": { weekday: 49500, saturday: 6000, sunday: 4300 },
    "24": { weekday: 26800, saturday: 3100, sunday: 1900 },
    "26": { weekday: 3800, saturday: 300, sunday: 200 },
    "30": { weekday: 13700, saturday: 1600, sunday: 1200 },
    "35": { weekday: 5700, saturday: 500, sunday: 300 },
    "36": { weekday: 2800, saturday: 200, sunday: 200 },
    "41": { weekday: 6700, saturday: 0, sunday: 0 },
    "43": { weekday: 6900, saturday: 900, sunday: 0 },
    "55": { weekday: 4600, saturday: 500, sunday: 0 },
    "92": { weekday: 500, saturday: 0, sunday: 0 },
    "93": { weekday: 300, saturday: 0, sunday: 0 },
    "94": { weekday: 700, saturday: 0, sunday: 0 },
    "95": { weekday: 400, saturday: 0, sunday: 0 },
    "97": { weekday: 900, saturday: 0, sunday: 0 },
    "106": { weekday: 2200, saturday: 0, sunday: 0 },
    "120": { weekday: 400, saturday: 0, sunday: 0 },
    "200": { weekday: 1000, saturday: 200, sunday: 200 },
  },
  7: {
    orbt: { weekday: 42000, saturday: 4000, sunday: 3800 },
    "3": { weekday: 16800, saturday: 1100, sunday: 1100 },
    "4": { weekday: 26700, saturday: 2000, sunday: 2000 },
    "5": { weekday: 5100, saturday: 300, sunday: 0 },
    "8": { weekday: 4300, saturday: 300, sunday: 0 },
    "11": { weekday: 11600, saturday: 800, sunday: 800 },
    "13": { weekday: 13600, saturday: 1100, sunday: 1100 },
    "14": { weekday: 6500, saturday: 600, sunday: 0 },
    "15": { weekday: 10500, saturday: 900, sunday: 1000 },
    "18": { weekday: 42800, saturday: 4400, sunday: 3500 },
    "24": { weekday: 24500, saturday: 1900, sunday: 1900 },
    "26": { weekday: 3300, saturday: 100, sunday: 200 },
    "30": { weekday: 12900, saturday: 1100, sunday: 1100 },
    "35": { weekday: 4700, saturday: 200, sunday: 300 },
    "36": { weekday: 2300, saturday: 100, sunday: 0 },
    "41": { weekday: 6300, saturday: 0, sunday: 0 },
    "43": { weekday: 6300, saturday: 600, sunday: 0 },
    "55": { weekday: 4500, saturday: 300, sunday: 0 },
    "92": { weekday: 500, saturday: 0, sunday: 0 },
    "93": { weekday: 300, saturday: 0, sunday: 0 },
    "94": { weekday: 500, saturday: 0, sunday: 0 },
    "95": { weekday: 400, saturday: 0, sunday: 0 },
    "97": { weekday: 800, saturday: 0, sunday: 0 },
    "106": { weekday: 2500, saturday: 0, sunday: 0 },
    "120": { weekday: 300, saturday: 0, sunday: 0 },
    "200": { weekday: 400, saturday: 200, sunday: 100 },
  },
  8: {
    orbt: { weekday: 42100, saturday: 7400, sunday: 4800 },
    "3": { weekday: 16600, saturday: 1900, sunday: 1400 },
    "4": { weekday: 28200, saturday: 3400, sunday: 2800 },
    "5": { weekday: 5600, saturday: 700, sunday: 0 },
    "8": { weekday: 3800, saturday: 700, sunday: 0 },
    "11": { weekday: 8000, saturday: 1300, sunday: 1100 },
    "13": { weekday: 12200, saturday: 1800, sunday: 1400 },
    "14": { weekday: 5900, saturday: 1000, sunday: 0 },
    "15": { weekday: 9600, saturday: 1900, sunday: 1400 },
    "18": { weekday: 43000, saturday: 6900, sunday: 5300 },
    "24": { weekday: 24600, saturday: 3700, sunday: 2400 },
    "26": { weekday: 4300, saturday: 400, sunday: 400 },
    "30": { weekday: 12400, saturday: 2200, sunday: 1600 },
    "35": { weekday: 5200, saturday: 600, sunday: 400 },
    "36": { weekday: 2300, saturday: 300, sunday: 200 },
    "41": { weekday: 6000, saturday: 0, sunday: 0 },
    "43": { weekday: 5900, saturday: 1200, sunday: 0 },
    "55": { weekday: 4200, saturday: 400, sunday: 0 },
    "92": { weekday: 500, saturday: 0, sunday: 0 },
    "93": { weekday: 300, saturday: 0, sunday: 0 },
    "94": { weekday: 600, saturday: 0, sunday: 0 },
    "95": { weekday: 300, saturday: 0, sunday: 0 },
    "97": { weekday: 1000, saturday: 0, sunday: 0 },
    "106": { weekday: 2600, saturday: 0, sunday: 0 },
    "120": { weekday: 200, saturday: 0, sunday: 0 },
    "200": { weekday: 500, saturday: 0, sunday: 0 },
  },
};

const records = [];
for (const [month, byRoute] of Object.entries(ESTIMATES)) {
  for (const route of ROUTES) {
    const parts = byRoute[route.id];
    if (!parts) throw new Error(`Missing estimate for route ${route.id}, month ${month}`);
    records.push({
      routeId: route.id,
      year: 2026,
      month: Number(month),
      trips: parts.weekday + parts.saturday + parts.sunday,
      estimated: true,
      weekdayTrips: parts.weekday,
      saturdayTrips: parts.saturday,
      sundayTrips: parts.sunday,
    });
  }
}

for (const [month, official] of Object.entries(OFFICIAL_TOTALS)) {
  const estimatedTotal = records
    .filter((r) => r.month === Number(month))
    .reduce((sum, r) => sum + r.trips, 0);
  if (Math.abs(estimatedTotal - official) > 1000) {
    throw new Error(`Estimated month ${month} total ${estimatedTotal} is too far from official total ${official}`);
  }
}

const data = {
  title: "Omaha Metro — Estimated Route Passenger Trips",
  estimated: true,
  source: {
    name: "Metro (Omaha) July + August 2026 Board Packets — Ridership by Route charts",
    url: "https://www.ometro.com/august-2026-board-packet/",
    note: "Approximate route-level trips estimated from bar heights on the monthly Ridership by Route charts; values rounded to the nearest 100.",
    asOf: "2026-07",
    dataThrough: "July 2026",
    pages: "July packet PDF page 31 (Jan-Jun), August packet PDF page 116 (Jul), September packet PDF page 31 (Aug)",
    method: "Bar-height estimate calibrated to each chart axis and scaled to monthly system totals.",
  },
  routes: ROUTES.map((route) => ({ ...route, estimated: true })),
  records,
};

const out = join(__dirname, "..", "data", "route-estimates-2026.json");
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
const routeNames = new Map(data.routes.map((route) => [route.id, route.name]));
const csv = [
  ["route_id", "route_name", "year", "month", "day", "trips", "estimated", "weekday_trips", "saturday_trips", "sunday_trips"],
  ...records.map((record) => [
    record.routeId,
    routeNames.get(record.routeId) || record.routeId,
    record.year,
    record.month,
    record.day ?? "",
    record.trips,
    record.estimated,
    record.weekdayTrips ?? "",
    record.saturdayTrips ?? "",
    record.sundayTrips ?? "",
  ]),
].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
const csvOut = join(__dirname, "..", "data", "route-estimates-2026.csv");
writeFileSync(csvOut, csv);
console.log(`Wrote ${records.length} estimated route records to ${out}`);
console.log(`Wrote ${records.length} estimated route records to ${csvOut}`);
console.log("Estimated monthly totals are within 1,000 trips of official system totals.");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
