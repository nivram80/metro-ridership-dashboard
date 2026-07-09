// ------------------------------------------------------------------
// Data layer: loading, normalizing, aggregating and filtering ridership
// records. Kept free of any DOM / Lit code so it can be unit-reasoned
// about on its own.
//
// Record shape:
//   { routeId: string, year: number, month: number, day?: number, trips: number }
// A record with no `day` is a monthly total; with `day` it is a daily total.
// ------------------------------------------------------------------

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const SERIES_PALETTE = [
  "#007DBA", "#E87722", "#00B398", "#F2A900",
  "#053955", "#59CBE8", "#7FBE39", "#CF594A",
];

export async function loadData(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load data (${res.status})`);
  const raw = await res.json();
  return normalize(raw);
}

// Accepts the canonical { routes, records } object, fills in any missing
// route metadata, and assigns colors to routes that don't declare one.
export function normalize(raw) {
  const datasetEstimated = Boolean(raw.estimated || raw.source?.estimated);
  const records = (raw.records || []).map((r) => ({
    routeId: String(r.routeId ?? "system"),
    year: Number(r.year),
    month: Number(r.month),
    day: r.day == null ? null : Number(r.day),
    trips: Number(r.trips) || 0,
    estimated: Boolean(r.estimated ?? datasetEstimated),
    weekdayTrips: r.weekdayTrips == null ? null : Number(r.weekdayTrips),
    saturdayTrips: r.saturdayTrips == null ? null : Number(r.saturdayTrips),
    sundayTrips: r.sundayTrips == null ? null : Number(r.sundayTrips),
  }));

  const declared = new Map((raw.routes || []).map((r) => [String(r.id), { ...r, id: String(r.id) }]));

  // Ensure every routeId present in records has a route entry.
  const order = [];
  for (const rec of records) {
    if (!declared.has(rec.routeId)) {
      declared.set(rec.routeId, { id: rec.routeId, name: rec.routeId });
    }
    if (!order.includes(rec.routeId)) order.push(rec.routeId);
  }

  const routes = order.map((id, i) => {
    const r = declared.get(id);
    return {
      id,
      name: r.name || id,
      color: r.color || SERIES_PALETTE[i % SERIES_PALETTE.length],
      estimated: Boolean(r.estimated ?? datasetEstimated),
    };
  });

  return {
    title: raw.title || "Ridership",
    source: raw.source || null,
    estimateSource: raw.estimateSource || null,
    routes,
    records,
    hasDaily: records.some((r) => r.day != null),
    hasEstimates: routes.some((r) => r.estimated),
    years: [...new Set(records.map((r) => r.year))].sort((a, b) => a - b),
  };
}

// Merge an imported dataset into an existing one. Imported records for a
// given (routeId, period) replace existing ones; new routes are appended.
export function mergeData(base, incoming) {
  const inc = normalize(incoming);

  const key = (r) => `${r.routeId}|${r.year}|${r.month}|${r.day ?? "_"}`;
  const map = new Map(base.records.map((r) => [key(r), r]));
  for (const r of inc.records) map.set(key(r), r);

  const routes = [...base.routes];
  const ids = new Set(routes.map((r) => r.id));
  for (const r of inc.routes) if (!ids.has(r.id)) routes.push(r);

  return normalize({
    title: base.title,
    source: base.source,
    estimateSource: base.estimateSource || inc.source || inc.estimateSource || null,
    routes,
    records: [...map.values()],
  });
}

// ------------------------------------------------------------------
// Period helpers
// ------------------------------------------------------------------

// A stable, sortable key for the bucket a record falls into at a given
// granularity, plus short/long display labels.
function periodFor(rec, granularity) {
  if (granularity === "year") {
    return { key: `${rec.year}`, sort: rec.year * 10000,
             short: `${rec.year}`, long: `${rec.year}` };
  }
  if (granularity === "month") {
    const m = rec.month;
    return {
      key: `${rec.year}-${String(m).padStart(2, "0")}`,
      sort: rec.year * 10000 + m * 100,
      short: `${MONTH_NAMES[m - 1]} ’${String(rec.year).slice(2)}`,
      long: `${MONTH_FULL[m - 1]} ${rec.year}`,
    };
  }
  // day
  const m = rec.month, d = rec.day ?? 1;
  return {
    key: `${rec.year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    sort: rec.year * 10000 + m * 100 + d,
    short: `${MONTH_NAMES[m - 1]} ${d}`,
    long: `${MONTH_FULL[m - 1]} ${d}, ${rec.year}`,
  };
}

// ------------------------------------------------------------------
// Aggregation
//
// Returns:
//   {
//     periods: [{ key, short, long }],          // x-axis, sorted
//     series:  [{ routeId, name, color,
//                 points: [{ key, value }],     // aligned to periods
//                 total }],
//     grandTotal
//   }
// ------------------------------------------------------------------
export function aggregate(data, opts) {
  const {
    granularity = "month",
    routeIds = data.routes.map((r) => r.id),
    fromYear = data.years[0],
    toYear = data.years.at(-1),
  } = opts || {};

  const routeSet = new Set(routeIds);
  const wanted = data.records.filter(
    (r) => routeSet.has(r.routeId) && r.year >= fromYear && r.year <= toYear &&
           // when bucketing by day, ignore monthly-only rows (no day)
           (granularity !== "day" || r.day != null)
  );

  // Collect the set of periods that actually have data.
  const periodMeta = new Map();        // key -> {key, sort, short, long}
  // routeId -> (periodKey -> { value, estimated })
  const byRoute = new Map(routeIds.map((id) => [id, new Map()]));

  for (const rec of wanted) {
    const p = periodFor(rec, granularity);
    if (!periodMeta.has(p.key)) periodMeta.set(p.key, p);
    const bucket = byRoute.get(rec.routeId);
    const prev = bucket.get(p.key) || { value: 0, estimated: false };
    bucket.set(p.key, {
      value: prev.value + rec.trips,
      estimated: prev.estimated || rec.estimated,
    });
  }

  const periods = [...periodMeta.values()].sort((a, b) => a.sort - b.sort)
    .map(({ key, short, long }) => ({ key, short, long }));

  const series = routeIds.map((id) => {
    const route = data.routes.find((r) => r.id === id) || { id, name: id, color: "#007DBA" };
    const bucket = byRoute.get(id) || new Map();
    const points = periods.map((p) => {
      const pt = bucket.get(p.key);
      return { key: p.key, value: pt?.value || 0, estimated: Boolean(pt?.estimated || route.estimated) };
    });
    const total = points.reduce((s, pt) => s + pt.value, 0);
    return { routeId: id, name: route.name, color: route.color, estimated: Boolean(route.estimated), points, total };
  });

  const grandTotal = series.reduce((s, ser) => s + ser.total, 0);

  return { periods, series, grandTotal };
}

// ------------------------------------------------------------------
// Summary statistics for the KPI cards (operates on an aggregate result)
// ------------------------------------------------------------------
export function summarize(agg, data, opts) {
  const { granularity } = opts;
  const { periods, series, grandTotal } = agg;

  // Per-period combined totals across all selected series.
  const combined = periods.map((p, i) => ({
    ...p,
    value: series.reduce((s, ser) => s + ser.points[i].value, 0),
  }));

  const nonEmpty = combined.filter((c) => c.value > 0);
  const avg = nonEmpty.length ? grandTotal / nonEmpty.length : 0;
  const peak = combined.reduce((best, c) => (c.value > (best?.value ?? -1) ? c : best), null);

  // Year-over-year: compare the two most recent *complete* years present in
  // the selected routes. A year is complete if it has 12 months of data.
  const yoy = computeYoY(data, opts);

  return {
    grandTotal,
    periodCount: nonEmpty.length,
    avg,
    avgLabel: granularity === "year" ? "Avg / year" : granularity === "month" ? "Avg / month" : "Avg / day",
    peak,
    yoy,
    estimated: series.some((ser) => ser.estimated),
  };
}

function computeYoY(data, { routeIds, fromYear, toYear }) {
  const routeSet = new Set(routeIds);
  const perYear = new Map();   // year -> { trips, months:Set }
  for (const r of data.records) {
    if (!routeSet.has(r.routeId)) continue;
    if (r.year < fromYear || r.year > toYear) continue;
    if (!perYear.has(r.year)) perYear.set(r.year, { trips: 0, months: new Set() });
    const y = perYear.get(r.year);
    y.trips += r.trips;
    y.months.add(r.month);
  }
  const complete = [...perYear.entries()]
    .filter(([, v]) => v.months.size >= 12)
    .sort((a, b) => a[0] - b[0]);
  if (complete.length < 2) return null;
  const [py, p] = [complete.at(-2), complete.at(-1)];
  const change = (p[1].trips - py[1].trips) / py[1].trips;
  return { fromYear: py[0], toYear: p[0], pct: change, latest: p[1].trips };
}

// ------------------------------------------------------------------
// Formatting helpers shared by components
// ------------------------------------------------------------------
export const fmtInt = (n) => Math.round(n).toLocaleString("en-US");

export const fmtCompact = (n) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + "M";
  if (a >= 1_000) return Math.round(n / 1000) + "K";
  return `${Math.round(n)}`;
};

export const fmtPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
