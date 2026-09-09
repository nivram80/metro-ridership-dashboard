import { LitElement, html, svg, css, nothing } from "lit";

// ------------------------------------------------------------------
// <route-map> — a dependency-free SVG map showing the selected
// route(s) drawn over an OpenStreetMap-derived basemap. Both geometry
// files are fetched once; the component itself never touches lat/lon,
// it just draws the pre-projected SVG paths it's handed.
//
// Properties:
//   routes      [{id, name, color, estimated}]  the dashboard's route catalogue
//   selectedIds [string]                        from _state.routeIds
//   routesSrc   string   "./data/routes-geo.json"
//   basemapSrc  string   "./data/basemap-geo.json"
// ------------------------------------------------------------------
export class RouteMap extends LitElement {
  static properties = {
    routes: { attribute: false },
    selectedIds: { attribute: false },
    routesSrc: { attribute: "routes-src" },
    basemapSrc: { attribute: "basemap-src" },
    _geo: { state: true },
    _basemap: { state: true },
    _loading: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.routes = [];
    this.selectedIds = [];
    this.routesSrc = "./data/routes-geo.json";
    this.basemapSrc = "./data/basemap-geo.json";
    this._geo = null;
    this._basemap = null;
    this._loading = true;
    this._error = null;
    this._announcement = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  // Fetch once on connect, not per-render: the geometry files are large
  // (thousands of simplified points) and never change after load.
  async _load() {
    try {
      const [geoRes, basemapRes] = await Promise.all([
        fetch(this.routesSrc),
        fetch(this.basemapSrc),
      ]);
      if (!geoRes.ok) throw new Error(`Couldn't load route geometry (${geoRes.status})`);
      if (!basemapRes.ok) throw new Error(`Couldn't load basemap (${basemapRes.status})`);
      this._geo = await geoRes.json();
      this._basemap = await basemapRes.json();
      this._announcement = this._announcementText();
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  updated(changed) {
    if (changed.has("selectedIds") && this._geo) {
      this._announcement = this._announcementText();
    }
  }

  _selectedRoutes() {
    return this.selectedIds
      .map((id) => this.routes.find((r) => r.id === id))
      .filter(Boolean);
  }

  // "system" (the System-total selection) and any other id without a matching
  // catalogue entry have no line geometry — that's a designed empty state,
  // not an error, so it's kept out of _geoRoutesSelected() below.
  _geoRoutesSelected() {
    if (!this._geo) return [];
    const ids = new Set(this.selectedIds);
    return this._geo.routes.filter((r) => ids.has(r.id));
  }

  _announcementText() {
    const selected = this._selectedRoutes();
    if (!selected.length || (selected.length === 1 && this.selectedIds[0] === "system"))
      return "Showing the service area map with no route selected.";
    return `Showing ${selected.map((r) => r.name).join(", ")}.`;
  }

  // The dashboard's route chips and this map must agree on colour, but the
  // catalogue (`routes`) and the GTFS geometry (`routesSrc`) were built from
  // different palettes — for 25 of 26 routes the GTFS colour differs from the
  // one on the chip (e.g. Route 18 is #007DBA in the catalogue, #A9112C in
  // GTFS). Preferring the catalogue colour keeps a chip and its line the same
  // colour on screen. Fall back to `displayColor` (GTFS's contrast-corrected
  // value) then `color` for any route the catalogue doesn't know about.
  // Once the two palettes are unified, `displayColor` becomes the right
  // primary source — swap the preference order then, not before.
  _colorFor(geoRoute) {
    const catalogue = this.routes.find((r) => r.id === geoRoute.id);
    return catalogue?.color || geoRoute.displayColor || geoRoute.color;
  }

  render() {
    if (this._error) return this._renderError();
    if (this._loading || !this._geo || !this._basemap) return this._renderLoading();
    return html`
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this._announcement}</div>
      ${this._renderMap()}
      ${this._renderAttribution()}
    `;
  }

  _renderLoading() {
    return html`<div class="state"><div class="spinner"></div><p>Loading route map…</p></div>`;
  }

  _renderError() {
    return html`
      <div class="state">
        <p class="err-title">Couldn't load the map</p>
        <p>${this._error}</p>
      </div>`;
  }

  _renderMap() {
    const { width, height } = this._geo.viewBox;
    const selected = this._geoRoutesSelected();
    const label = "Omaha Metro route map";
    const desc = this._announcementText();
    return html`
      <figure class="map-fig">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title map-desc">
          <title id="map-title">${label}</title>
          <desc id="map-desc">${desc}</desc>
          ${this._renderBasemap()}
          ${this._renderRoutes(selected)}
        </svg>
        ${this._renderLegend(selected)}
      </figure>
    `;
  }

  // The whole basemap is decorative context, not information — screen
  // readers should skip straight to the route <desc> above.
  //
  // Road groups are driven by basemap.roadClasses (falling back to a fixed
  // default for an older data file that predates the field) rather than a
  // hand-written list of layer names: build-basemap.mjs previously shipped a
  // "secondary" layer that route-map.js never knew to draw, so 2,600 road
  // paths existed in the data with no way to render them. Iterating whatever
  // the data says it drew is what makes that class of bug impossible to
  // reintroduce by adding a class in one file and forgetting the other.
  //
  // roadClasses is in descending importance order (motorway first); drawing
  // order needs to be the OPPOSITE of that — least important first — so more
  // important roads paint on top of, not underneath, everything lighter.
  _renderBasemap() {
    const layers = this._basemap.layers || {};
    const roadClasses = this._basemap.roadClasses || ["motorway", "trunk", "primary"]; // descending importance, same convention as the real field
    const paintOrder = roadClasses.slice().reverse();
    return svg`
      <g aria-hidden="true">
        <g class="water">
          ${(layers.water || []).map((d) => svg`<path d=${d} fill="var(--water, #cfe3ee)"></path>`)}
        </g>
        <g class="river">
          ${(layers.river || []).map((d) => svg`<path d=${d} fill="none" vector-effect="non-scaling-stroke"></path>`)}
        </g>
        ${paintOrder.map((cls) => svg`
          <g class="road ${cls}">
            ${(layers[cls] || []).map((d) => svg`<path d=${d} fill="none" vector-effect="non-scaling-stroke"></path>`)}
          </g>
        `)}
        ${this._renderLabels()}
      </g>
    `;
  }

  // Street labels: map furniture, not information — kept inside the same
  // aria-hidden basemap group above so screen readers never read out dozens
  // of street names; the accessible <desc> already names the selected routes
  // in words. Drawn last within that group so labels sit on top of the roads
  // but still underneath the route lines rendered after this group closes,
  // so a selected route's colour always wins over a label it crosses.
  _renderLabels() {
    const labels = this._basemap.labels || [];
    return svg`
      <g class="labels">
        ${labels.map((l) => svg`
          <text class="label ${l.class}"
            transform="translate(${l.x} ${l.y}) rotate(${l.angle})"
            text-anchor="middle">${l.text}</text>
        `)}
      </g>
    `;
  }

  // A route can have one path (one-way loops: 26, 41, 43, 200) or two
  // (both directions) — never assume a second element exists.
  _renderRoutes(selected) {
    return svg`
      <g class="routes">
        ${selected.map((route) => {
          const color = this._colorFor(route);
          return svg`
            <g>
              ${route.paths.map((p) => svg`
                <path d=${p.d} fill="none" stroke=${color}
                  vector-effect="non-scaling-stroke" class="route-line"></path>
              `)}
            </g>
          `;
        })}
      </g>
    `;
  }

  // Colour alone can't distinguish routes (WCAG 1.4.1) — five express routes
  // are all black — so every selected route also gets a named swatch here.
  _renderLegend(selected) {
    if (!selected.length) {
      return html`<figcaption class="caption">Select a route above to draw it on the map.</figcaption>`;
    }
    return html`
      <figcaption class="caption">
        <span class="legend" role="list">
          ${selected.map((route) => html`
            <span class="legend-item" role="listitem">
              <span class="sw" style="background:${this._colorFor(route)}"></span>
              ${route.name}
            </span>
          `)}
        </span>
      </figcaption>
    `;
  }

  _renderAttribution() {
    const source = this._basemap?.source;
    if (!source) return nothing;
    return html`
      <p class="attribution">
        Basemap data ©
        <a href=${source.licenseUrl} target="_blank" rel="noopener">${source.attribution.replace(/^©\s*/, "")}</a>.
      </p>
    `;
  }

  static styles = css`
    /* No max-width: the map fills its panel exactly like .plot inside
       <ridership-chart>, so chart and map share the same measure. */
    :host { display: block; }
    /* overflow:hidden is what clips drawing to the viewBox. It is the browser
       default for an outermost <svg>, but stated explicitly because the basemap
       intentionally contains off-viewBox geometry: build-basemap.mjs keeps any
       OSM way with a point within 30px of the box, so long roads and the
       Missouri run well past the edge. Setting overflow:visible lets all of
       that escape and paint over the rest of the page. */
    svg { display: block; width: 100%; height: auto; overflow: hidden; }

    .map-fig { margin: 0; }

    .water path { fill: var(--water, #cfe3ee); }
    .river path { stroke: var(--water-line, #9fc4dd); stroke-width: 1.4; }
    /* Five road classes need to read as a hierarchy, not a uniform grey mat,
       while staying subdued enough that the coloured bus routes stay
       dominant — so both stroke weight AND darkness step down together as
       importance drops, using only the neutral tokens already in the
       palette (no new hex values). Primary and secondary share the --line
       token (the two are close in real-world visual weight) and lean on
       opacity instead to keep secondary a shade lighter. Tertiary sits at
       --line-2, the palest neutral token there is: intentionally right at
       the visibility floor, present enough to give the street grid texture
       without competing for attention. */
    .road path { fill: none; }
    .road.motorway path { stroke: var(--muted, #5b6b75); stroke-width: 1.6; }
    .road.trunk path { stroke: var(--muted-2, #8a97a0); stroke-width: 1.3; }
    .road.primary path { stroke: var(--line, #dfe4e8); stroke-width: 1; }
    .road.secondary path { stroke: var(--line, #dfe4e8); stroke-width: .75; opacity: .65; }
    .road.tertiary path { stroke: var(--line-2, #eef1f3); stroke-width: .6; }

    .route-line { stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }

    /* Map furniture, not data: small, muted, and never allowed to intercept
       clicks/hover meant for the route lines above them. The white halo
       (paint-order: stroke fill) is what keeps the text legible where it
       crosses a road line underneath it — without it, dark text over a
       similarly dark road stroke is unreadable at this size. */
    .label {
      font-size: 9.5px; font-weight: 600; fill: var(--muted, #5b6b75);
      paint-order: stroke fill; stroke: #fff; stroke-width: 3px; stroke-linejoin: round;
      pointer-events: none;
    }
    .label.motorway { font-weight: 700; fill: var(--ink, #053955); }

    .caption {
      margin-top: 10px; font-size: 13px; color: var(--muted, #5b6b75);
    }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 16px; }
    .legend-item {
      display: inline-flex; align-items: center; gap: 6px;
      font-weight: 700; color: var(--ink, #053955); font-size: 13px;
    }
    .sw {
      width: 11px; height: 11px; border-radius: 3px; flex: none;
      border: 1px solid var(--ink, #053955);
    }

    .attribution {
      margin: 6px 0 0; font-size: 11.5px; color: var(--muted-2, #8a97a0);
    }
    .attribution a { color: inherit; text-decoration: underline; }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    .state { padding: 40px 0; text-align: center; color: var(--muted, #5b6b75); }
    .err-title { font-family: var(--font-display, sans-serif); font-weight: 700; font-size: 18px; color: var(--metro-red, #CF594A); }
    .spinner {
      width: 28px; height: 28px; margin: 0 auto 12px; border-radius: 50%;
      border: 3px solid #dfe9ef; border-top-color: var(--metro-blue, #007DBA);
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 2.4s; }
    }
  `;
}

customElements.define("route-map", RouteMap);
