# Project guidance

## Cross artwork — user decision, 2026-10-21

For parish-related website interface artwork, use the approved decorative four-ended cross with one main horizontal crossbar and trefoil ends. Do not add a lower crossbar, slanted footrest, or a second short upper crossbar. The user explicitly requested: «Делай кресты без нижней перекладины», «просто красивые Кресты»; the two supplied references show the single-horizontal-bar silhouette.

Reuse the project's canonical SVG geometry for headers, footers, decorative interface symbols, favicons, PWA/application icons, and any new promotional artwork. Preserve each site's colors and appropriate sizing. Use SVG rather than the Unicode Orthodox-cross glyph (`☦`, U+2626), whose extra crossbars cannot be controlled. Never mirror, rotate, or add bars to the approved cross.

This rule applies to designed interface artwork. Preserve original photographs, historical illustrations, icons, and quoted/archive content. Do not introduce cross symbols into a project whose existing design policy excludes religious symbols.

Keep this decision in the project's AGENTS.md so future changes retain the approved form. If the SVG is used by a favicon or installation icon, update its versioned references and relevant service-worker caches when its appearance changes.

## Project implementation

- `images/cross.svg` is the canonical artwork. Keep its single path and 64 × 96 proportions; use the site's gold color.
- `tools/build.mjs` reads that SVG for the header, footer and language chooser, and generates `images/favicon-cross-v2.svg` plus the legacy `images/favicon.svg` alias. Do not hand-edit the generated icons.
- The manifest and page icon links must use the versioned favicon filename. Change the filename when the icon appearance changes; keep the manifest reference in sync.
- The existing social-preview PNG already has one horizontal crossbar. Preserve original photographs, historical illustrations and quoted/archive text.
- `preview.html` is reachable on GitHub Pages. Its decorative UI crosses must use the same canonical SVG path; update those inline copies whenever the canonical artwork changes. The archive exception does not cover UI code or decorative glyphs.
- After artwork changes run `node tools/build.mjs`, the existing `tools/tests/*.test.mjs` checks and `node tools/check-site.mjs`. Commit the generated files with the source.
