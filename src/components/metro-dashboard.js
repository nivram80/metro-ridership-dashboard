import { LitElement, html, css, nothing } from "lit";
import { loadData, mergeData, aggregate, summarize, fmtInt } from "../data-store.js";

import "./dashboard-controls.js";
import "./stat-cards.js";
import "./ridership-chart.js";
import "./ridership-table.js";

// ------------------------------------------------------------------
// <metro-dashboard> — application root. Owns the dataset and the
// canonical view state; derives the aggregate + summary on each render
// and hands them to the presentational children.
// ------------------------------------------------------------------
export class MetroDashboard extends LitElement {
  static properties = {
    dataSrc: { attribute: "data-src" },
    estimatesSrc: { attribute: "estimates-src" },
    _data: { state: true },
    _state: { state: true },
    _error: { state: true },
    _announcement: { state: true },
  };

  constructor() {
    super();
    this.dataSrc = "./data/ridership.json";
    this.estimatesSrc = "./data/route-estimates-2026.json";
    this._data = null;
    this._error = null;
    this._announcement = "";
    this._state = {
      granularity: "month",
      chartType: "bar",
      stacked: false,
      routeIds: [],
      fromYear: null,
      toYear: null,
    };
  }

  async connectedCallback() {
    super.connectedCallback();
    try {
      let data = await loadData(this.dataSrc);
      if (this.estimatesSrc) {
        try {
          data = mergeData(data, await loadData(this.estimatesSrc));
        } catch (err) {
          console.warn(`Could not load estimated route data: ${err.message}`);
        }
      }
      this._applyData(data);
    } catch (err) {
      this._error = err.message;
    }
  }

  _applyData(data) {
    this._data = data;
    // Initialize / reconcile view state against the (new) dataset.
    const ids = data.routes.map((r) => r.id);
    const keepRoutes = this._state.routeIds.filter((id) => ids.includes(id));
    this._state = {
      ...this._state,
      routeIds: keepRoutes.length ? keepRoutes : ids.slice(0, Math.min(ids.length, 1)),
      fromYear: this._state.fromYear ?? data.years[0],
      toYear: data.years.at(-1),                 // always extend to latest on import
      granularity: this._state.granularity === "day" && !data.hasDaily ? "month" : this._state.granularity,
    };
  }

  _onControlsChange(e) {
    let patch = { ...e.detail.patch };
    // keep year range coherent
    const next = { ...this._state, ...patch };
    if ("routeIds" in patch && this._data) {
      const selected = patch.routeIds
        .map((id) => this._data.routes.find((route) => route.id === id))
        .filter(Boolean);
      const wasEstimated = this._state.routeIds.some((id) => this._data.routes.find((route) => route.id === id)?.estimated);
      const isEstimated = selected.length > 0 && selected.every((route) => route.estimated);

      if (isEstimated) {
        const years = this._yearsForRoutes(patch.routeIds);
        if (years.length) {
          next.fromYear = years[0];
          next.toYear = years.at(-1);
        }
      } else if (wasEstimated) {
        next.fromYear = this._data.years[0];
        next.toYear = this._data.years.at(-1);
      }
    }
    if (next.fromYear > next.toYear) {
      if ("fromYear" in patch) next.toYear = next.fromYear;
      else next.fromYear = next.toYear;
    }
    this._state = next;
    this._announcement = this._announcementText(next);
  }

  _yearsForRoutes(routeIds) {
    const ids = new Set(routeIds);
    return [...new Set(this._data.records.filter((rec) => ids.has(rec.routeId)).map((rec) => rec.year))]
      .sort((a, b) => a - b);
  }

  // --- derived ---------------------------------------------------
  get _agg() {
    return aggregate(this._data, this._state);
  }

  _rangeLabel() {
    const { fromYear, toYear } = this._state;
    return fromYear === toYear ? `${fromYear}` : `${fromYear}–${toYear}`;
  }

  _announcementText(state) {
    const agg = aggregate(this._data, state);
    const routeCount = state.routeIds.length;
    const periodCount = agg.periods.length;
    const unit = state.granularity === "year" ? "year" : state.granularity === "month" ? "month" : "day";
    const estimated = agg.series.some((series) => series.estimated);
    const display = state.chartType === "table" ? "table" : `${state.chartType} chart`;
    const range = state.fromYear === state.toYear ? `${state.fromYear}` : `${state.fromYear} through ${state.toYear}`;
    return `Showing ${routeCount} ${routeCount === 1 ? "route" : "routes"}, ${periodCount} ${unit}${periodCount === 1 ? "" : "s"}, ${range}, ${estimated ? "approximately " : ""}${fmtInt(agg.grandTotal)} trips, as a ${display}.`;
  }

  _downloadCsv(agg) {
    const rows = [["period", "period_label", "route_id", "route_name", "trips", "estimated"]];
    agg.periods.forEach((period, periodIndex) => {
      agg.series.forEach((series) => {
        const point = series.points[periodIndex];
        rows.push([
          period.key,
          period.long,
          series.routeId,
          series.name,
          point?.value || 0,
          Boolean(series.estimated || point?.estimated),
        ]);
      });
    });
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `omaha-metro-ridership-${this._state.granularity}-${this._state.fromYear}-${this._state.toYear}.csv`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  render() {
    if (this._error) return this._renderError();
    if (!this._data) return this._renderLoading();

    const agg = this._agg;
    const stats = summarize(agg, this._data, this._state);

    return html`
      <header class="topbar">
        <div class="wrap topbar-inner">
          <div class="brand">
            <a class="brand-logo" href="https://www.ometro.com/" target="_blank"
               rel="noopener" aria-label="Metro — ometro.com">
              <!-- Official Metro wordmark (from ometro.com), recolored via currentColor -->
              <svg viewBox="0 0 200.7 59.6" role="img" aria-label="Metro">
                <g fill="currentColor">
                  <path d="M56.8,0H15.2C12.4,0.1,10,2.1,9.4,4.9L0.1,55.6c-0.5,2.7,1.4,4.4,4.1,3.9L65,47.8c2.9-0.7,5.2-2.9,5.9-5.8l3.7-20.1C76.9,9.9,68.9,0,56.8,0z M64.9,21.9l-3.2,17l-10.1,2l3.5-18.9c0.3-1.1-0.4-2.1-1.4-2.4c-0.2,0-0.4-0.1-0.5-0.1h-7.3l-4.3,23.3l-10.1,2l4.7-25.3h-9.7l-5.1,27.1l-10.1,2l7.3-38.8h36.6C61.7,9.7,66.2,15.3,64.9,21.9z"/>
                  <path d="M114.1,39h-4.7c-1.5,0-1.6-0.6-1.4-1.7l2.3-12.6c0.2-1.6,0.1-3.2-2-3.2c-2,0-3,1.5-3.6,2.8l-2.3,12.3c-0.3,1.4-0.7,2.3-1.9,2.3h-4.9c-0.9,0-1.4-0.6-1.1-1.7L97,24.7c0.2-1.6,0.1-3.2-2-3.2c-1.9,0.1-3.5,1.5-3.7,3.5l-2.2,12C88.8,38,88.7,39,87.5,39h-4.4c-1.4,0-1.6-0.7-1.4-1.8l3.7-20.2c0.1-0.9,0.6-1.6,1.5-1.6h4.7c1,0,1.6,0.2,1.2,2.2c1.9-1.9,4.4-2.9,7-2.8c2.5,0,4.7,1,5.4,3.8c2.3-2.5,4.6-3.8,7.9-3.8s6.5,2,5.5,7.5L116,36.5C115.7,38,115.2,39,114.1,39"/>
                  <path d="M140.4,29.1h-12.5c-0.6,3.1,1.2,4.9,5.2,4.9c2.4,0,4.9-0.3,7.3-0.7c0.9-0.1,1.2,0.1,1.1,0.7l-0.6,3.2c-0.2,1-0.6,1.4-1.7,1.7c-2.6,0.3-5.2,0.5-7.8,0.6c-9.5,0-11.8-4.7-10.5-12.3c1.6-8.8,5.9-12.8,13.8-12.8c7.3,0,10.1,3.6,9.1,9l-0.6,3.5C142.8,28.5,142.6,29.1,140.4,29.1 M133.6,19.1c-2.7,0-4.1,2.3-4.4,4.4c-0.1,0.6-0.2,1.1,0.4,1.1h5.9c0.5,0,0.6-0.4,0.6-1C136.6,21.2,136.3,19.1,133.6,19.1"/>
                  <path d="M158.3,20.7h-3.3c-0.1,0.4-2.1,11.1-2.2,11.7c-0.2,1.1,0.4,1.7,1.5,1.7c0.5,0,0.9,0,1.4-0.1c0.6-0.1,0.2,4.7-0.2,4.9c-1.6,0.5-3.3,0.7-5.1,0.7c-4.7,0-5.7-3.3-5.3-6.2c0.5-2.5,4.1-22.2,4.2-22.9c0.1-0.7,0.7-1.2,1.4-1.2c1.7-0.2,3.3-0.6,4.9-1c1.4-0.2,1.5,0.4,1.2,1.4l-1.1,5.7h3.5c1,0,1.1,0.7,1,1.6l-0.4,2.1C159.5,20.2,159.4,20.7,158.3,20.7"/>
                  <path d="M178.2,19.7c0,0.5-0.5,0.9-1,0.9c-1.2,0-2.4,0.2-3.6,0.7c-2.1,0.9-3.7,2.3-3.9,3.7l-2.2,11.7c-0.2,1.1-0.4,2.1-1.6,2.1h-4.4c-1.4,0-1.6-0.7-1.4-1.8l3.7-20.2c0.1-0.9,0.6-1.6,1.5-1.6h4.7c0.9,0,1.6,0.2,1.5,1.1c-0.1,0.5-0.1,0.9-0.2,1.5c2-2,4.6-3.1,7.4-3.1c0.4,0,0.9,0,0.7,0.6L178.2,19.7z"/>
                  <path d="M187.1,39.5c-8.1,0-11.1-3.2-9.5-12.2c1.7-9.5,6.3-12.8,14.2-12.8c6.9,0,10.2,3.5,8.5,12.8C198.9,35.3,194.1,39.5,187.1,39.5 M193.3,24.2c0.5-2.5,0.2-4.7-2.6-4.7c-2.3,0-3.8,2-4.3,4.8l-1,5.4c-0.5,2.8,0.4,4.9,2.6,4.9c2.3,0,3.8-2.6,4.3-5.2L193.3,24.2z"/>
                </g>
              </svg>
            </a>
            <span class="brand-divider" aria-hidden="true"></span>
            <span class="brand-sub">Ridership Dashboard</span>
          </div>
          <a class="site-link" href="https://www.ometro.com/" target="_blank"
             rel="noopener" aria-label="Back to ometro.com">
            <span class="site-link-text">ometro.com</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
      </header>

      <main class="wrap">
        <div class="sr-only" aria-live="polite" aria-atomic="true">${this._announcement}</div>
        <section class="hero">
          <h1>Fixed-Route Passenger Trips</h1>
          <p class="hero-sub">
            Explore Omaha Metro ridership by day, month, year and route.
            Showing <strong>${this._rangeLabel()}</strong>.
          </p>
        </section>

        <stat-cards .stats=${stats} rangeLabel=${this._rangeLabel()}></stat-cards>

        <section class="panel controls-panel">
          <dashboard-controls
            .routes=${this._data.routes}
            .years=${this._data.years}
            .state=${this._state}
            ?hasDaily=${this._data.hasDaily}
            @controls-change=${this._onControlsChange}>
          </dashboard-controls>
        </section>

        <section class="panel chart-panel">
          <div class="chart-head">
            <div>
              <h2>${this._chartTitle()}</h2>
              <p class="chart-meta">${this._chartMeta(agg)}</p>
            </div>
            <div class="chart-actions">
            ${this._data.routes.length > 1 && this._state.chartType !== "table" ? html`
              <div class="legend">
                ${this._state.routeIds.map((id) => {
                  const r = this._data.routes.find((x) => x.id === id);
                  return html`<span class="lg">
                    <span class="lg-dot" style="background:${r.color}"></span>${r.name}
                    ${r.estimated ? html`<span class="lg-est">estimated</span>` : nothing}
                  </span>`;
                })}
              </div>` : nothing}
              <button class="download" @click=${() => this._downloadCsv(agg)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>
                </svg>
                Download CSV
              </button>
            </div>
          </div>

          ${this._state.chartType === "table" ? html`
            <ridership-table
              .periods=${agg.periods}
              .series=${agg.series}
              rangeLabel=${this._rangeLabel()}>
            </ridership-table>
          ` : html`
            <ridership-chart
              .periods=${agg.periods}
              .series=${agg.series}
              chartType=${this._state.chartType}
              .stacked=${this._state.stacked}
              granularity=${this._state.granularity}
              accessibleLabel=${`${this._chartTitle()}. ${this._chartMeta(agg)}. Exact values are available in the Table display.`}>
            </ridership-chart>
          `}
        </section>

        <footer class="foot">
          <p>
            Source:
            ${this._data.source?.url
              ? html`<a href=${this._data.source.url} target="_blank" rel="noopener">${this._data.source?.name || "Metro Board Packet"}</a>`
              : (this._data.source?.name || "Metro Board Packet")}.
            Official system-wide fixed-route figures through ${this._data.source?.dataThrough || this._data.source?.asOf || "the latest reported month"}.
          </p>
          ${this._data.estimateSource ? html`
            <p class="foot-note">
              Route-level figures are estimates—not official Metro route totals—and are rounded to the nearest 100 from bar heights on ${this._data.estimateSource.pages || "the cited pages"} of
              <a href=${this._data.estimateSource.url} target="_blank" rel="noopener">${this._data.estimateSource.name}</a>.
            </p>` : nothing}
        </footer>
      </main>
    `;
  }

  _selectedRoutes() {
    return this._state.routeIds
      .map((id) => this._data.routes.find((route) => route.id === id))
      .filter(Boolean);
  }

  _hasEstimatedSelection() {
    return this._selectedRoutes().some((route) => route.estimated);
  }

  _chartTitle() {
    const g = this._state.granularity;
    const n = this._state.routeIds.length;
    const noun = g === "year" ? "Annual" : g === "month" ? "Monthly" : "Daily";
    const phrase = this._hasEstimatedSelection() ? `Estimated ${noun.toLowerCase()}` : noun;
    if (n === 1) {
      const r = this._data.routes.find((x) => x.id === this._state.routeIds[0]);
      return `${phrase} trips — ${r?.name ?? ""}`;
    }
    return `${phrase} trips — ${n} routes`;
  }

  _chartMeta(agg) {
    const c = agg.periods.length;
    if (!c) return "No data for this selection";
    const unit = this._state.granularity === "year" ? "year" : this._state.granularity === "month" ? "month" : "day";
    const estimate = this._hasEstimatedSelection() ? " · estimated route totals" : "";
    return `${c} ${unit}${c === 1 ? "" : "s"} · ${this._rangeLabel()}${estimate}`;
  }

  _renderLoading() {
    return html`<div class="state"><div class="spinner"></div><p>Loading ridership data…</p></div>`;
  }
  _renderError() {
    return html`
      <div class="state">
        <p class="err-title">Couldn’t load the data</p>
        <p>${this._error}</p>
        <p class="err-hint">
          If you opened <code>index.html</code> directly, serve the folder over HTTP instead —
          e.g. <code>python3 -m http.server</code> — so the browser can fetch the data file.
        </p>
      </div>`;
  }

  static styles = css`
    :host { display: block; }
    .wrap { max-width: var(--maxw, 1180px); margin: 0 auto; padding: 0 22px; }

    /* Top bar */
    .topbar {
      background: var(--metro-blue, #007DBA);
      box-shadow: 0 1px 0 rgba(0,0,0,.08);
      position: sticky; top: 0; z-index: 30;
    }
    .topbar-inner { display: flex; align-items: center; justify-content: space-between; height: 64px; }
    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand-logo {
      display: inline-flex; align-items: center; color: #fff;
      transition: transform .2s ease, opacity .2s ease;
    }
    .brand-logo:hover { transform: scale(1.03); opacity: .92; }
    .brand-logo svg { width: 118px; height: auto; display: block; }
    .brand-divider {
      width: 1px; height: 26px; background: rgba(255,255,255,.35); flex: none;
    }
    .brand-sub {
      font-family: var(--font-display, sans-serif); font-weight: 600;
      font-size: 14px; letter-spacing: .03em; color: rgba(255,255,255,.92); white-space: nowrap;
    }
    /* "Back to ometro.com" ghost link */
    .site-link {
      display: inline-flex; align-items: center; gap: 7px; flex: none;
      font-family: var(--font-body, sans-serif); font-weight: 700; font-size: 13.5px;
      color: #fff; text-decoration: none; white-space: nowrap;
      background: rgba(255,255,255,.10);
      border: 1px solid rgba(255,255,255,.38); border-radius: 9px;
      padding: 8px 13px; transition: background .15s ease, border-color .15s ease;
    }
    .site-link:hover { background: rgba(255,255,255,.20); border-color: rgba(255,255,255,.65); }
    .site-link svg { width: 14px; height: 14px; flex: none; }

    @media (max-width: 640px) {
      .brand-logo svg { width: 100px; }
      .brand-divider, .brand-sub { display: none; }
      .site-link { padding: 8px 10px; }
      .site-link-text { display: none; }   /* icon-only on very small screens */
    }

    /* Hero */
    .hero { padding: 30px 0 18px; }
    .hero h1 { font-size: clamp(28px, 4vw, 40px); color: var(--ink, #053955); }
    .hero-sub { margin: 8px 0 0; color: var(--muted, #5b6b75); font-size: 15.5px; }
    .hero-sub strong { color: var(--metro-blue, #007DBA); }

    /* Panels */
    .panel {
      background: var(--card, #fff); border: 1px solid var(--line, #dfe4e8);
      border-radius: var(--radius, 14px); box-shadow: var(--shadow-sm, 0 1px 3px rgba(5,57,85,.08));
      padding: 20px 22px; margin-top: 18px;
    }
    .controls-panel { margin-top: 18px; }

    .chart-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; margin-bottom: 6px;
    }
    .chart-actions { display: flex; align-items: center; justify-content: flex-end; gap: 14px; flex-wrap: wrap; }
    .chart-head h2 { margin: 0; font-size: 21px; color: var(--ink, #053955); }
    .chart-meta { margin: 4px 0 0; font-size: 13px; color: var(--muted-2,#8a97a0); }
    .legend { display: flex; flex-wrap: wrap; gap: 12px 16px; }
    .lg { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--muted,#5b6b75); }
    .lg-dot { width: 11px; height: 11px; border: 1px solid var(--ink, #053955); border-radius: 3px; }
    .lg-est {
      /* 12px line-height + 2px padding + 2px border = an even 18px box. Under the
         previous line-height:1 the box came out 18.5px, so the 1px borders landed
         on half-pixels and rasterised unevenly — which reads as the text sitting
         off-centre even though it measures centred to within 0.05px. */
      font-size: 10.5px; line-height: 12px; text-transform: uppercase; letter-spacing: .06em;
      color: var(--muted, #5b6b75); border: 1px solid var(--metro-gray, #707070);
      border-radius: 999px; padding: 2px 5px;
    }
    .download {
      display: inline-flex; align-items: center; gap: 7px; flex: none;
      appearance: none; border: 1px solid var(--metro-blue, #007DBA); border-radius: 9px;
      padding: 8px 11px; color: var(--metro-blue, #007DBA); background: #fff;
      font-family: var(--font-body, sans-serif); font-size: 12.5px; font-weight: 800;
      cursor: pointer;
    }
    .download:hover { background: #eef7fb; }
    .download:focus-visible { outline: 3px solid var(--metro-blue, #007DBA); outline-offset: 3px; }
    .download svg { width: 15px; height: 15px; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    /* Footer */
    .foot { margin: 22px 0 48px; color: var(--muted, #5b6b75); font-size: 13px; }
    .foot a { font-weight: 700; }
    .foot-note { margin: 6px 0 0; color: var(--muted-2,#8a97a0); font-size: 12.5px; }

    /* States */
    .state { max-width: var(--maxw); margin: 0 auto; padding: 80px 22px; text-align: center; color: var(--muted, #5b6b75); }
    .err-title { font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 22px; color: var(--metro-red,#CF594A); }
    .err-hint { font-size: 13px; }
    code { background: #eef2f5; border-radius: 4px; padding: 1px 5px; }
    .spinner {
      width: 34px; height: 34px; margin: 0 auto 14px; border-radius: 50%;
      border: 3px solid #dfe9ef; border-top-color: var(--metro-blue, #007DBA);
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 560px) {
      .wrap { padding: 0 16px; }
      .panel { padding: 16px; }
    }
  `;
}

customElements.define("metro-dashboard", MetroDashboard);

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
