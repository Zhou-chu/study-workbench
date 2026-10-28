# ADR-011: Visual identity is a token contract in globals.css, reviewed through /dev/design

- **Status**: Accepted
- **Date**: 2026-07
- **Related**: Discussion #1202 (community co-design), #1218 (foundation), #1220 (screen reskin), [frontend rules](../../7-DEVELOPMENT/frontend.md)

## Context

The 2026 redesign ("Quiet Green", co-designed with the community in Discussion #1202) replaced the stock shadcn theme with a product-specific visual identity. Before it, colors were scattered across components as raw Tailwind palette classes (`text-red-600`, `bg-amber-50`), each with hand-written `dark:` twins — visually inconsistent, semantically meaningless, and expensive to change. The redesign also pre-designed Stage-2 UX (citations, per-source context states, content-type identity) that needs colors with *meaning*, not decoration.

## Decision

**All visual identity lives as a layered custom-property token system in `frontend/src/app/globals.css`. Components consume semantic tokens only — raw palette classes are banned. `/dev/design` is the living reference.**

- **Layers**: raw palette (fern, sage, gold, teal, plum, mauve, slate, violet, clay) → semantic slots (surfaces, ink ramp, hairlines, action, danger, warn) → product vocabularies: content-type hues (`--type-*`), evidence/citation classes (`--cite-*`), context states (`--ctx-*`). The product vocabularies are canonized now even where nothing consumes them yet, so Stage-2 features and community PRs share one contract.
- **The laws** (enforced in review): fern acts · teal speaks (the AI/system voice) · red destroys, and only destroys · warn is clay, never an action hue · color never washes a reading surface · hairlines separate, popovers own the only real shadow · geometry is squared (4–6px) · mono is for data, not prose.
- **Dark mode** overrides only the raw layers on `.dark`; every alias re-resolves via `var()`. This works **only** because the `dark` class sits on the document root (`theme-store` behavior). CSS custom properties resolve where they are *declared*, so a nested `.dark` wrapper inherits already-resolved light values — never theme a subtree.
- **Values are hex**, kept 1:1 with the validated design spec (a pixel-diff re-application test against the design mockups reached 0.000% visible difference). Converting to oklch would reintroduce drift for zero benefit.
- **`/dev/design`** (dev-only route, 404 in production) renders every token and primitive in both themes. It is the acceptance reference for visual PRs and the regression detector: screen-level PRs must leave it byte-identical.

## Alternatives considered

- **Keep per-component palette classes** — rejected: the status quo that produced the inconsistency; every rebrand becomes a 38-file sweep (we did exactly one and never want another).
- **A theming library / CSS-in-JS tokens** — rejected: Tailwind v4 `@theme` already bridges custom properties to utilities; adding a runtime dependency contradicts the lean posture.
- **Full design-system tooling (Storybook, Figma library, published npm package)** — rejected as over-engineering for a single-app project; `/dev/design` gives the same review value at near-zero maintenance cost.
- **oklch values (shadcn convention)** — rejected: fidelity to the pixel-diff-validated spec wins over convention; the file documents this so nobody "fixes" it later.

## Consequences

- Contributors must use token utilities (`text-destructive`, `bg-warn-tint`, `text-type-video`…) — see the styling rule in [frontend/AGENTS.md](../../../frontend/AGENTS.md). A PR reintroducing `text-red-600` is a review reject.
- `slate` and `violet` are exposed to Tailwind as `slate-hue`/`violet-hue` to avoid colliding with Tailwind's built-in palettes.
- Rebrands and theme tweaks are token edits, verified in `/dev/design`, instead of app-wide sweeps.
- Stage-2 features consume `--cite-*`/`--ctx-*` without new color decisions; the vocabulary already exists.

## 2026-10-28 readability correction (source-verified; pixel review pending)

This is a token-level correction to Quiet Green, not a screen redesign or a new
palette. The earlier mockup pixel-diff result above describes the original
foundation only; it is **not** evidence for this correction. `/dev/design` remains
byte-identical and remains the visual reference: its existing primary/destructive
buttons, disabled button, input selection, badges and destructive menu item consume
the corrected primitives automatically. Both-theme current screenshots are still
required before calling the visual gate accepted.

- Dark `primary` now aliases existing `fern` (`#55b285`), and `primary-hover`
  aliases `fern-deep` (`#6cc298`); `on-primary` is deep green `#12251a`.
  Light action values, all reading surfaces, fonts and semantic hue ownership are
  unchanged. Primary foreground and sidebar-primary aliases continue to resolve
  through the existing graph; no second text-action palette is introduced.
- Add `on-destructive` and its semantic `destructive-foreground` alias/utility:
  light `#ffffff`, dark `#31160f`. The `danger`/`destructive` error-ink token is
  unchanged. Button and the explicit destructive AlertDialogAction overrides in
  `ConfirmDialog` and `NotebookDeleteDialog` consume the paired foreground. Their
  confirmation/disabled/deletion behavior is unchanged.
- Two related alpha-only consumer corrections keep the unchanged error ink
  readable: SetupBanner's documentation link no longer fades to 80% on hover;
  destructive dropdown focus fill is 5% in both themes, rather than 10% light /
  20% dark. A 10% dark fill would still be only 4.49:1, so simply dropping the dark
  override was insufficient. No handlers or menu semantics change.

Actual alias resolution plus encoded-sRGB alpha composition and linear-sRGB
luminance calculations are covered by `design-contrast.test.ts`. Across background,
sidebar, card/dialog, popover, muted and accent: dark primary button contrast changes
3.63 → **6.20**, hover 2.98 → **7.51**; primary ink minimum changes 3.45 → **5.30**.
Dark destructive button changes 2.92 → **5.75**, with 90%-alpha hover minimum
**4.84**. Light primary remains **5.84 / 7.75**, destructive **5.70**, minimum
hover **4.73**. Wizard primary/10-on-muted, fern badge, sidebar mark, input selection
and unchanged destructive ink/tint pairings are also source-tested. This is not a
claim about every unrelated screen, third-party syntax theme or external PDF pixel.
Disabled group opacity remains 50% and is reported separately, not included in the
enabled 4.5:1 claim.

### Workspace responsiveness and focus

- Explicit `data-workbench-controls` roots cover the workspace (including its cold
  error view), mobile navigation, notebook settings, nested integration confirmation,
  draft replacement, web discovery and portable restore portals. At ≤640px **or**
  a coarse pointer, independent buttons, inputs/selects, summaries, non-prose links
  and file/checkbox labels get 44×44px minimum targets. Checkbox glyphs stay compact;
  their separate labels provide the hit area, without incorporating adjacent Read
  buttons. Fine-pointer desktop density remains unchanged. Existing Task3 retry
  minimums are retained and agree with this scope.
- Default/ghost/link Button variants have no explicit border width, so their
  `focus-visible:border-ring` alone was not an opaque focus indicator. Existing
  3px/50% rings are retained, while scoped focus adds an opaque 2px teal outline
  with 2px offset, including the visible label for a hidden file input. A focused
  close button is fully opaque. Portal headings reserve room for its enlarged
  target; mobile navigation reserves a separate close row. The source contrast
  check does not replace actual keyboard/occlusion review.
- Sources groups upload/discovery in one bounded row, retains the explicit
  reading/scope distinction, uses the former duplicate hint as the selection-action
  group's accessible label, and keeps search input/action together with an accessible
  label. No scope/search lifecycle or callbacks change. First useful source-row
  position still requires current phone screenshots; no y-coordinate is claimed.
- Source and Notes pane maximums activate at **80rem**, matching installed
  Tailwind's xl layout breakpoint (relative to the user/UA initial font). They use
  `calc((100% - 382px - 5rem) / 2)` against the **workspace row**, not viewport.
  The reserve is 340px prose + 3rem central gutters + 2rem maximum card padding +
  2px border + two conservative 20px scrollbar allowances. Thus both answers and
  the reader's nested extracted-text scroller are covered as rem sizes change.
  At 14/16/20/24px initial/root font sizes, maximum-pane center reserves are
  452/462/482/502px; effective answers are 360px and nested-reader prose is
  347/348/350/352px. Below the corresponding xl threshold the cap is absent and
  existing full-width single-region layout remains. These are bounded source
  calculations, not measured drag/zoom/scrollbar geometry.
- Citation controls prioritize the source title, clamp it visually to two lines,
  and shorten only long displayed reference IDs. Full source/ID stay in accessible
  name and title; original citation object, locator, validity and click payload
  are unchanged. Wrapping/max-width rules and 120-character titles / 128-character
  IDs are tested with multiple answer and note references; pixel overflow remains
  a browser gate. Navigation uses neutral selected/pressed states; outer tabs
  also have a persistent 3px foreground-token underline, independent of focus.
  This neutral marker contrasts with the shared muted/secondary fill at 13.91:1
  light and 12.88:1 dark. Roving focus and existing state ownership stay intact.

No fonts, framework, reading surfaces, provider calls, API contracts, stored
selection, note-transition rules or F1 recovery ownership are changed here. No new
locale strings were required; all existing locale/interpolation contracts remain.

### Independent-review correction to the initial Task4 source

The initial fixed1280px cap diverged from xl80rem at non-default initial fonts,
its fixed460px reserve omitted rem growth and the reader's second scrollbar, and
the outer selected secondary fill matched its muted parent. The rules above
supersede those initial assumptions. Tests cover just below/at80rem and the
formerly divergent1280/1440px interval at14/16/20/24px initial fonts, both answer
and nested-reader arithmetic, actual selected-marker token contrast, and focus
leaving the tablist for a visible header control. The authored-CSS helper now
converts px/rem explicitly, supports emitted width-range syntax, and rejects
unknown/malformed media syntax rather than treating it as active. A bounded
installed-Tailwind compilation confirms matching80rem media rules; it is not a
production build or browser measurement. No additional off-workspace contrast
repair is included in this review round.
