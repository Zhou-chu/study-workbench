# Portable visible-history adapter decisions

Eight cases exercise the real SurrealProjectRepository._visible_messages and
real extract_chat_messages/response models. Filesystem existence, graph modules,
configuration and thread execution are boundary doubles. No graph get_state
callback, SQLite read or real thread executes. Config is explicitly supplied as
a synthetic module before the method's import: this prevents cold config import
from creating directories, rather than relying on a warm module cache. Normal
isolated test bootstrap is still required; no user environment or secret file
is used. Monkeypatch restores module/config boundaries after every case.

Cases retain the explicit missing-history refusal unless restored fallback is
allowed, notebook-versus-source graph/session binding, only human/AI visible
message output, empty state, malformed-message refusal, sanitized read failure
with its original cause, and cancellation propagated by identity. The fake
executor does not prove real background-thread cancellation or SQLite integrity.
Real graph compilation/checkpoint compatibility and durable export remain separate
integration concerns. No production implementation changed.

Eight cases pass after cold-config isolation; exact-file mypy and Ruff/format
pass. These are direct logical-unit policy tests, not a live export or browser
acceptance result. Whole-suite coverage must use the unchanged complete inventory;
no overall >90 claim follows from the focused run.
