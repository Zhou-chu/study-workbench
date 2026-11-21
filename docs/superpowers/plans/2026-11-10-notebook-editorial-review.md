# Notebook editorial redesign: review record

## Scope and isolation

Based on legacy-login fix `0dc81302befdf61df9ffb5a89d93e516eed58971`, in branch `feat/notebook-editorial-20261110`. Changes are frontend presentation, localized labels, regression tests and QA tooling. No backend schema, credentials, user data, running release, gateway slot or deployment is changed.

## Interaction design

- Sources, Conversation and Results are persistent, distinct sections. The desktop reading rail is deliberately quiet; full source tools remain in Sources. The DOM slots stay mounted, preserving drafts and reader state.
- A contextual reader stays beside the selected desktop section. On narrow screens it becomes a fullscreen, keyboard-managed reader with Close/Escape.
- Results presents notes, actual downloaded artifacts and named secondary audio/backup tools, not a generic background-job feed. Explicit saved audio/download/export progress remains inside its relevant disclosure after reload, with conservative human-readable status and no replay actions.
- Global navigation, notebook tools and mobile settings/commands remain reachable. Search modes have query-aware active states.
- Source extraction/original availability remain visible. Unknown protocol states are localized rather than echoed. User-authored note content, including code, is preserved. Precise remote IDs remain labelled only where necessary to confirm a consequential remote action and no authoritative human name exists.

## Visual review and corrections

Synthetic browser review covers notebook list, conversation, results, note editor, full sources, contextual reader, global source library, content settings, model settings, podcasts and search. Viewports: 1440×1000, 1024×900 and 390×844; light and dark. Each capture is checked for horizontal document overflow and uncaught browser errors. A typed note draft is verified across section switches, and the internal-job sentinel must not appear.

Actual screenshot review found and corrected: clipped conversation caused by a shrinking flex scroll area; narrow-header horizontal overflow and vertically broken button labels; selected Sources/Results losing context beside the reader; oversized blue native checkboxes; overly long full-width settings/search control stacks. An independent review restored source processing status and fixed simultaneous Search/Ask highlights.

## Reproducing the isolated visual check

`apps/web/scripts/visual-review.py` uses Playwright Firefox, fresh contexts and only `http://127.0.0.1:18864`. All API/config/manifest responses are synthetic and other origins are aborted. It never contacts the live API or uses an existing user browser/profile. Use a Vite development server with `--host 127.0.0.1 --port 18864 --strictPort --base /` and synthetic `SPA_ARTIFACT_IDENTITY`: source_commit a×40, authored_digest b×64, contract_digest d×64, release_slot synthetic-editorial-preview, ui_transport_protocol 1, supported_contracts [workspace-view-v1].

Set `PLAYWRIGHT_BROWSERS_PATH` for the installed browser cache. `QA_WIDTHS` and `QA_THEMES` can restrict a diagnostic run; default is all six combinations. `QA_FONT_DIR` points to private local `arial.ttf`, `qa-chinese.ttf` test fonts. The Linux test environment has no usable system fonts, so private installed Windows font faces are supplied only by mocked QA routes and substituted only in the screenshot harness. Font files are not committed, published or added to application assets. Exact cross-platform typography is not a claimed browser acceptance result.

Screenshots and machine-readable report are generated in ignored `.superpowers/sdd/notebook-spa-redesign/editorial-review/`. This is synthetic UI verification, not live login, remote provider, real-data or deployment acceptance. Production build verification requires clean committed source and is performed separately.

## Verification results

- Fresh frontend typecheck and ESLint: passed.
- Frontend script tests: 12 passed. Vitest: 83 files, 1128 tests passed.
- Synthetic visual matrix: 66 captures across 11 page/workspace states and six viewport/theme combinations; zero recorded horizontal overflows or uncaught browser errors. Model and podcast captures were refreshed after final fixture/spacing corrections.
- Clean-source production build passed, including source/artifact file gate. Runtime and served-byte acceptance remain explicitly NOT_RUN.
- Private QA fonts are excluded from both Git and the screenshot archive. The archive contains only synthetic screenshots and the review report.
