# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Goal & audience

A customizable dashboard of Omaha Metro **fixed-route passenger trips**. Users can
view trips by **day, month, and year**, and filter by **route** (e.g. Route 11,
ORBT) once route-level data is available.

The immediate purpose is to **show the Metro board** a working prototype in order
to encourage them to share route-level ridership data. Keep the presentation
polished and on-brand — this is a persuasion tool, not just an internal utility.

## Tech-stack constraints

- **Lit web components** (`LitElement` + lit-html) + **vanilla JavaScript** + **pure CSS**.
- **No build step.** The deploy output *is* the repo root. Files are served as-is.
- **Lit is vendored locally** (`vendor/lit.js`) and wired via the import map in
  `index.html` (`"lit": "./vendor/lit.js"`). No runtime CDN dependency.
- **No new libraries, modules, frameworks, or dependencies** — including no build
  tools, bundlers, CSS frameworks, or npm packages — **unless the maintainer
  (Todd) gives explicit permission.** Solve problems with the existing stack
  first. If you believe a dependency is genuinely warranted, ask before adding it.

## Style rules

- Follow **ometro.com's palette**. Design tokens live in `styles/global.css`.
  - **All blues use `#007DBA`** (Metro blue / primary). Do not introduce off-brand
    blue shades or gradients.
  - Supporting colors: navy `#053955`, gold `#F2A900`, ORBT orange `#E87722`,
    sky `#59CBE8`, teal `#00B398`, green `#7FBE39`, red `#CF594A`, gray `#707070`.
- Fonts: **Mulish** (body) and **Barlow Semi Condensed** (display headings).
- Use Metro's real logo/wordmark and favicon (already vendored).

## Data pipeline

**Never hand-edit `data/ridership.json`.** It is generated.

1. Edit the monthly figures in `scripts/build-data.mjs`.
2. Run `node scripts/build-data.mjs`.
3. The script sums each year's twelve monthly values and **verifies them against
   the chart's printed annual total** before writing. If a year doesn't match, it
   fails — fix the input rather than the output.

Source data comes from the Metro Board Packet ("Fixed-Route Passenger Trips
2019–2026" chart). The figures are read visually from an image chart in the PDF
(not extractable via `pdftotext`).

### Estimated route dataset

`data/route-estimates-2026.json` is also generated, but it is intentionally
separate from the official system-wide dataset. It contains approximate
route-level January-May 2026 totals estimated from the Amended June 2026 Board
Packet "Ridership by Route" bar charts on pages 101-103.

- **Never treat route estimates as official Metro data.** The UI marks these
  values as estimated, uses `~` in KPIs/tooltips, and keeps the footer caveat.
- Edit `scripts/build-route-estimates.mjs`, then run
  `node scripts/build-route-estimates.mjs` to regenerate
  `data/route-estimates-2026.json`.
- Estimate records use `estimated: true` and include optional `weekdayTrips`,
  `saturdayTrips`, and `sundayTrips` fields, while the chart uses the monthly
  `trips` total.
- The route estimates were scaled to the official monthly system totals and
  rounded to the nearest 100 trips. This is good enough for prototype
  exploration, not for final reporting.
- If Metro provides exact route-level data later, import it as official route
  records and either remove or clearly supersede this estimated dataset.

`index.html` loads both datasets: official system totals via `data-src` and
estimated route totals via `estimates-src`. `src/data-store.js` merges them while
preserving estimate metadata.

## Roadmap

- **Route-level series** (e.g. Route 11, ORBT) — the UI, data schema, and legend
  are already wired for multiple routes; they light up as soon as route data is
  imported.
- **Daily granularity** — the Day toggle activates automatically once daily
  records (rows with a `day` field) are present. The board packets don't publish
  daily data yet.

## Project layout

```
index.html                 import map + fonts + <metro-dashboard>
styles/global.css          design tokens (brand palette, type)
data/ridership.json        generated dataset (do not hand-edit)
data/route-estimates-2026.json generated estimated route dataset (do not hand-edit)
scripts/build-data.mjs     dataset generator (verifies annual totals)
scripts/build-route-estimates.mjs route-estimate generator
src/
  app.js                   entry point
  data-store.js            load / normalize / aggregate / summarize (no DOM)
  components/
    metro-dashboard.js     app root — owns state, wires children
    dashboard-controls.js  granularity / chart / year-range / route filters
    stat-cards.js          KPI summary cards
    ridership-chart.js     dependency-free SVG chart (bar/stacked/grouped/line)
    data-import.js         CSV / JSON import (currently unused, kept for re-enable)
vendor/lit.js              vendored Lit 3.2.1 bundle
```
