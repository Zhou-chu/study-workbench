# Portable budget fixture type contract

Exact-file baseline mypy reports six errors, not five: one intentional frozen-property write, three optional module-spec/loader errors, and two heterogeneous manifest indexing errors. All original 29 cases pass before the correction.

The negative frozen-field test still performs the same forbidden assignment at runtime, now through setattr, and still requires FrozenInstanceError. Explicit non-None assertions for the import spec and loader make missing loader state fail before module execution. The manifest retains the exact same nested dictionary object through a named member_specs reference; malformed hash/size variants mutate that object before serialization. The alias does not copy data or skip any corruption case. No production behavior, expectations, parameter values, scope, Any, cast or ignore change is involved.

After correction: the same 29 cases pass (0.16s; baseline 0.18s), exact-file mypy has zero errors, and Ruff check/format-check pass. External evidence is retained under notebook-cloud-budget-type-results. The existing test classification and all-production coverage denominator are unchanged; no full coverage run, CI success, deployment or user-data access is claimed.
