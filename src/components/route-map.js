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
//
// Pan/zoom: the viewBox is the only thing that ever changes. All geometry
// is pre-projected at build time, so panning/zooming is purely a matter of
// re-windowing the same ~5,800-element basemap — never reprojecting or
// re-simplifying anything. See _setView's comment for how that DOM size is
// kept off the hot (per-frame) path.
// ------------------------------------------------------------------

// 5x is not arbitrary: build-routes.mjs simplifies route geometry at
// EPSILON_PX = 0.05px, and that script's own comment notes 0.05 "buys clean
// detail out to roughly 5x zoom" before Douglas-Peucker's polyline wobble
// starts to show. If EPSILON_PX changes there, this limit should change
// with it.
const MAX_ZOOM_FACTOR = 5;

// How long an auto-fit or Reset takes to settle.
const FIT_ANIM_MS = 450;

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
    // Reactive so the sr-only status region actually repaints when the text
    // changes (on selection and on Reset). `_view` is deliberately NOT
    // listed here — see _setView's comment for why pan/zoom state is a
    // plain field instead of a Lit-tracked one.
    _announcement: { state: true },
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

    // Pan/zoom state. `_homeView` is frozen once the geometry loads and
    // never changes again — Reset and the empty state return to it exactly.
    this._homeView = null;
    this._view = null;
    this._routeBBoxById = new Map();
    this._reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this._animId = null;
    this._wired = false;

    // DOM refs the imperative pan/zoom path writes to directly, cached once
    // by _wireInteraction after the first render that actually has a map.
    this._svgEl = null;
    this._labelEls = [];
    this._labelBaseTransforms = [];
    this._zoomInBtn = null;
    this._zoomOutBtn = null;

    // Pointer tracking for drag-to-pan and two-finger pinch-to-zoom.
    this._pointers = new Map();
    this._dragging = false;
    this._dragOrigin = null;
    this._dragRect = null;
    this._pinchStart = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cancelAnimation();
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

      // The full extent, read from the data rather than hardcoded, is both
      // the initial view and the permanent "home" Reset returns to.
      this._homeView = Object.freeze({ x: 0, y: 0, w: this._geo.viewBox.width, h: this._geo.viewBox.height });
      this._view = { ...this._homeView };
      this._buildRouteBBoxes();
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  updated(changed) {
    // Wire up interaction refs/state exactly once, right after the first
    // render that actually contains the map (not the loading/error state).
    const justWired = !this._wired && this._geo && this._basemap && !this._loading && !this._error;
    if (justWired) {
      this._wireInteraction();
      this._wired = true;
      // Snap (don't animate) to whatever's already selected on first paint,
      // so a deep-linked route opens already framed instead of flashing
      // the home view first.
      this._applyFit(this.selectedIds, { animate: false });
    }
    if (!justWired && changed.has("selectedIds") && this._wired) {
      this._announcement = this._announcementText();
      this._applyFit(this.selectedIds, { animate: true });
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

  // Parses a "d" string of the form build-routes.mjs emits — its
  // toPathString() writes "M12.3 45.6L78.9 10.1L..." (absolute M/L only,
  // space-separated coordinate pairs, no curves) — back into [x, y] pairs.
  // Mirrors scripts/lib/geo.mjs's parsePathString() exactly; duplicated
  // rather than imported because that file is a Node build script, not
  // part of what ships to the browser.
  _parsePathPoints(d) {
    return d.slice(1).split("L").map((pair) => pair.split(" ").map(Number));
  }

  // Bounding boxes are computed once, here, when the geometry first loads —
  // not per selection change and never per frame. Auto-fit only ever needs
  // a route's extent, not its individual points, so re-parsing ~26 routes'
  // worth of "d" strings on every click would be pure waste.
  _buildRouteBBoxes() {
    this._routeBBoxById = new Map();
    for (const route of this._geo.routes) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of route.paths) {
        for (const [x, y] of this._parsePathPoints(p.d)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      this._routeBBoxById.set(route.id, { minX, minY, maxX, maxY });
    }
  }

  // The target view for a given selection. "system", an unknown id, or an
  // empty selection all fall out of the same `boxes.length === 0` check
  // below (none of them have an entry in _routeBBoxById), so they all
  // resolve to the home view without needing a special case.
  _computeFitView(ids) {
    const boxes = ids.map((id) => this._routeBBoxById.get(id)).filter(Boolean);
    if (!boxes.length) return { ...this._homeView };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }

    // Pad 12% on each side so the route isn't flush against the frame edges.
    const pad = 0.12;
    const bw = Math.max(maxX - minX, 1); // floor avoids a divide-by-zero AR fit for a degenerate route
    const bh = Math.max(maxY - minY, 1);
    let x = minX - bw * pad;
    let y = minY - bh * pad;
    let w = bw * (1 + 2 * pad);
    let h = bh * (1 + 2 * pad);

    // Fit to the map's aspect ratio without distorting it — grow whichever
    // axis is short, recentring so the padding stays even on both sides.
    const targetAR = this._homeView.w / this._homeView.h;
    if (w / h < targetAR) {
      const nw = h * targetAR;
      x -= (nw - w) / 2;
      w = nw;
    } else if (w / h > targetAR) {
      const nh = w / targetAR;
      y -= (nh - h) / 2;
      h = nh;
    }

    // _clampView applies the shared 5x-max / home-min zoom limit (so even a
    // very short route can't zoom in past the point the geometry stops
    // being trustworthy) without disturbing the aspect ratio just set above.
    return this._clampView({ x, y, w, h });
  }

  // Called whenever selectedIds changes (see updated()), and once, unanimated,
  // right after the geometry first loads so a pre-selected route opens
  // already framed instead of flashing the home view first.
  _applyFit(ids, { animate = true } = {}) {
    const target = this._computeFitView(ids);
    if (animate) this._animateTo(target);
    else this._setView(target);
  }

  // Zoom limit only — independent of position, since callers like the
  // cursor-anchored zoom need to know the achieved size before they can
  // compute where to re-anchor x/y.
  _clampSize(w, h) {
    const minW = this._homeView.w / MAX_ZOOM_FACTOR;
    const minH = this._homeView.h / MAX_ZOOM_FACTOR;
    return {
      w: Math.min(this._homeView.w, Math.max(minW, w)),
      h: Math.min(this._homeView.h, Math.max(minH, h)),
    };
  }

  // Pan limit: require at least half of the (smaller) current dimension to
  // stay overlapping the home extent, so a drag can never push the whole
  // city off-screen. `w`/`h` are assumed already size-clamped.
  _clampPan(x, y, w, h) {
    const overlapX = Math.min(w, this._homeView.w) / 2;
    const overlapY = Math.min(h, this._homeView.h) / 2;
    const minX = this._homeView.x - w + overlapX;
    const maxX = this._homeView.x + this._homeView.w - overlapX;
    const minY = this._homeView.y - h + overlapY;
    const maxY = this._homeView.y + this._homeView.h - overlapY;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }

  // Convenience composition of the two clamps above for callers (fit,
  // reset) that want a whole {x,y,w,h} box clamped around its own centre,
  // as opposed to the cursor-anchored zoom path which needs finer control.
  _clampView({ x, y, w, h }) {
    const cx = x + w / 2, cy = y + h / 2;
    const size = this._clampSize(w, h);
    const pan = this._clampPan(cx - size.w / 2, cy - size.h / 2, size.w, size.h);
    return { x: pan.x, y: pan.y, w: size.w, h: size.h };
  }

  // The single entry point every pan/zoom/animation path funnels through.
  // Deliberately NOT a Lit reactive property: pushing every intermediate
  // frame of a drag or a 450ms animation through Lit's render() would
  // re-diff the ~5,800-element basemap for geometry that never actually
  // changes with the view. Instead this writes straight to the DOM (see
  // _pushViewToDom) and leaves `_view` as a plain, always-current field —
  // so on the rare occasion an unrelated Lit render DOES run (a new
  // selection, a Reset announcement), the template still reads the correct
  // value and never stomps a live pan/zoom.
  _setView(view) {
    this._view = view;
    this._pushViewToDom();
  }

  _pushViewToDom() {
    const v = this._view;
    if (!this._svgEl) return; // guards the moment before the first "loaded" render commits
    this._svgEl.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);

    // Text scales with the viewBox like every other coordinate in the SVG,
    // so at e.g. 3x zoom a label would render 3x too large. Counter-scale
    // it back down — the text equivalent of vector-effect="non-scaling-
    // stroke" above, which only fixes stroke width, not glyph size. The
    // scale is appended AFTER translate/rotate: SVG transforms compose
    // right-to-left, so it applies first and shrinks the glyph about its
    // own local origin rather than dragging its position toward (0,0).
    const k = v.w / this._homeView.w;
    for (let i = 0; i < this._labelEls.length; i++) {
      this._labelEls[i].setAttribute("transform", `${this._labelBaseTransforms[i]} scale(${k})`);
    }

    // Keep the zoom buttons' disabled state live through drags/wheel/keys
    // too, not just through the occasional full Lit render — otherwise
    // clicking "+" at max zoom would silently no-op instead of visibly
    // being disabled.
    if (this._zoomInBtn) this._zoomInBtn.disabled = v.w <= this._homeView.w / MAX_ZOOM_FACTOR + 1e-6;
    if (this._zoomOutBtn) this._zoomOutBtn.disabled = v.w >= this._homeView.w - 1e-6;
  }

  // Runs once, right after the first "loaded" render commits real DOM (see
  // updated()). Caches the element refs _pushViewToDom writes to directly,
  // so the pan/zoom hot path never needs a querySelector — or a Lit
  // re-render — in it.
  _wireInteraction() {
    const root = this.renderRoot;
    this._svgEl = root.querySelector("svg.map");
    this._labelEls = Array.from(root.querySelectorAll(".label"));
    this._labelBaseTransforms = (this._basemap.labels || [])
      .map((l) => `translate(${l.x} ${l.y}) rotate(${l.angle})`);
    this._zoomInBtn = root.querySelector(".zoom-in");
    this._zoomOutBtn = root.querySelector(".zoom-out");
  }

  // Cursor-anchored zoom, in viewBox units: (vx, vy) is the geographic
  // point that must stay under the pointer. `factor` > 1 zooms in.
  // Clamping can shrink the request at the 5x/home limits, so the
  // EFFECTIVE factor used for the anchor math is recovered from the
  // clamped size rather than trusted from the request.
  _zoomAtViewPoint(vx, vy, factor) {
    const v = this._view;
    const { w, h } = this._clampSize(v.w / factor, v.h / factor);
    const k = v.w / w;
    const x = vx - (vx - v.x) / k;
    const y = vy - (vy - v.y) / k;
    const p = this._clampPan(x, y, w, h);
    this._setView({ x: p.x, y: p.y, w, h });
  }

  _zoomAtClient(clientX, clientY, factor) {
    const rect = this._svgEl.getBoundingClientRect();
    const v = this._view;
    const vx = v.x + (clientX - rect.left) * (v.w / rect.width);
    const vy = v.y + (clientY - rect.top) * (v.h / rect.height);
    this._zoomAtViewPoint(vx, vy, factor);
  }

  _zoomButton(factor) {
    this._cancelAnimation();
    const v = this._view;
    this._zoomAtViewPoint(v.x + v.w / 2, v.y + v.h / 2, factor);
  }

  _panBy(dx, dy) {
    this._cancelAnimation();
    const v = this._view;
    const p = this._clampPan(v.x + dx, v.y + dy, v.w, v.h);
    this._setView({ x: p.x, y: p.y, w: v.w, h: v.h });
  }

  _reset() {
    this._cancelAnimation();
    this._announcement = "Map view reset to show the full service area.";
    if (this._reducedMotion.matches) this._setView({ ...this._homeView });
    else this._animateTo({ ...this._homeView });
  }

  _cancelAnimation() {
    if (this._animId != null) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
  }

  // Eases the view from wherever it currently is to `target` over
  // FIT_ANIM_MS, driven by requestAnimationFrame. Every frame writes
  // straight to the DOM via _setView — see its comment for why that
  // deliberately bypasses Lit's render(). prefers-reduced-motion skips the
  // animation outright rather than just shortening it.
  _animateTo(target) {
    this._cancelAnimation();
    if (this._reducedMotion.matches) {
      this._setView(target);
      return;
    }
    const from = { ...this._view };
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / FIT_ANIM_MS);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      this._setView({
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        w: from.w + (target.w - from.w) * eased,
        h: from.h + (target.h - from.h) * eased,
      });
      this._animId = t < 1 ? requestAnimationFrame(step) : null;
    };
    this._animId = requestAnimationFrame(step);
  }

  // Wheel (and trackpad pinch, which Chrome/Safari report as wheel with
  // ctrlKey set) zoom, anchored at the pointer. Registered with
  // { passive: false } (see _renderMap) specifically so preventDefault can
  // stop the page from scrolling underneath the map.
  _onWheel(e) {
    e.preventDefault();
    this._cancelAnimation();
    const factor = Math.exp(-e.deltaY * 0.0015);
    this._zoomAtClient(e.clientX, e.clientY, factor);
  }

  _onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this._cancelAnimation();
    this._svgEl.setPointerCapture(e.pointerId); // keeps tracking a drag that leaves the element
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 1) {
      this._dragRect = this._svgEl.getBoundingClientRect();
      this._dragOrigin = { clientX: e.clientX, clientY: e.clientY, view: { ...this._view } };
      this._dragging = true;
      this._svgEl.classList.add("grabbing");
    } else if (this._pointers.size === 2) {
      this._dragging = false; // a second finger means pinch, not pan
      this._beginPinch();
    }
  }

  // The one handler this whole feature's performance budget is really
  // about: it can fire dozens of times a second during a drag.
  // getBoundingClientRect is read once, at pointerdown/pinch-start above,
  // and reused for the rest of the gesture rather than re-read here — and
  // _setView never touches Lit, so a drag never re-diffs the basemap.
  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size >= 2) {
      this._updatePinch();
      return;
    }
    if (!this._dragging) return;
    const { view, clientX, clientY } = this._dragOrigin;
    const dx = (e.clientX - clientX) * (view.w / this._dragRect.width);
    const dy = (e.clientY - clientY) * (view.h / this._dragRect.height);
    const p = this._clampPan(view.x - dx, view.y - dy, view.w, view.h);
    this._setView({ x: p.x, y: p.y, w: view.w, h: view.h });
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId);
    this._pinchStart = null;
    if (this._pointers.size === 0) {
      this._dragging = false;
      this._svgEl.classList.remove("grabbing");
    } else if (this._pointers.size === 1) {
      // Dropped from two fingers to one: restart single-finger pan
      // tracking from here rather than reusing stale two-finger state.
      const [p] = this._pointers.values();
      this._dragRect = this._svgEl.getBoundingClientRect();
      this._dragOrigin = { clientX: p.x, clientY: p.y, view: { ...this._view } };
      this._dragging = true;
    }
  }

  _beginPinch() {
    const [a, b] = this._pointers.values();
    this._dragRect = this._svgEl.getBoundingClientRect();
    this._pinchStart = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...this._view },
    };
  }

  // Simple on purpose (correctness over smoothness): scale by the ratio of
  // finger distance to its value at gesture start, anchored on the pinch's
  // starting midpoint, plus a plain pan for however far that midpoint has
  // since moved.
  _updatePinch() {
    if (!this._pinchStart) {
      this._beginPinch();
      return;
    }
    const [a, b] = this._pointers.values();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist < 1) return;
    const { view, mid, dist: startDist } = this._pinchStart;
    const rect = this._dragRect;
    const factor = dist / startDist;
    const vx = view.x + (mid.x - rect.left) * (view.w / rect.width);
    const vy = view.y + (mid.y - rect.top) * (view.h / rect.height);
    const { w, h } = this._clampSize(view.w / factor, view.h / factor);
    const k = view.w / w;
    let x = vx - (vx - view.x) / k;
    let y = vy - (vy - view.y) / k;
    const nowMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    x -= (nowMid.x - mid.x) * (w / rect.width);
    y -= (nowMid.y - mid.y) * (h / rect.height);
    const p = this._clampPan(x, y, w, h);
    this._setView({ x: p.x, y: p.y, w, h });
  }

  // Documented in the SVG's <desc> (see _renderMap) so screen-reader users
  // know these exist. Step sizes scale with the current view (a fraction
  // of it) rather than a fixed viewBox amount, so a key press feels
  // similarly sized whether zoomed out to the whole city or into one route.
  _onKeyDown(e) {
    const v = this._view;
    switch (e.key) {
      case "ArrowLeft": this._panBy(-v.w * 0.08, 0); break;
      case "ArrowRight": this._panBy(v.w * 0.08, 0); break;
      case "ArrowUp": this._panBy(0, -v.h * 0.08); break;
      case "ArrowDown": this._panBy(0, v.h * 0.08); break;
      case "+": case "=": this._zoomButton(1.4); break;
      case "-": case "_": this._zoomButton(1 / 1.4); break;
      case "0": case "Home": this._reset(); break;
      default: return; // let anything else (Tab, etc.) behave normally
    }
    e.preventDefault();
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
    const selected = this._geoRoutesSelected();
    const label = "Omaha Metro route map";
    const desc = `${this._announcementText()} Keyboard: arrow keys pan, plus and minus zoom, `
      + `0 or Home resets to the full service area.`;
    const v = this._view;
    const atHome = v.w >= this._homeView.w - 1e-6;
    const atMax = v.w <= this._homeView.w / MAX_ZOOM_FACTOR + 1e-6;
    return html`
      <figure class="map-fig">
        <svg class="map" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" role="img"
          aria-labelledby="map-title map-desc" tabindex="0"
          @wheel=${{ handleEvent: (e) => this._onWheel(e), passive: false }}
          @pointerdown=${(e) => this._onPointerDown(e)}
          @pointermove=${(e) => this._onPointerMove(e)}
          @pointerup=${(e) => this._onPointerUp(e)}
          @pointercancel=${(e) => this._onPointerUp(e)}
          @keydown=${(e) => this._onKeyDown(e)}>
          <title id="map-title">${label}</title>
          <desc id="map-desc">${desc}</desc>
          ${this._renderBasemap()}
          ${this._renderRoutes(selected)}
        </svg>
        ${this._renderControls(atHome, atMax)}
        ${this._renderLegend(selected)}
      </figure>
    `;
  }

  // Real <button> elements (not clickable divs) so they're keyboard-
  // focusable and get a proper accessible name; `disabled` mirrors _view
  // directly so hitting a limit is visible rather than the click just
  // silently doing nothing.
  _renderControls(atHome, atMax) {
    return html`
      <div class="controls" role="group" aria-label="Map view controls">
        <button type="button" class="ctrl zoom-in" aria-label="Zoom in" ?disabled=${atMax}
          @click=${() => this._zoomButton(1.4)}>${this._icon("plus")}</button>
        <button type="button" class="ctrl zoom-out" aria-label="Zoom out" ?disabled=${atHome}
          @click=${() => this._zoomButton(1 / 1.4)}>${this._icon("minus")}</button>
        <button type="button" class="ctrl" aria-label="Reset view"
          @click=${() => this._reset()}>${this._icon("reset")}</button>
      </div>
    `;
  }

  // Inline SVG rather than +/−/glyph characters, matching the checkmark on
  // the route chips (dashboard-controls.js) — a glyph's rendering depends
  // on whatever fallback font the OS supplies for that character; a drawn
  // path doesn't.
  _icon(name) {
    const d = {
      plus: "M8 3v10M3 8h10",
      minus: "M3 8h10",
      reset: "M3 6V3H6M10 3H13V6M13 10V13H10M6 13H3V10",
    }[name];
    return html`
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d=${d}></path>
      </svg>
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
  //
  // Only the base translate/rotate is emitted here — the counter-scale that
  // keeps label text a constant size while zoomed is applied imperatively,
  // per label, by _pushViewToDom. Because that scale factor is static from
  // this template's point of view (it never appears here), a Lit re-render
  // triggered for an unrelated reason mid-zoom sees no change to write and
  // leaves the live, correctly-scaled attribute alone.
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
    svg.map {
      display: block; width: 100%; height: auto; overflow: hidden;
      cursor: grab;
      touch-action: none; /* otherwise a touch drag scrolls the page instead of panning the map */
    }
    svg.map.grabbing { cursor: grabbing; }
    svg.map:focus-visible {
      outline: 3px solid var(--metro-blue, #007DBA); outline-offset: 3px;
    }

    .map-fig { margin: 0; position: relative; }

    .controls {
      position: absolute; top: 10px; right: 10px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .ctrl {
      appearance: none; width: 30px; height: 30px; padding: 0;
      display: grid; place-items: center;
      background: #fff; color: var(--ink, #053955);
      border: 1px solid var(--line, #dfe4e8); border-radius: 8px;
      box-shadow: var(--shadow-sm, 0 1px 2px rgba(5,57,85,.12));
      cursor: pointer;
    }
    .ctrl svg { display: block; width: 16px; height: 16px; }
    .ctrl:hover:not([disabled]) { color: var(--metro-blue, #007DBA); border-color: var(--metro-blue, #007DBA); }
    .ctrl[disabled] { opacity: .4; cursor: not-allowed; }
    .ctrl:focus-visible {
      outline: 3px solid var(--metro-blue, #007DBA); outline-offset: 3px;
    }

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
