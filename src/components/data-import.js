import { LitElement, html, css, nothing } from "lit";

// ------------------------------------------------------------------
// <data-import> — load a CSV or JSON file and merge it into the
// dashboard. Emits `data-imported` with { detail: { routes, records } }
// in the canonical schema. Built so the Board's route-level export can
// be dropped straight in.
//
// Accepted CSV columns (header row, any order, case-insensitive):
//   routeId, routeName, color, year, month, day, trips
//   - month: 1-12 (or a name like "Mar"/"March")
//   - day:   optional; include it for daily data
// Accepted JSON: { routes?: [...], records: [...] } (same schema as data/ridership.json)
// ------------------------------------------------------------------
export class DataImport extends LitElement {
  static properties = { _open: { state: true }, _msg: { state: true } };

  constructor() {
    super();
    this._open = false;
    this._msg = null;
  }

  async _onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = /\.json$/i.test(file.name) || text.trim().startsWith("{")
        ? this._parseJson(text)
        : this._parseCsv(text);
      if (!parsed.records.length) throw new Error("No rows found.");
      this.dispatchEvent(new CustomEvent("data-imported", {
        detail: parsed, bubbles: true, composed: true,
      }));
      this._msg = { ok: true, text: `Imported ${parsed.records.length} rows from ${file.name}.` };
    } catch (err) {
      this._msg = { ok: false, text: `Couldn’t import: ${err.message}` };
    } finally {
      e.target.value = "";   // allow re-importing the same file
    }
  }

  _parseJson(text) {
    const obj = JSON.parse(text);
    return { routes: obj.routes || [], records: (obj.records || []).map(this._coerce) };
  }

  _parseCsv(text) {
    const rows = csvRows(text).filter((r) => r.length && r.some((c) => c.trim() !== ""));
    if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const cR = idx("routeid"), cN = idx("routename"), cC = idx("color"),
          cY = idx("year"), cM = idx("month"), cD = idx("day"), cT = idx("trips");
    if (cY < 0 || cM < 0 || cT < 0)
      throw new Error("CSV must have at least year, month and trips columns.");

    const routes = new Map();
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const routeId = (cR >= 0 ? row[cR] : "system")?.trim() || "system";
      if (cN >= 0 && row[cN]?.trim()) {
        const r = routes.get(routeId) || { id: routeId };
        r.name = row[cN].trim();
        if (cC >= 0 && row[cC]?.trim()) r.color = row[cC].trim();
        routes.set(routeId, r);
      }
      records.push(this._coerce({
        routeId,
        year: row[cY],
        month: parseMonth(row[cM]),
        day: cD >= 0 ? row[cD] : undefined,
        trips: row[cT],
      }));
    }
    return { routes: [...routes.values()], records };
  }

  _coerce = (r) => ({
    routeId: String(r.routeId ?? "system"),
    year: Number(r.year),
    month: Number(r.month),
    day: r.day === undefined || r.day === null || r.day === "" ? null : Number(r.day),
    trips: Number(String(r.trips).replace(/[, ]/g, "")) || 0,
  });

  _downloadTemplate() {
    const csv =
      "routeId,routeName,color,year,month,day,trips\n" +
      "11,Route 11,#00B398,2026,1,,18450\n" +
      "11,Route 11,#00B398,2026,2,,17980\n" +
      "orbt,ORBT,#E87722,2026,1,,42310\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "metro-ridership-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  render() {
    return html`
      <button class="trigger" @click=${() => (this._open = !this._open)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Import data
      </button>

      ${this._open ? html`
        <div class="pop">
          <p class="pop-title">Import route ridership</p>
          <p class="pop-body">
            Drop in a <strong>CSV</strong> or <strong>JSON</strong> file. Useful columns:
            <code>routeId, routeName, color, year, month, day, trips</code>.
            Leave <code>day</code> blank for monthly totals.
          </p>
          <div class="pop-actions">
            <label class="file-btn">
              Choose file…
              <input type="file" accept=".csv,.json,text/csv,application/json" @change=${this._onFile} hidden />
            </label>
            <button class="link" @click=${this._downloadTemplate}>Download CSV template</button>
          </div>
          ${this._msg ? html`<p class="msg ${this._msg.ok ? "ok" : "err"}">${this._msg.text}</p>` : nothing}
        </div>` : nothing}
    `;
  }

  static styles = css`
    :host { position: relative; display: inline-block; }
    .trigger {
      display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
      font-family: var(--font-body, sans-serif); font-weight: 700; font-size: 13.5px;
      color: var(--metro-blue, #007DBA); background: #fff;
      border: 1.5px solid var(--line, #dfe4e8); border-radius: 9px; padding: 8px 13px;
      transition: border-color .12s, background .12s;
    }
    .trigger:hover { border-color: var(--metro-blue, #007DBA); background: #f4fbff; }

    .pop {
      position: absolute; right: 0; top: calc(100% + 8px); width: 320px; z-index: 20;
      background: #fff; border: 1px solid var(--line, #dfe4e8); border-radius: 12px;
      box-shadow: 0 12px 30px rgba(5,57,85,.18); padding: 16px;
    }
    .pop-title {
      font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 15px;
      margin: 0 0 6px; color: var(--ink, #053955);
    }
    .pop-body { margin: 0 0 12px; font-size: 12.8px; line-height: 1.5; color: var(--muted, #5b6b75); }
    code { background: #eef2f5; border-radius: 4px; padding: 1px 4px; font-size: 11.5px; }
    .pop-actions { display: flex; align-items: center; gap: 12px; }
    .file-btn {
      cursor: pointer; font-weight: 700; font-size: 13px; color: #fff;
      background: var(--metro-blue, #007DBA); border-radius: 8px; padding: 8px 13px;
    }
    .file-btn:hover { background: var(--metro-blue-d, #00659a); }
    .link {
      background: none; border: 0; cursor: pointer; font-size: 12.5px; font-weight: 700;
      color: var(--metro-blue, #007DBA); text-decoration: underline; padding: 0;
    }
    .msg { margin: 12px 0 0; font-size: 12.5px; font-weight: 600; }
    .msg.ok { color: var(--metro-teal, #00997f); }
    .msg.err { color: var(--metro-red, #CF594A); }
  `;
}

// --- minimal CSV row tokenizer (handles quoted fields & commas) ------
function csvRows(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function parseMonth(v) {
  const s = String(v).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const i = MONTHS.indexOf(s.slice(0, 3));
  return i >= 0 ? i + 1 : Number(s);
}

customElements.define("data-import", DataImport);
