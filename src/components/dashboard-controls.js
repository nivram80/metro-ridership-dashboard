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
    state: { attribute: false },      // { granularity, chartType, stacked, routeIds, fromYear, toYear }
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
    const set = new Set(this.state.routeIds);
    if (set.has(id)) { if (set.size > 1) set.delete(id); }   // keep at least one
    else set.add(id);
    // preserve route declaration order
    this._emit({ routeIds: this.routes.map((r) => r.id).filter((x) => set.has(x)) });
  }

  render() {
    const s = this.state;
    const multi = this.routes.length > 1;
    return html`
      <div class="bar">
        <div class="group">
          <span class="label">View by</span>
          <div class="seg" role="tablist" aria-label="Granularity">
            ${this._segBtn("day", "Day", s.granularity, "granularity",
              this.hasDaily ? "" : "Monthly source data — import daily data to enable")}
            ${this._segBtn("month", "Month", s.granularity, "granularity")}
            ${this._segBtn("year", "Year", s.granularity, "granularity")}
          </div>
        </div>

        <div class="group">
          <span class="label">Chart</span>
          <div class="seg" role="tablist" aria-label="Chart type">
            ${this._segBtn("bar", "Bars", s.chartType, "chartType")}
            ${this._segBtn("line", "Line", s.chartType, "chartType")}
          </div>
        </div>

        ${multi && s.chartType === "bar" ? html`
          <div class="group">
            <span class="label">Bars</span>
            <div class="seg">
              <button class=${"sbtn " + (s.stacked ? "on" : "")}
                @click=${() => this._emit({ stacked: true })}>Stacked</button>
              <button class=${"sbtn " + (!s.stacked ? "on" : "")}
                @click=${() => this._emit({ stacked: false })}>Grouped</button>
            </div>
          </div>` : nothing}

        <div class="group">
          <span class="label">Years</span>
          <div class="range">
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
        <span class="label">Routes</span>
        <div class="chips">
          ${this.routes.map((r) => {
            const on = this.state.routeIds.includes(r.id);
            return html`
              <button class=${"chip " + (on ? "on" : "")}
                style=${on ? `--chip:${r.color}` : ""}
                aria-pressed=${on}
                @click=${() => this._toggleRoute(r.id)}>
                <span class="dot" style="background:${r.color}"></span>${r.name}
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
        ?disabled=${disabled} title=${title || nothing}
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
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line-2,#eef1f3);
    }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
      font-family: var(--font-body, sans-serif); font-weight: 700; font-size: 13.5px;
      color: var(--muted, #5b6b75); background: #fff;
      border: 1.5px solid var(--line, #dfe4e8); border-radius: 999px;
      padding: 7px 14px; transition: border-color .12s, color .12s, background .12s;
    }
    .chip:hover { border-color: var(--muted-2,#8a97a0); }
    .chip .dot { width: 10px; height: 10px; border-radius: 50%; opacity: .35; transition: opacity .12s; }
    .chip.on {
      color: #fff; background: var(--chip, #007DBA); border-color: var(--chip, #007DBA);
    }
    .chip.on .dot { background: #fff !important; opacity: 1; }

    @media (max-width: 640px) {
      .bar { gap: 12px 16px; }
      .sbtn { padding: 7px 11px; }
    }
  `;
}

customElements.define("dashboard-controls", DashboardControls);
