// Generates data/ridership.json from the verified Fixed-Route Passenger Trips
// figures transcribed from Metro (Omaha) monthly Board Packets.
//
// Source: ometro.com Board of Directors -> Board Agendas -> monthly Board Packet
//         "Fixed-Route Passenger Trips 2019 - 2026" chart (May 2026 packet, p.28).
// Each year's twelve monthly values were read from the chart and the sum was
// checked against the printed annual total before being committed here.
//
// Run:  node scripts/build-data.mjs
//
// When the Board supplies route-level numbers, add new entries to `routes`
// and push records with the matching `routeId` (and an optional `day`).
// This script only owns the system-wide "All Routes" series.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Monthly fixed-route passenger trips, Jan -> Dec, by year.
// 2026 is a partial year (Jan-Apr) at the time of the May 2026 packet.
const MONTHLY = {
  2019: [246549, 215669, 255145, 290589, 285332, 278260, 290204, 299048, 286399, 306193, 261682, 252775],
  2020: [253088, 260753, 215274, 163546, 170120, 161694, 145405, 152432, 150009, 160127, 142950, 151954],
  2021: [133220, 128071, 175627, 174555, 168486, 175991, 179249, 191143, 197675, 197284, 188131, 174789],
  2022: [170045, 174838, 207039, 198204, 214531, 225706, 220403, 250125, 253824, 271732, 242140, 205436],
  2023: [221680, 216605, 265168, 252984, 285001, 266103, 238136, 310563, 302739, 320112, 287233, 259495],
  2024: [215866, 283842, 270264, 310200, 305488, 266247, 264906, 291380, 305514, 335418, 280562, 256030],
  2025: [262067, 241867, 282490, 315926, 313787, 285685, 271089, 296700, 329072, 349607, 286209, 277538],
  2026: [268640, 277303, 307953, 315938],
};

// Annual totals printed on the chart — used purely to verify the transcription.
const PRINTED_TOTALS = {
  2019: 3267845, 2020: 2127352, 2021: 2084221, 2022: 2634023,
  2023: 3225819, 2024: 3385717, 2025: 3512037, 2026: 1169834,
};

for (const [year, months] of Object.entries(MONTHLY)) {
  const sum = months.reduce((a, b) => a + b, 0);
  if (sum !== PRINTED_TOTALS[year]) {
    throw new Error(`Total mismatch for ${year}: summed ${sum}, expected ${PRINTED_TOTALS[year]}`);
  }
}

const records = [];
for (const [year, months] of Object.entries(MONTHLY)) {
  months.forEach((trips, i) => {
    records.push({ routeId: "system", year: Number(year), month: i + 1, trips });
  });
}

const data = {
  title: "Omaha Metro — Fixed-Route Passenger Trips",
  source: {
    name: "Metro (Omaha) Board Packet — Fixed-Route Passenger Trips",
    url: "https://www.ometro.com/board-of-directors/",
    note: "Monthly system-wide fixed-route trips read from the Board Packet ridership chart.",
    asOf: "2026-05",
  },
  // Add route-level series here when the Board provides them, e.g.
  //   { "id": "11", "name": "Route 11", "color": "#00B398" }
  //   { "id": "orbt", "name": "ORBT", "color": "#E87722" }
  routes: [
    { id: "system", name: "All Routes (System Total)", color: "#007DBA" },
  ],
  records,
};

const out = join(__dirname, "..", "data", "ridership.json");
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`Wrote ${records.length} records to ${out}`);
console.log("All annual totals verified against the printed chart totals.");
