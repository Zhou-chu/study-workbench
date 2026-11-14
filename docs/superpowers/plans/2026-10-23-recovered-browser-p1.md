# Recovered browser P1 implementation plan

**Goal:** Match the sanctioned synthetic baseline to the recovered UI and explicitly distinguish a mocked typed500 consumer check from backend commit-loss acceptance.
**Architecture:** Keep the existing owned lifecycle; use semantic region/article/details locators, exact successful selection responses and loaded workspace payloads. Add a separate one-write-budget fixture helper before restore/locale navigation.
**Constraints:** Harness/tests/docs only. No service/browser/build/provider calls now. No runtime claims. Read current recovered integration UI, not obsolete branch UI. No weakening geometry/raster assertions.

- [x] Add failing offline tests for exact response predicates and removal of known obsolete selectors.
- [x] Replace shell-only readiness with loaded workspace GET, non-default PDF selection PATCH and exact persisted IDs after reload. Verify saved note after loaded response.
- [x] Scope source actions to articles; read version from reader Document tools; use notebook tools disclosure for portable controls.
- [x] Use Settings popup actual language/theme actions and reload; reopen Reader after reload; use current 阅读与提问 tabs and explicit panel IDs for geometry.
- [x] Add separately labeled typed500 one-POST fixture helper/test budget; preserve drafts/file and blocked controls across readonly refresh without remount. No backend commit assertion.
- [x] Run focused offline checks, independently review frozen commits; parent runs integrated aggregate before any runtime GO.
