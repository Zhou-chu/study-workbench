# Note transaction acknowledgement split

One original function, with both parameter values and every assertion unchanged, moves into test_v1_note_transaction_unit.py. It substitutes only the db_connection/query_raw boundary and tests real _transaction acknowledgement rejection. No database, file lock, filesystem or route is used by these two unit cases.

All original function ASTs are preserved. Collection is 20 before/after with only the moved file prefix changed. Independent unit: 2 passed; combined files: 2 passed, 18 opt-in synthetic SurrealDB tests skipped. Those 18 are NOT accepted or counted as unit. Raw evidence: python/note-transaction-unit/ in the private evidence archive. No production code or denominator changed; no full-project acceptance claimed.
