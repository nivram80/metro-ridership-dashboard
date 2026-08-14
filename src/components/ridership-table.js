import { LitElement, html, css } from "lit";
import { fmtInt } from "../data-store.js";

// Accessible tabular equivalent of the currently filtered chart data.
export class RidershipTable extends LitElement {
  static properties = {
    periods: { attribute: false },
    series: { attribute: false },
    rangeLabel: { type: String },
  };

  constructor() {
    super();
    this.periods = [];
    this.series = [];
    this.rangeLabel = "";
  }

  _value(value, estimated) {
    const formatted = fmtInt(value);
    if (!estimated) return formatted;
    return html`
      <span aria-hidden="true">~${formatted}</span>
      <span class="sr-only">Approximately ${formatted}</span>
    `;
  }

  render() {
    const showTotal = this.series.length > 1;
    const hasEstimates = this.series.some((series) => series.estimated);
    return html`
      <div class="table-region" role="region" tabindex="0"
           aria-label="Ridership data table, scroll horizontally for additional routes">
        <table>
          <caption>
            Ridership by period and route${this.rangeLabel ? `, ${this.rangeLabel}` : ""}.
            ${hasEstimates ? "Route-level figures are estimated and rounded to the nearest 100." : "Figures are official Metro system totals."}
          </caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              ${this.series.map((series) => html`
                <th scope="col">
                  ${series.name}
                  ${series.estimated ? html`<span class="estimate">Estimated</span>` : ""}
                </th>
              `)}
              ${showTotal ? html`<th scope="col">Total</th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${this.periods.map((period, periodIndex) => {
              const total = this.series.reduce(
                (sum, series) => sum + (series.points[periodIndex]?.value || 0), 0,
              );
              const totalEstimated = this.series.some(
                (series) => series.estimated || series.points[periodIndex]?.estimated,
              );
              return html`
                <tr>
                  <th scope="row">${period.long}</th>
                  ${this.series.map((series) => {
                    const point = series.points[periodIndex];
                    return html`<td>${this._value(
                      point?.value || 0,
                      Boolean(series.estimated || point?.estimated),
                    )}</td>`;
                  })}
                  ${showTotal ? html`<td class="total">${this._value(total, totalEstimated)}</td>` : ""}
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  static styles = css`
    :host { display: block; }
    .table-region {
      max-height: 520px; overflow: auto; margin-top: 14px;
      border: 1px solid var(--line, #dfe4e8); border-radius: 10px;
    }
    .table-region:focus-visible {
      outline: 3px solid var(--metro-blue, #007DBA); outline-offset: 3px;
    }
    table {
      width: 100%; border-collapse: separate; border-spacing: 0;
      color: var(--ink, #053955); font-size: 13px;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    caption {
      text-align: left; padding: 12px 14px; white-space: normal;
      color: var(--muted, #5b6b75); font-size: 12.5px; line-height: 1.45;
      border-bottom: 1px solid var(--line, #dfe4e8);
    }
    th, td {
      padding: 10px 13px; text-align: right;
      border-bottom: 1px solid var(--line-2, #eef1f3);
    }
    thead th {
      position: sticky; top: 0; z-index: 2;
      background: #eef2f5; color: var(--ink, #053955);
      font-family: var(--font-display, sans-serif); font-weight: 700;
    }
    th:first-child {
      position: sticky; left: 0; z-index: 1; text-align: left;
      background: #fff; box-shadow: 1px 0 0 var(--line, #dfe4e8);
    }
    thead th:first-child { z-index: 3; background: #eef2f5; }
    tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
    tbody tr:nth-child(even) td, tbody tr:nth-child(even) th { background-color: #fafbfc; }
    /* The zebra rule above outranks a bare .total, which would leave the Total
       column tinted on odd rows and striped grey on even ones. Match its
       specificity per row parity so the column reads as one block. */
    tbody td.total { font-weight: 800; background-color: #f1f5f8; }
    tbody tr:nth-child(even) td.total { background-color: #e9eff4; }
    .estimate {
      display: block; margin-top: 2px; color: var(--muted, #5b6b75);
      font-family: var(--font-body, sans-serif); font-size: 10px;
      font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
  `;
}

customElements.define("ridership-table", RidershipTable);
