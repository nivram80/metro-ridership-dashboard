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
// ------------------------------------------------------------------
export class RidershipChart extends LitElement {
  static properties = {
    periods: { attribute: false },
    series: { attribute: false },
    chartType: { type: String },
    stacked: { type: Boolean },
    granularity: { type: String },
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

  // --- render ----------------------------------------------------
  render() {
    return html`
      <div class="plot" @mouseleave=${() => (this._hover = -1)}>
        ${this.periods.length === 0 ? this._renderEmpty() : this._renderSvg()}
        ${this._hover >= 0 && this.periods.length ? this._renderTooltip() : nothing}
      </div>
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
           role="img" aria-label="Passenger trips chart" preserveAspectRatio="none">
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
      const dim = this._hover >= 0 && this._hover !== i;
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
        <path class="line" d=${d} stroke=${ser.color} fill="none"></path>
        ${pts.map((p, i) => svg`<circle class="dot ${this._hover === i ? "on" : ""}"
            cx=${p[0]} cy=${p[1]} r=${this._hover === i ? 4.5 : 0} fill=${ser.color}></circle>`)}
      `;
    })}`;
  }

  // Transparent per-band rects capture hover + a highlight for the active band.
  _renderHoverLayer() {
    return svg`${this.periods.map((p, i) => {
      const x = this._xBandStart(i);
      const active = this._hover === i;
      return svg`
        ${active ? svg`<rect class="band-hi" x=${x} y=${this._M.top}
            width=${this._band} height=${this._innerH}></rect>` : nothing}
        <rect class="band-hit" x=${x} y=${this._M.top} width=${this._band} height=${this._innerH}
          @mouseenter=${() => (this._hover = i)}
          @mousemove=${() => { if (this._hover !== i) this._hover = i; }}></rect>`;
    })}`;
  }

  _renderXAxis() {
    const maxLabels = Math.max(2, Math.floor(this._innerW / (this._rotate ? 38 : 64)));
    const step = Math.ceil(this.periods.length / maxLabels);
    const y = this._M.top + this._innerH + (this._rotate ? 14 : 20);
    const baseY = this._M.top + this._innerH;
    const x0 = this._M.left, x1 = this._w - this._M.right;
    return svg`
      <line class="axis" x1=${x0} x2=${x1} y1=${baseY} y2=${baseY}></line>
      ${this.periods.map((p, i) => {
        if (i % step !== 0 && i !== this.periods.length - 1) return nothing;
        const cx = this._xBandStart(i) + this._band / 2;
        return this._rotate
          ? svg`<text class="xtick" x=${cx} y=${y} text-anchor="end"
                  transform="rotate(-42 ${cx} ${y})">${p.short}</text>`
          : svg`<text class="xtick" x=${cx} y=${y} text-anchor="middle">${p.short}</text>`;
      })}
    `;
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
            <span class="tip-val u-num">${r.estimated ? "~" : ""}${fmtInt(r.value)}</span>
          </div>`)}
        ${this.series.length > 1
          ? html`<div class="tip-row tip-total">
              <span class="sw" style="background:transparent"></span>
              <span class="tip-name">Total</span>
              <span class="tip-val u-num">${estimated ? "~" : ""}${fmtInt(total)}</span></div>`
          : nothing}
      </div>`;
  }

  static styles = css`
    :host { display: block; }
    .plot { position: relative; width: 100%; }
    svg { display: block; overflow: visible; }

    .grid { stroke: #eef1f3; stroke-width: 1; }
    .axis { stroke: #cdd6db; stroke-width: 1; }
    .ytick, .xtick {
      fill: #7e8b93; font-family: var(--font-body, sans-serif);
      font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .xtick { font-size: 12px; }

    .bar { transition: opacity .12s ease; }
    .line { stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
    .dot { transition: r .1s ease; }
    g.dim { opacity: .32; transition: opacity .12s ease; }

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
