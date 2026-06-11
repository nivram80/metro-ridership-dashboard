# vendor/

Third-party code bundled into the project so the dashboard is fully
self-contained (no runtime CDN dependency).

## lit.js

Lit 3.2.1 (https://lit.dev) — the web-component base class (`LitElement`) and
lit-html templating (`html`, `svg`, `css`, `nothing`, …). MIT / BSD-3-Clause.

It's a single pre-bundled ES module with no external imports. To update to a new
Lit version, re-download the bundle:

```bash
curl -sL "https://esm.sh/lit@<version>/es2022/lit.bundle.mjs" -o vendor/lit.js
```

The app references it via the import map in `index.html`
(`"lit": "./vendor/lit.js"`).
