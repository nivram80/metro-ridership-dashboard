// Generates data/route-estimates-2026.json from route-level estimates read from
// Metro's "Ridership by Route" bar charts.
//
// Source: July 2026 Updated Board Packet, PDF page 31.
// Method: Bar heights were extracted from high-resolution chart renders,
// calibrated against each chart's y-axis, scaled to the official monthly
// system total, and rounded to the nearest 100 trips.
//
// These are intentionally separate from data/ridership.json because they are
// approximate route-level figures, not official route totals supplied by Metro.
//
// Run: node scripts/build-route-estimates.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROUTES = [
  { id: "orbt", name: "ORBT", color: "#E87722" },
  { id: "3", name: "Route 3", color: "#59CBE8" },
  { id: "4", name: "Route 4", color: "#F2A900" },
  { id: "5", name: "Route 5", color: "#707070" },
  { id: "8", name: "Route 8", color: "#053955" },
  { id: "11", name: "Route 11", color: "#CF594A" },
  { id: "13", name: "Route 13", color: "#7FBE39" },
  { id: "14", name: "Route 14", color: "#00B398" },
  { id: "15", name: "Route 15", color: "#053955" },
  { id: "18", name: "Route 18", color: "#007DBA" },
  { id: "24", name: "Route 24", color: "#00B398" },
  { id: "26", name: "Route 26", color: "#707070" },
  { id: "30", name: "Route 30", color: "#CF594A" },
  { id: "35", name: "Route 35", color: "#F2A900" },
  { id: "36", name: "Route 36", color: "#59CBE8" },
  { id: "41", name: "Route 41", color: "#7FBE39" },
  { id: "43", name: "Route 43", color: "#CF594A" },
  { id: "55", name: "Route 55", color: "#707070" },
  { id: "92", name: "Route 92", color: "#E87722" },
  { id: "93", name: "Route 93", color: "#59CBE8" },
  { id: "94", name: "Route 94", color: "#00B398" },
  { id: "95", name: "Route 95", color: "#F2A900" },
  { id: "97", name: "Route 97", color: "#053955" },
  { id: "106", name: "Route 106", color: "#007DBA" },
  { id: "120", name: "Route 120", color: "#7FBE39" },
  { id: "200", name: "Route 200", color: "#CF594A" },
];

const OFFICIAL_TOTALS = {
  1: 268640,
  2: 277303,
  3: 307953,
  4: 315938,
  5: 322056,
  6: 319644,
};

// Estimated monthly passenger trips by route and service-day category.
const ESTIMATES = {
  1: {
    orbt: { weekday: 38800, saturday: 5000, sunday: 2900 },
    "3": { weekday: 16000, saturday: 1600, sunday: 1100 },
    "4": { weekday: 23600, saturday: 2400, sunday: 1600 },
    "5": { weekday: 6600, saturday: 700, sunday: 0 },
    "8": { weekday: 3700, saturday: 500, sunday: 0 },
    "11": { weekday: 7700, saturday: 800, sunday: 100 },
    "13": { weekday: 11000, saturday: 1300, sunday: 800 },
    "14": { weekday: 6100, saturday: 700, sunday: 0 },
    "15": { weekday: 8500, saturday: 1300, sunday: 800 },
    "18": { weekday: 41600, saturday: 4900, sunday: 3300 },
    "24": { weekday: 26500, saturday: 2500, sunday: 1600 },
    "26": { weekday: 4100, saturday: 100, sunday: 100 },
    "30": { weekday: 10400, saturday: 1300, sunday: 800 },
    "35": { weekday: 5500, saturday: 400, sunday: 300 },
    "36": { weekday: 2400, saturday: 100, sunday: 100 },
    "41": { weekday: 4900, saturday: 0, sunday: 0 },
    "43": { weekday: 5200, saturday: 800, sunday: 0 },
    "55": { weekday: 3600, saturday: 300, sunday: 0 },
    "92": { weekday: 0, saturday: 0, sunday: 0 },
    "93": { weekday: 100, saturday: 0, sunday: 0 },
    "94": { weekday: 300, saturday: 0, sunday: 0 },
    "95": { weekday: 300, saturday: 0, sunday: 0 },
    "97": { weekday: 800, saturday: 0, sunday: 0 },
    "106": { weekday: 2100, saturday: 0, sunday: 0 },
    "120": { weekday: 300, saturday: 0, sunday: 0 },
    "200": { weekday: 500, saturday: 0, sunday: 0 },
  },
  2: {
    orbt: { weekday: 41000, saturday: 5000, sunday: 3800 },
    "3": { weekday: 16500, saturday: 1300, sunday: 1200 },
    "4": { weekday: 24500, saturday: 2400, sunday: 1800 },
    "5": { weekday: 6300, saturday: 500, sunday: 0 },
    "8": { weekday: 3800, saturday: 400, sunday: 0 },
    "11": { weekday: 7700, saturday: 800, sunday: 100 },
    "13": { weekday: 11100, saturday: 1100, sunday: 700 },
    "14": { weekday: 6300, saturday: 700, sunday: 0 },
    "15": { weekday: 10000, saturday: 1100, sunday: 900 },
    "18": { weekday: 43600, saturday: 4300, sunday: 3100 },
    "24": { weekday: 27500, saturday: 2800, sunday: 1800 },
    "26": { weekday: 4500, saturday: 0, sunday: 0 },
    "30": { weekday: 10900, saturday: 1300, sunday: 800 },
    "35": { weekday: 5800, saturday: 300, sunday: 100 },
    "36": { weekday: 2300, saturday: 0, sunday: 0 },
    "41": { weekday: 5500, saturday: 0, sunday: 0 },
    "43": { weekday: 5700, saturday: 700, sunday: 0 },
    "55": { weekday: 3600, saturday: 300, sunday: 0 },
    "92": { weekday: 100, saturday: 0, sunday: 0 },
    "93": { weekday: 0, saturday: 0, sunday: 0 },
    "94": { weekday: 100, saturday: 0, sunday: 0 },
    "95": { weekday: 0, saturday: 0, sunday: 0 },
    "97": { weekday: 700, saturday: 0, sunday: 0 },
    "106": { weekday: 1900, saturday: 0, sunday: 0 },
    "120": { weekday: 100, saturday: 0, sunday: 0 },
    "200": { weekday: 400, saturday: 0, sunday: 0 },
  },
  3: {
    orbt: { weekday: 47000, saturday: 5400, sunday: 4400 },
    "3": { weekday: 16700, saturday: 1300, sunday: 1300 },
    "4": { weekday: 27300, saturday: 2600, sunday: 2200 },
    "5": { weekday: 6300, saturday: 400, sunday: 0 },
    "8": { weekday: 4100, saturday: 400, sunday: 0 },
    "11": { weekday: 8700, saturday: 900, sunday: 400 },
    "13": { weekday: 12200, saturday: 1500, sunday: 1000 },
    "14": { weekday: 7100, saturday: 700, sunday: 0 },
    "15": { weekday: 9800, saturday: 1000, sunday: 1000 },
    "18": { weekday: 48200, saturday: 5100, sunday: 4100 },
    "24": { weekday: 30000, saturday: 2600, sunday: 2100 },
    "26": { weekday: 4800, saturday: 100, sunday: 100 },
    "30": { weekday: 12000, saturday: 1500, sunday: 1300 },
    "35": { weekday: 5700, saturday: 300, sunday: 300 },
    "36": { weekday: 2600, saturday: 100, sunday: 0 },
    "41": { weekday: 6200, saturday: 0, sunday: 0 },
    "43": { weekday: 6500, saturday: 900, sunday: 0 },
    "55": { weekday: 4000, saturday: 300, sunday: 0 },
    "92": { weekday: 300, saturday: 0, sunday: 0 },
    "93": { weekday: 100, saturday: 0, sunday: 0 },
    "94": { weekday: 400, saturday: 0, sunday: 0 },
    "95": { weekday: 100, saturday: 0, sunday: 0 },
    "97": { weekday: 700, saturday: 0, sunday: 0 },
    "106": { weekday: 2200, saturday: 0, sunday: 0 },
    "120": { weekday: 300, saturday: 0, sunday: 0 },
    "200": { weekday: 600, saturday: 0, sunday: 0 },
  },
  4: {
    orbt: { weekday: 49700, saturday: 5600, sunday: 4300 },
    "3": { weekday: 17200, saturday: 1300, sunday: 1100 },
    "4": { weekday: 29500, saturday: 2400, sunday: 2000 },
    "5": { weekday: 6900, saturday: 400, sunday: 0 },
    "8": { weekday: 4200, saturday: 200, sunday: 0 },
    "11": { weekday: 8900, saturday: 900, sunday: 400 },
    "13": { weekday: 13400, saturday: 1100, sunday: 700 },
    "14": { weekday: 8000, saturday: 500, sunday: 0 },
    "15": { weekday: 10500, saturday: 1100, sunday: 900 },
    "18": { weekday: 50800, saturday: 5200, sunday: 3600 },
    "24": { weekday: 31500, saturday: 3100, sunday: 1800 },
    "26": { weekday: 5100, saturday: 0, sunday: 0 },
    "30": { weekday: 12700, saturday: 1400, sunday: 1100 },
    "35": { weekday: 6000, saturday: 200, sunday: 200 },
    "36": { weekday: 2200, saturday: 0, sunday: 0 },
    "41": { weekday: 6000, saturday: 0, sunday: 0 },
    "43": { weekday: 6300, saturday: 700, sunday: 0 },
    "55": { weekday: 4000, saturday: 200, sunday: 0 },
    "92": { weekday: 0, saturday: 0, sunday: 0 },
    "93": { weekday: 0, saturday: 0, sunday: 0 },
    "94": { weekday: 200, saturday: 0, sunday: 0 },
    "95": { weekday: 0, saturday: 0, sunday: 0 },
    "97": { weekday: 500, saturday: 0, sunday: 0 },
    "106": { weekday: 2200, saturday: 0, sunday: 0 },
    "120": { weekday: 0, saturday: 0, sunday: 0 },
    "200": { weekday: 200, saturday: 0, sunday: 0 },
  },
  5: {
    orbt: { weekday: 44900, saturday: 7800, sunday: 5400 },
    "3": { weekday: 16700, saturday: 2100, sunday: 1600 },
    "4": { weekday: 28300, saturday: 3500, sunday: 2800 },
    "5": { weekday: 6600, saturday: 900, sunday: 0 },
    "8": { weekday: 4100, saturday: 600, sunday: 0 },
    "11": { weekday: 8900, saturday: 1500, sunday: 1200 },
    "13": { weekday: 12900, saturday: 2100, sunday: 1500 },
    "14": { weekday: 7500, saturday: 1000, sunday: 0 },
    "15": { weekday: 9700, saturday: 1800, sunday: 1300 },
    "18": { weekday: 48300, saturday: 8100, sunday: 5400 },
    "24": { weekday: 27600, saturday: 4100, sunday: 2900 },
    "26": { weekday: 4100, saturday: 300, sunday: 100 },
    "30": { weekday: 12300, saturday: 1900, sunday: 1500 },
    "35": { weekday: 5400, saturday: 600, sunday: 300 },
    "36": { weekday: 2200, saturday: 100, sunday: 100 },
    "41": { weekday: 6000, saturday: 0, sunday: 0 },
    "43": { weekday: 6300, saturday: 1000, sunday: 0 },
    "55": { weekday: 4000, saturday: 400, sunday: 0 },
    "92": { weekday: 400, saturday: 0, sunday: 0 },
    "93": { weekday: 300, saturday: 0, sunday: 0 },
    "94": { weekday: 300, saturday: 0, sunday: 0 },
    "95": { weekday: 100, saturday: 0, sunday: 0 },
    "97": { weekday: 600, saturday: 0, sunday: 0 },
    "106": { weekday: 1900, saturday: 0, sunday: 0 },
    "120": { weekday: 100, saturday: 0, sunday: 0 },
    "200": { weekday: 400, saturday: 0, sunday: 0 },
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
    name: "Metro (Omaha) July 2026 Updated Board Packet — Ridership by Route charts",
    url: "https://www.ometro.com/july-2026-board-packet-v3-7-21-2026/",
    note: "Approximate route-level trips estimated from bar heights on PDF page 31; values rounded to the nearest 100.",
    asOf: "2026-06",
    dataThrough: "June 2026",
    pages: "PDF page 31",
    method: "Bar-height estimate calibrated to each chart axis and scaled to monthly system totals.",
  },
  routes: ROUTES.map((route) => ({ ...route, estimated: true })),
  records,
};

const out = join(__dirname, "..", "data", "route-estimates-2026.json");
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`Wrote ${records.length} estimated route records to ${out}`);
console.log("Estimated monthly totals are within 1,000 trips of official system totals.");
