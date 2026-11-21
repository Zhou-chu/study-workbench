# Background retry policy classification

Base public d355588. Five read-only registered command retry-policy assertions
now live in test_background_retry_policy_unit.py. The actual SDK/Tenacity retry
iteration and Loguru warning callback remains component integration in the
original file. Both source_commands and embedding_commands are targets.

The three original function ASTs, helper logic, decorator and five parameter
values are identical. Before and after: six passed, one dependency warning;
expanded case names match. Independent review approved this boundary. This is
classification migration, not new business coverage or proof of runtime retry.
The existing commands import initializes no_proxy but neither connects to a
DB nor runs a task; use the isolated runner environment as before.

Ruff check/format pass after normalizing blank lines. Exact-file mypy retains
four imported SDK optional-handle diagnostics and none in these tests. No
ignore, cast, production change, provider request or deployment was added.
