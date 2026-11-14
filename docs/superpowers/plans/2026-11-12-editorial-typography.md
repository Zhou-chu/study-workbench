# Notebook editorial research workspace
Goal: Implement the supplied publication-inspired monochrome references in the existing React SPA, preserving BFF contracts, data and operation ownership.
Design: Locally served Noto Serif SC with Source Serif 4 for headings and independent notes; Noto Sans SC for navigation, sources and answers. A shared 12/14/16/20/32 px scale; 49rem independent answer rail, natural Chinese spacing, hairline divisions, light and dark semantic tokens. Essential boundaries and focus remain distinct from decoration. No hero photos or synthetic content.
Scope:
- [x] Vendor licensed Fontsource WOFF2 faces, unicode-range loading and provenance, without runtime external font requests.
- [x] Add typography/font contracts and automated 4.5:1 text contrast checks.
- [x] Implement open indexed collection rows, search, sorting and responsive one/two-column layout.
- [x] Implement source/reader/discussion study layout, stable-DOM focus modes and independent source opening versus evidence selection.
- [x] Standardize controls, Markdown rhythm, note reading and small-screen targets.
- [ ] Run final tests/lint/types/build and independent review.
- [ ] Inspect real desktop/light/dark/mobile pages, font loading, selection independence and citations.
- [ ] Stage immutable frontend release with retained old assets and reversible nginx root switch; leave API, documents, credentials and worker unchanged.
Verification note: Initial parallel full-suite run encountered timing failures. Rerun web tests with bounded workers before acceptance; do not equate build checks with browser or provider acceptance.
