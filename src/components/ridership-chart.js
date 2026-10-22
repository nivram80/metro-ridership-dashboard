import { LitElement, html, svg, css, nothing } from "lit";
import { fmtInt, fmtCompact } from "../data-store.js";

// ------------------------------------------------------------------
// <ridership-chart> — a dependency-free SVG chart that renders the
// aggregated series as grouped bars, stacked bars, or lines, with a
// hover tooltip. Responsive via ResizeObserver.
//
// Properties:
//   periods    [{ key, short, long }]
//   series     [{ routeId, name, color, points:[{key,value}], total }]
//   chartType  "bar" | "line"
//   stacked    boolean        (only affects bar mode w/ >1 series)
//   granularity "day"|"month"|"year"
//   accessibleLabel string    (direct label avoids cross-shadow ARIA references)
//   compare    [keyA, keyB]   period keys pinned for comparison ("" = unset)
// Click a bar to pin it (two max); click again or use Clear to unpin.
// Emits `compare-change` ({ detail: { compare } }); the parent owns the state.
// ------------------------------------------------------------------
export class RidershipChart extends LitElement {
  static properties = {
    periods: { attribute: false },
    series: { attribute: false },
    chartType: { type: String },
    stacked: { type: Boolean },
    granularity: { type: String },
    accessibleLabel: { type: String },
    compare: { attribute: false },
    _w: { state: true },
    _hover: { state: true },
  };

  constructor() {
    super();
    this.periods = [];
    this.series = [];
    this.chartType = "bar";
    this.stacked = false;
    this.granularity = "month";
    this.accessibleLabel = "Passenger trips chart";
    this.compare = ["", ""];
    this._w = 800;
    this._hover = -1;
    this._ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && Math.abs(w - this._w) > 1) this._w = w;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.updateComplete.then(() => {
      const host = this.renderRoot.querySelector(".plot");
      if (host) this._ro.observe(host);
    });
  }
  disconnectedCallback() {
    this._ro.disconnect();
    super.disconnectedCallback();
  }

  // --- layout ----------------------------------------------------
  // Fixed horizontal margins keep `_rotate` independent of `_M`, avoiding a
  // getter cycle (_M -> _rotate -> _innerW -> _M).
  get _ML() { return 66; }
  get _MR() { return 18; }
  get _MT() { return 22; }
  get _M() { return { top: this._MT, right: this._MR, bottom: this._rotate ? 70 : 50, left: this._ML }; }
  get _H() { return 460; }
  get _innerW() { return Math.max(10, this._w - this._ML - this._MR); }
  get _innerH() { return this._H - this._MT - (this._rotate ? 70 : 50); }
  get _band() { return this._innerW / Math.max(1, this.periods.length); }
  get _rotate() {
    const innerW = Math.max(10, this._w - this._ML - this._MR);
    return this.granularity !== "year" && (innerW / Math.max(1, this.periods.length)) < 56;
  }

  get _yMax() {
    let max = 0;
    if (this.stacked && this.chartType === "bar" && this.series.length > 1) {
      for (let i = 0; i < this.periods.length; i++) {
        const sum = this.series.reduce((s, ser) => s + (ser.points[i]?.value || 0), 0);
        if (sum > max) max = sum;
      }
    } else {
      for (const ser of this.series)
        for (const pt of ser.points) if (pt.value > max) max = pt.value;
    }
    return max;
  }

  _yTicks() {
    const max = this._yMax;
    if (max <= 0) return { ticks: [0], niceMax: 1 };
    const raw = max / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= niceMax + 1e-6; v += step) ticks.push(v);
    return { ticks, niceMax };
  }

  _y(value, niceMax) { return this._M.top + this._innerH * (1 - value / niceMax); }
  _xBandStart(i) { return this._M.left + i * this._band; }

  // Index of each compared period in `periods`, or -1 when unset/out of range.
  get _cmpIdx() {
    return (this.compare || []).map((key) => (key ? this.periods.findIndex((p) => p.key === key) : -1));
  }
  _toggleCompare(i) {
    const key = this.periods[i]?.key;
    if (!key) return;
    const next = [...(this.compare || []), "", ""].slice(0, 2);
    const at = next.indexOf(key);
    if (at >= 0) next[at] = "";
    else if (!next[0]) next[0] = key;
    else next[1] = key;          // both taken: replace B
    this.dispatchEvent(new CustomEvent("compare-change", { detail: { compare: next }, bubbles: true, composed: true }));
  }
  _isCompared(i) { return this._cmpIdx.includes(i); }
  _anyCompared() { return this._cmpIdx.some((i) => i >= 0); }

  // --- render ----------------------------------------------------
  render() {
    return html`
      ${this._anyCompared() ? this._renderCompareCard() : nothing}
      <div class="plot" @mouseleave=${() => (this._hover = -1)}>
        ${this.periods.length === 0 ? this._renderEmpty() : this._renderSvg()}
        ${this._hover >= 0 && this.periods.length ? this._renderTooltip() : nothing}
      </div>
      ${this.periods.length > 1 && !this._anyCompared()
        ? html`<p class="cmp-tip">Click a bar to pin it, then another to compare two periods.</p>` : nothing}
    `;
  }

  _renderEmpty() {
    const daily = this.granularity === "day";
    return html`
      <div class="empty">
        <div class="empty-mark">📊</div>
        <p class="empty-title">${daily ? "No daily data available yet" : "Nothing to show"}</p>
        <p class="empty-sub">
          ${daily
            ? html`The Board Packet reports ridership monthly. Switch to
                <strong>Month</strong> or <strong>Year</strong>, or import a daily
                CSV to unlock this view.`
            : "Select at least one route and a valid year range."}
        </p>
      </div>`;
  }

  _renderSvg() {
    const { ticks, niceMax } = this._yTicks();
    const W = this._w, H = this._H;
    return html`
      <svg viewBox="0 0 ${W} ${H}" width="100%" height=${H}
           role="img" aria-label=${this.accessibleLabel} preserveAspectRatio="none">
        ${this._renderGrid(ticks, niceMax)}
        ${this.chartType === "line" ? this._renderLines(niceMax) : this._renderBars(niceMax)}
        ${this._renderHoverLayer()}
        ${this._renderXAxis()}
      </svg>
    `;
  }

  _renderGrid(ticks, niceMax) {
    const x0 = this._M.left, x1 = this._w - this._M.right;
    return svg`
      ${ticks.map((t) => {
        const y = this._y(t, niceMax);
        return svg`
          <line class="grid" x1=${x0} x2=${x1} y1=${y} y2=${y}></line>
          <text class="ytick" x=${x0 - 12} y=${y + 4} text-anchor="end">${fmtCompact(t)}</text>`;
      })}
    `;
  }

  _renderBars(niceMax) {
    const n = this.series.length;
    const grouped = !this.stacked && n > 1;
    const pad = Math.min(0.34, 6 / this._band);     // gap between bands
    const bw = this._band * (1 - pad);
    const bx0off = (this._band - bw) / 2;
    const baseY = this._y(0, niceMax);

    return svg`${this.periods.map((p, i) => {
      const bandStart = this._xBandStart(i);
      const dim = (this._hover >= 0 || this._anyCompared()) && this._hover !== i && !this._isCompared(i);
      if (grouped) {
        const gw = bw / n;
        return svg`<g class=${dim ? "dim" : ""}>${this.series.map((ser, s) => {
          const v = ser.points[i]?.value || 0;
          const y = this._y(v, niceMax);
          return svg`<rect class="bar" x=${bandStart + bx0off + s * gw + 0.6}
            y=${y} width=${Math.max(0, gw - 1.2)} height=${Math.max(0, baseY - y)}
            rx="2" fill=${ser.color}></rect>`;
        })}</g>`;
      }
      // stacked (or single series)
      let acc = 0;
      return svg`<g class=${dim ? "dim" : ""}>${this.series.map((ser) => {
        const v = ser.points[i]?.value || 0;
        const yTop = this._y(acc + v, niceMax);
        const yBot = this._y(acc, niceMax);
        acc += v;
        return svg`<rect class="bar" x=${bandStart + bx0off} y=${yTop}
          width=${bw} height=${Math.max(0, yBot - yTop)} rx="2" fill=${ser.color}></rect>`;
      })}</g>`;
    })}`;
  }

  _renderLines(niceMax) {
    const cx = (i) => this._xBandStart(i) + this._band / 2;
    return svg`${this.series.map((ser) => {
      const pts = ser.points.map((pt, i) => [cx(i), this._y(pt.value, niceMax)]);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      const areaD = pts.length
        ? `${d} L${pts.at(-1)[0].toFixed(1)},${this._y(0, niceMax)} L${pts[0][0].toFixed(1)},${this._y(0, niceMax)} Z`
        : "";
      const single = this.series.length === 1;
      return svg`
        ${single ? svg`<path d=${areaD} fill=${ser.color} opacity="0.10"></path>` : nothing}
        <path class="line-outline" d=${d} fill="none"></path>
        <path class="line" d=${d} stroke=${ser.color} fill="none"></path>
        ${pts.map((p, i) => svg`<circle class="dot ${this._hover === i ? "on" : ""}"
            cx=${p[0]} cy=${p[1]} r=${this._hover === i || this._isCompared(i) ? 4.5 : 0} fill=${ser.color}></circle>`)}
      `;
    })}`;
  }

  // Transparent per-band rects capture hover + a highlight for the active band.
  _renderHoverLayer() {
    return svg`${this.periods.map((p, i) => {
      const x = this._xBandStart(i);
      const active = this._hover === i;
      const slot = this._cmpIdx.indexOf(i);
      return svg`
        ${slot >= 0 ? svg`<rect class="band-cmp slot${slot}" x=${x} y=${this._M.top}
            width=${this._band} height=${this._innerH}></rect>
          <g class="pill slot${slot}" transform="translate(${x + this._band / 2} ${this._M.top - 4})">
            <circle r="9"></circle><text y="4" text-anchor="middle">${slot ? "B" : "A"}</text></g>` : nothing}
        ${active ? svg`<rect class="band-hi" x=${x} y=${this._M.top}
            width=${this._band} height=${this._innerH}></rect>` : nothing}
        <rect class="band-hit" x=${x} y=${this._M.top} width=${this._band} height=${this._innerH}
          @click=${() => this._toggleCompare(i)}
          @mouseenter=${() => (this._hover = i)}
          @mousemove=${() => { if (this._hover !== i) this._hover = i; }}></rect>`;
    })}`;
  }

  _renderXAxis() {
    const maxLabels = Math.max(2, Math.floor(this._innerW / (this._rotate ? 38 : 64)));
    const step = Math.ceil(this.periods.length / maxLabels);
    const lastIndex = this.periods.length - 1;
    const labelCount = Math.min(
      this.periods.length,
      step === 1 ? this.periods.length : Math.ceil(lastIndex / step) + 1,
    );
    const labelIndices = new Set(
      Array.from({ length: labelCount }, (_, slot) =>
        labelCount === 1 ? 0 : Math.round((slot * lastIndex) / (labelCount - 1))),
    );
    const y = this._M.top + this._innerH + (this._rotate ? 14 : 20);
    const baseY = this._M.top + this._innerH;
    const x0 = this._M.left, x1 = this._w - this._M.right;
    return svg`
      <line class="axis" x1=${x0} x2=${x1} y1=${baseY} y2=${baseY}></line>
      ${this.periods.map((p, i) => {
        if (!labelIndices.has(i)) return nothing;
        const cx = this._xBandStart(i) + this._band / 2;
        return this._rotate
          ? svg`<text class="xtick" x=${cx} y=${y} text-anchor="end"
                  transform="rotate(-42 ${cx} ${y})">${p.short}</text>`
          : svg`<text class="xtick" x=${cx} y=${y} text-anchor="middle">${p.short}</text>`;
      })}
    `;
  }

  // Side-by-side card for the compared periods. Totals sum every selected
  // series, matching the tooltip's Total row. The change is later vs earlier,
  // whichever slot each was picked in.
  _renderCompareCard() {
    const cells = this._cmpIdx.map((i, slot) => {
      if (i < 0) return null;
      const estimated = this.series.some((ser) => ser.estimated || ser.points[i]?.estimated);
      const value = this.series.reduce((sum, ser) => sum + (ser.points[i]?.value || 0), 0);
      return { slot, i, long: this.periods[i].long, value, estimated };
    }).filter(Boolean);
    let delta = nothing;
    if (cells.length === 2) {
      const [from, to] = [...cells].sort((a, b) => a.i - b.i);
      const diff = to.value - from.value;
      const pct = from.value ? (diff / from.value) * 100 : null;
      const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
      const approx = from.estimated || to.estimated ? "~" : "";
      delta = html`
        <div class="cmp-delta">
          <span class="cmp-delta-val u-num">${sign}${approx}${fmtInt(Math.abs(diff))}${pct === null ? "" : html` <span class="cmp-pct">(${sign}${Math.abs(pct).toFixed(1)}%)</span>`}</span>
          <span class="cmp-delta-sub">${to.long} vs ${from.long}</span>
        </div>`;
    }
    return html`
      <div class="cmp" role="group" aria-label="Period comparison" aria-live="polite">
        ${cells.map((c) => html`
          <div class="cmp-cell">
            <span class="cmp-pill slot${c.slot}" aria-hidden="true">${c.slot ? "B" : "A"}</span>
            <div>
              <div class="cmp-period">${c.long}</div>
              <div class="cmp-val u-num">${this._value(c.value, c.estimated)}</div>
            </div>
          </div>`)}
        ${delta}
        <button class="cmp-clear" @click=${() => this.dispatchEvent(new CustomEvent("compare-change", { detail: { compare: ["", ""] }, bubbles: true, composed: true }))}>Clear</button>
        ${cells.length === 1 ? html`<div class="cmp-hint">Pick a second period to compare.</div>` : nothing}
      </div>`;
  }

  _renderTooltip() {
    const i = this._hover;
    const p = this.periods[i];
    const rows = this.series
      .map((ser) => ({
        name: ser.name,
        color: ser.color,
        value: ser.points[i]?.value || 0,
        estimated: Boolean(ser.estimated || ser.points[i]?.estimated),
      }))
      .filter((r) => this.series.length === 1 || r.value > 0);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const estimated = rows.some((r) => r.estimated);

    const cx = this._xBandStart(i) + this._band / 2;
    const leftPct = (cx / this._w) * 100;
    const flip = leftPct > 62;

    return html`
      <div class="tip ${flip ? "flip" : ""}" style="left:${leftPct}%">
        <div class="tip-period">${p.long}</div>
        ${rows.map((r) => html`
          <div class="tip-row">
            <span class="sw" style="background:${r.color}"></span>
            <span class="tip-name">${r.name}</span>
            <span class="tip-val u-num">${this._value(r.value, r.estimated)}</span>
          </div>`)}
        ${this.series.length > 1
          ? html`<div class="tip-row tip-total">
              <span class="sw" style="background:transparent"></span>
              <span class="tip-name">Total</span>
              <span class="tip-val u-num">${this._value(total, estimated)}</span></div>`
          : nothing}
      </div>`;
  }

  _value(value, estimated) {
    const formatted = fmtInt(value);
    if (!estimated) return formatted;
    return html`
      <span aria-hidden="true">~${formatted}</span>
      <span class="sr-only">Approximately ${formatted}</span>
    `;
  }

  static styles = css`
    :host { display: block; }
    .plot { position: relative; width: 100%; }
    svg { display: block; overflow: visible; }

    .grid { stroke: #eef1f3; stroke-width: 1; }
    .axis { stroke: #cdd6db; stroke-width: 1; }
    .ytick, .xtick {
      fill: var(--muted, #5b6b75); font-family: var(--font-body, sans-serif);
      font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .xtick { font-size: 12px; }

    .bar { stroke: var(--ink, #053955); stroke-width: .6; transition: opacity .12s ease; }
    .line-outline { stroke: var(--ink, #053955); stroke-width: 4.5; stroke-linejoin: round; stroke-linecap: round; }
    .line { stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
    .dot { stroke: var(--ink, #053955); stroke-width: 1.5; transition: r .1s ease; }
    g.dim { opacity: .32; transition: opacity .12s ease; }

    .band-cmp.slot0 { fill: rgba(0,125,186,.10); stroke: #007DBA; stroke-width: 1.5; }
    .band-cmp.slot1 { fill: rgba(242,169,0,.14); stroke: #F2A900; stroke-width: 1.5; }
    .pill.slot0 circle { fill: #007DBA; }
    .pill.slot1 circle { fill: #F2A900; }
    .pill text { font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 11px; fill: #fff; }
    .pill.slot1 text { fill: var(--ink, #053955); }

    /* Comparison card */
    .cmp {
      display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px;
      padding: 12px 16px; margin-bottom: 14px;
      background: #f4f7f9; border: 1px solid var(--line, #dfe4e8); border-radius: 12px;
    }
    .cmp-cell { display: flex; align-items: center; gap: 10px; }
    .cmp-pill {
      display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
      font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 12px; color: #fff;
    }
    .cmp-pill.slot0 { background: #007DBA; }
    .cmp-pill.slot1 { background: #F2A900; color: var(--ink, #053955); }
    .cmp-period { font-size: 12px; color: var(--muted, #5b6b75); font-weight: 700; }
    .cmp-val { font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 20px; color: var(--ink, #053955); }
    .cmp-delta { margin-left: auto; text-align: right; }
    .cmp-delta-val { font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 20px; color: var(--ink, #053955); }
    .cmp-pct { font-size: 15px; }
    .cmp-delta-sub { display: block; font-size: 12px; color: var(--muted, #5b6b75); }
    .cmp-clear {
      appearance: none; border: 0; background: transparent; cursor: pointer;
      font-family: var(--font-body, sans-serif); font-weight: 700; font-size: 13.5px;
      color: var(--metro-blue, #007DBA); text-decoration: underline; padding: 4px;
    }
    .cmp-clear:focus-visible { outline: 3px solid var(--metro-blue, #007DBA); outline-offset: 2px; }
    .cmp-tip { margin: 6px 0 0; font-size: 13px; color: var(--muted-2, #8a97a0); text-align: center; }
    .cmp-hint { font-size: 13px; color: var(--muted, #5b6b75); }

    .band-hit { fill: transparent; cursor: pointer; }
    .band-hi { fill: rgba(0,125,186,.06); }

    /* Tooltip */
    .tip {
      position: absolute; top: 8px; transform: translateX(-50%);
      background: #ffffff; border: 1px solid var(--line, #dfe4e8);
      border-radius: 10px; box-shadow: 0 8px 24px rgba(5,57,85,.16);
      padding: 10px 12px; min-width: 168px; pointer-events: none; z-index: 5;
    }
    .tip.flip { transform: translateX(-50%); }
    .tip-period {
      font-family: var(--font-display, sans-serif); font-weight: 700;
      color: var(--ink, #053955); font-size: 14px; margin-bottom: 6px;
      letter-spacing: .01em;
    }
    .tip-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
    .tip-name { color: var(--muted, #5b6b75); font-size: 13px; flex: 1; }
    .tip-val { color: var(--ink, #053955); font-weight: 700; font-size: 13px; }
    .tip-total { border-top: 1px solid var(--line-2,#eef1f3); margin-top: 4px; padding-top: 5px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    .empty {
      display: grid; place-items: center; text-align: center;
      min-height: 360px; padding: 2rem; color: var(--muted, #5b6b75);
    }
    .empty-mark { font-size: 34px; opacity: .7; }
    .empty-title {
      font-family: var(--font-display, sans-serif); font-weight: 700;
      font-size: 20px; color: var(--ink, #053955); margin: .4rem 0 .2rem;
    }
    .empty-sub { max-width: 420px; margin: 0; font-size: 14px; line-height: 1.5; }
  `;
}

customElements.define("ridership-chart", RidershipChart);
