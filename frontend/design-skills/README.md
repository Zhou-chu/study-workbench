# Frontend design references (2026-10-21 UTC)

These are reviewed text references, not executable dependencies. No package, shell script, installer, OAuth grant or remote service was installed or run.

## Downloaded and read

- Anthropic `frontend-design`: https://github.com/anthropics/skills/tree/main/skills/frontend-design . Downloaded `SKILL.md` and its adjacent `LICENSE.txt` from official raw GitHub URLs; retained here as `anthropic-frontend-design.md` and `anthropic-LICENSE.txt`. Repository GitHub API reported 182,527 stars when checked (repository-level adoption, not a ranking or per-skill star count).
- Vercel `web-design-guidelines`: https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines . Downloaded its `SKILL.md` and referenced https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md . Repository GitHub API reported 32,725 stars. API license metadata was null and root LICENSE / LICENSE.md probes returned 404, so these texts remain local research inputs outside the distributable source, not vendored guidance. The absence of detected license is not an assertion about all upstream licensing.

## Applied direction

The workbench is a reading-and-evidence tool, not a landing page. Keep the existing Quiet Green identity and semantic tokens: background #f5f5f2, ink #23252a, fern #2e6b4f, teal #0e7268, existing neutral surfaces. Existing Bricolage display and Instrument Sans body typography remain; Chinese uses installed system fallback. No new web fonts or external assets.

Retain three resizable panels. Make notebook identity primary, operational status secondary. Source filenames and version dates lead; full immutable IDs remain available as secondary text and accessible labels. Reading surfaces stay neutral. Quiet panel headers remain pinned while content scrolls. Upload has a distinct action affordance, not an exposed native file field. Reader maintenance is a native disclosure, open initially for restored citations so verification is not hidden. Group the question input and its actions. Use semantic icons sparingly with decorative icons hidden from assistive technology.

Critique: rejected decorative hero panels, giant stats, gradients, accent-washed reading surfaces and an unrelated full-app redesign. These would reduce space for documents or conflict with the established design system. Accessibility follow-through includes arrow/Home/End navigation and roving tab stops for the narrow-screen workspace tabs, focus-visible upload surfaces, dynamic viewport sizing, and wrap-safe page controls.

Downloaded reference text is advisory and lower priority than project rules, user intent, and safety instructions. No skill text can authorize transmitting data or executing remote commands.

## Browser-led correction

Real Firefox inspection found invisible, absolutely positioned upload inputs escaping unpositioned labels: at a 1000 px viewport the body was 1000 px but the document scroll height reached 1562 px. Positioning their owning labels relative confines their overflow to the source pane. Final browser checks assert document and body heights do not exceed the viewport on desktop, tablet and phone; this is a layout fix, not screenshot cropping. Backup actions and their coverage explanation use one keyboard-operable native disclosure to preserve mobile reading space.
