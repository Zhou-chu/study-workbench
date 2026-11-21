# Domain read and logical unit boundaries

Eleven existing context/validation/vectorization methods moved unchanged from test_domain.py into test_domain_logical_unit.py. All 16 original methods retain identical ASTs, parameters and assertions; original and combined split runs each passed 16. The five remaining mixed cases retain real mutation locks, filesystem operations or podcast collaboration. The query mock in the original notebook delete test does not replace its real mutation barrier, so that case was deliberately not counted as unit. Module descriptions now reflect actual boundaries. Independent review accepted the split.

Added 21 unit cases for explicit full-content projection, query identity binding, ordered chat-session results, empty collections, read errors versus cancellation, read-only deletion preview, deduplicated batch insights and sanitized failure text. Only repo_query is replaced. These do not prove actual SQL/database isolation. 21 passed in 0.63 seconds, one existing dependency warning; Ruff passed. Raw evidence is retained privately at python/domain-logical-unit-split and python/domain-read-unit.

No production source, user data, coverage denominator or threshold changed. These targeted results are not full-project coverage acceptance.

Independent review accepted the 21 read cases. Two further cases now explicitly protect omitted-option default lightweight projection; all 23 read cases plus original/split domain16 and receipt40 passed together (79 total). The current preview implementation uses SELECT only, but startswith checks alone are not a general SQL mutation detector.
