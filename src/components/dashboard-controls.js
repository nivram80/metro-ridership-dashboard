import { LitElement, html, css, nothing } from "lit";

// ------------------------------------------------------------------
// <dashboard-controls> — the filter/customization bar. Stateless: it
// renders from the `state` it's given and emits a single
// `controls-change` CustomEvent ({ detail: { patch } }) whenever the
// user changes something. The parent owns the canonical state.
// ------------------------------------------------------------------
export class DashboardControls extends LitElement {
  static properties = {
    routes: { attribute: false },     // [{id,name,color}]
    years: { attribute: false },      // [2019, ...]
    state: { attribute: false },      // chartType is "bar", "line", or "table"
    hasDaily: { type: Boolean },
  };

  constructor() {
    super();
    this.routes = [];
    this.years = [];
    this.state = {};
    this.hasDaily = false;
  }

  _emit(patch) {
    this.dispatchEvent(new CustomEvent("controls-change", {
      detail: { patch }, bubbles: true, composed: true,
    }));
  }

  _toggleRoute(id) {
    const route = this.routes.find((r) => r.id === id);
    if (!route) return;

    if (!route.estimated) {
      this._emit({ routeIds: [id] });
      return;
    }

    const set = new Set(
      this.state.routeIds.filter((routeId) => this.routes.find((r) => r.id === routeId)?.estimated)
    );
    if (set.has(id)) set.delete(id);
    else set.add(id);

    if (set.size === 0) {
      const system = this.routes.find((r) => !r.estimated);
      this._emit({ routeIds: system ? [system.id] : [id] });
      return;
    }

    // preserve route declaration order
    this._emit({ routeIds: this.routes.map((r) => r.id).filter((x) => set.has(x)) });
  }

  render() {
    const s = this.state;
    const multi = (s.routeIds || []).length > 1;
    const officialRoutes = this.routes.filter((r) => !r.estimated);
    const estimatedRoutes = this.routes.filter((r) => r.estimated);
    return html`
      <div class="bar">
        <div class="group">
          <span class="label">View by</span>
          <div class="seg" role="group" aria-label="View by">
            ${this._segBtn("day", "Day", s.granularity, "granularity",
              this.hasDaily ? "" : "Monthly source data — import daily data to enable")}
            ${this._segBtn("month", "Month", s.granularity, "granularity")}
            ${this._segBtn("year", "Year", s.granularity, "granularity")}
          </div>
        </div>

        <div class="group">
          <span class="label">Display</span>
          <div class="seg" role="group" aria-label="Display">
            ${this._segBtn("bar", "Bars", s.chartType, "chartType")}
            ${this._segBtn("line", "Line", s.chartType, "chartType")}
            ${this._segBtn("table", "Table", s.chartType, "chartType")}
          </div>
        </div>

        ${multi && s.chartType === "bar" ? html`
          <div class="group">
            <span class="label">Bars</span>
            <div class="seg" role="group" aria-label="Bar arrangement">
              <button class=${"sbtn " + (!s.stacked ? "on" : "")}
                aria-pressed=${!s.stacked}
                @click=${() => this._emit({ stacked: false })}>Grouped</button>
              <button class=${"sbtn " + (s.stacked ? "on" : "")}
                aria-pressed=${s.stacked}
                @click=${() => this._emit({ stacked: true })}>Stacked</button>
            </div>
          </div>` : nothing}

        <div class="group">
          <span class="label">Years</span>
          <div class="range" role="group" aria-label="Year range">
            <select class="sel" .value=${String(s.fromYear)} aria-label="From year"
              @change=${(e) => this._emit({ fromYear: Number(e.target.value) })}>
              ${this.years.map((y) => html`<option value=${y} ?selected=${y === s.fromYear}>${y}</option>`)}
            </select>
            <span class="dash">–</span>
            <select class="sel" .value=${String(s.toYear)} aria-label="To year"
              @change=${(e) => this._emit({ toYear: Number(e.target.value) })}>
              ${this.years.map((y) => html`<option value=${y} ?selected=${y === s.toYear}>${y}</option>`)}
            </select>
          </div>
        </div>
      </div>

      <div class="routes">
        ${this._routeGroup("System", officialRoutes)}
        ${estimatedRoutes.length ? this._routeGroup("Estimated routes", estimatedRoutes, "Approximate values from packet bar charts") : nothing}
      </div>
    `;
  }

  _routeGroup(label, routes, note = "") {
    if (!routes.length) return nothing;
    const estimated = routes.some((r) => r.estimated);
    return html`
      <div class=${"route-group " + (estimated ? "estimate-group" : "system-group")}>
        <div class="route-label">
          <span class="label">${label}</span>
          ${note ? html`<span class="route-note">${note}</span>` : nothing}
        </div>
        <div class="chips" role="group" aria-label=${note ? `${label}. ${note}` : label}>
          ${routes.map((r) => {
            const on = this.state.routeIds.includes(r.id);
            const aria = r.estimated ? `${r.name}, estimated route total` : r.name;
            return html`
              <button class=${"chip " + (on ? "on" : "") + (r.estimated ? " estimated" : "")}
                aria-pressed=${on}
                aria-label=${aria}
                title=${r.estimated ? "Estimated route total" : nothing}
                @click=${() => this._toggleRoute(r.id)}>
                <span class=${on ? "state-icon selected" : "state-icon"}
                  style=${on ? "" : `background:${r.color}`}
                  aria-hidden="true">${on
                    ? html`<svg viewBox="0 0 12 12" fill="none" stroke="currentColor"
                        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2.6 6.4 4.9 8.6 9.4 3.4" />
                      </svg>`
                    : nothing}</span>
                <span>${r.name}</span>
              </button>`;
          })}
        </div>
      </div>
    `;
  }

  _segBtn(value, text, current, field, title = "") {
    const disabled = field === "granularity" && value === "day" && !this.hasDaily;
    return html`
      <button class=${"sbtn " + (current === value ? "on" : "")}
        ?disabled=${disabled} title=${title || nothing} aria-pressed=${current === value}
        @click=${() => !disabled && this._emit({ [field]: value })}>${text}</button>`;
  }

  static styles = css`
    :host { display: block; }
    .bar {
      display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 22px;
    }
    .group { display: flex; flex-direction: column; gap: 6px; }
    .label {
      font-family: var(--font-display, sans-serif); text-transform: uppercase;
      letter-spacing: .08em; font-size: 11px; font-weight: 600; color: var(--muted-2,#8a97a0);
    }

    .seg, .range { display: inline-flex; }
    .seg {
      background: #eef2f5; border-radius: 10px; padding: 3px;
    }
    .sbtn {
      appearance: none; border: 0; background: transparent; cursor: pointer;
      font-family: var(--font-body, sans-serif); font-weight: 700; font-size: 13.5px;
      color: var(--muted, #5b6b75); padding: 7px 14px; border-radius: 8px;
      transition: background .12s, color .12s, box-shadow .12s;
    }
    .sbtn:hover:not(.on):not([disabled]) { color: var(--ink, #053955); }
    .sbtn.on {
      background: #fff; color: var(--metro-blue, #007DBA);
      box-shadow: var(--shadow-sm, 0 1px 2px rgba(5,57,85,.12));
    }
    .sbtn[disabled] { opacity: .4; cursor: not-allowed; }
    .sbtn:focus-visible, .sel:focus-visible, .chip:focus-visible {
      outline: 3px solid var(--metro-blue, #007DBA); outline-offset: 3px;
    }

    .sel {
      appearance: none; font-family: var(--font-body, sans-serif); font-weight: 700;
      font-size: 14px; color: var(--ink, #053955); background: #fff;
      border: 1px solid var(--line, #dfe4e8); border-radius: 9px;
      padding: 8px 30px 8px 12px; cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23607079' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 11px center;
    }
    .range { align-items: center; gap: 8px; }
    .dash { color: var(--muted-2,#8a97a0); }

    .routes {
      display: grid; gap: 10px;
      margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line-2,#eef1f3);
    }
    .route-group { display: grid; gap: 7px; min-width: 0; }
    .system-group { grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 12px; }
    .estimate-group .route-label { flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
    .route-label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .route-note { font-size: 12px; color: var(--muted-2,#8a97a0); line-height: 1.35; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
    .chip {
      display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
      font-family: var(--font-body, sans-serif); font-weight: 700; font-size: 13px;
      color: var(--muted, #5b6b75); background: #fff;
      border: 1.5px solid var(--line, #dfe4e8); border-radius: 999px;
      padding: 6px 10px; transition: border-color .12s, color .12s, background .12s;
    }
    .chip:hover { border-color: var(--muted-2,#8a97a0); }
    .state-icon {
      display: inline-grid; place-items: center; width: 12px; height: 12px; flex: none;
      border: 1px solid var(--ink, #053955); border-radius: 50%; opacity: .75;
      color: #fff;
    }
    /* The check is inline SVG rather than a "✓" glyph on purpose: Mulish has no
       U+2713, so the glyph came from a fallback font while the line box was sized
       from Mulish's metrics — centring the line box left the mark 2.1px low. An
       SVG box centres geometrically, independent of font metrics. */
    .state-icon svg { display: block; width: 9px; height: 9px; }
    .state-icon.selected { background: var(--ink, #053955); opacity: 1; }
    .chip.on {
      color: var(--ink, #053955); background: #f4f7f9; border-color: var(--ink, #053955);
      box-shadow: inset 0 0 0 1px var(--ink, #053955);
    }

    @media (max-width: 640px) {
      .bar { gap: 12px 16px; }
      .sbtn { padding: 7px 11px; }
      .system-group { grid-template-columns: 1fr; }
    }
  `;
}

customElements.define("dashboard-controls", DashboardControls);
