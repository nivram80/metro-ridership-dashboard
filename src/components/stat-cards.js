import { LitElement, html, css, nothing } from "lit";
import { fmtInt, fmtPct } from "../data-store.js";

// ------------------------------------------------------------------
// <stat-cards> — summary KPIs for the current selection.
// Property `stats` is the object returned by summarize().
// ------------------------------------------------------------------
export class StatCards extends LitElement {
  static properties = {
    stats: { attribute: false },
    rangeLabel: { type: String },
  };

  render() {
    const s = this.stats;
    if (!s) return nothing;
    const yoy = s.yoy;
    const up = yoy && yoy.pct >= 0;
    const approx = s.estimated ? "~" : "";

    return html`
      <div class="grid">
        ${this._card(s.estimated ? "Estimated passenger trips" : "Total passenger trips", `${approx}${fmtInt(s.grandTotal)}`, this.rangeLabel, "accent")}
        ${this._card(s.avgLabel, `${approx}${fmtInt(s.avg)}`, `${s.periodCount} period${s.periodCount === 1 ? "" : "s"}`)}
        ${this._card("Busiest period", s.peak ? `${approx}${fmtInt(s.peak.value)}` : "—", s.peak ? s.peak.long : "")}
        ${yoy
          ? this._card(
              "Year over year",
              html`<span class="yoy ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${fmtPct(yoy.pct)}</span>`,
              `${yoy.fromYear} → ${yoy.toYear} (full years)`)
          : this._card("Year over year", "—", "Needs 2 complete years")}
      </div>
    `;
  }

  _card(label, value, sub, kind = "") {
    return html`
      <div class="card ${kind}">
        <div class="card-label">${label}</div>
        <div class="card-value u-num">${value}</div>
        <div class="card-sub">${sub}</div>
      </div>`;
  }

  static styles = css`
    :host { display: block; }
    .grid {
      display: grid; gap: 14px;
      grid-template-columns: repeat(4, 1fr);
    }
    .card {
      background: var(--card, #fff); border: 1px solid var(--line, #dfe4e8);
      border-radius: var(--radius, 14px); padding: 16px 18px;
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(5,57,85,.08));
      position: relative; overflow: hidden;
    }
    .card.accent {
      background: var(--metro-blue, #007DBA);
      border-color: transparent;
    }
    .card.accent .card-label { color: rgba(255,255,255,.82); }
    .card.accent .card-value { color: #fff; }
    .card.accent .card-sub { color: rgba(255,255,255,.78); }

    .card-label {
      font-family: var(--font-display, sans-serif); text-transform: uppercase;
      letter-spacing: .07em; font-size: 11.5px; font-weight: 600;
      color: var(--muted-2,#8a97a0);
    }
    .card-value {
      font-family: var(--font-display, sans-serif); font-weight: 700;
      font-size: 32px; line-height: 1.1; margin: 6px 0 4px; color: var(--ink,#053955);
    }
    .card-sub { font-size: 12.5px; color: var(--muted,#5b6b75); }
    .yoy.up { color: var(--metro-green, #5fa524); }
    .yoy.down { color: var(--metro-red, #CF594A); }
    .card.accent .yoy { color: #fff; }

    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  `;
}

customElements.define("stat-cards", StatCards);
