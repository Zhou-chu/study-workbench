# Notebook editorial redesign
The user rejected the control-heavy notebook interior and requested a full black/white minimalist rebuild. This design keeps the existing React/Vite app, stores, APIs and protected lifecycle behavior.

## Direction
Use the blog reference's editorial typography, paper/charcoal surfaces and fine rules, not its decorative hero. A notebook is a workspace: a compact source rail alongside one primary Conversation or Notes & Results canvas. A reader opens contextually; slots stay mounted so drafts and reading state survive. Small screens use explicit section navigation and a full-width reader.

## Hierarchy
Global navigation becomes a restrained row. Appearance and language remain accessible. Notebook settings, classic mode and tools move into a labeled secondary menu. Notes present human titles, previews and saved results. No raw task IDs, JSON snapshots or protocol strings on normal surfaces. Operations remain available through meaningful generation/export controls and clear pending/error/recovery messages.

## Constraints
No backend/data/auth changes. Preserve revision conflicts, unsaved drafts, retries, cancellation uncertainty, source selection and protected audio downloads. No live build/deployment or user database. Use an isolated branch based on login fix 0dc8130. Screenshot review uses synthetic fixtures in an isolated test app only; the stopped Windows browser remains untouched.

## Alternatives
A palette-only refresh leaves the rejected hierarchy intact. Another dense three-column dashboard repeats it. The chosen focused workspace gives reading and writing room while retaining reachable secondary functionality.

## Verification
Tests cover no identifier leaks, unknown-state fallback, retained editor DOM, navigation and actions. Run full frontend tests, typecheck, lint and build; inspect light/dark desktop and mobile screenshots of home, notebook, reader, notes and settings. Record limitations honestly.
