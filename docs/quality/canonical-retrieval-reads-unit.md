# Canonical retrieval read units

21 cases execute the real physical-ID read cache with only get_many persistence replaced. Assertions cover validated IDs before any I/O, exact 128-row batch boundaries and deduplication, response membership/shape/physical ID integrity, copied cache values, cached absence versus fresh-phase revalidation, kind-separated identities, bounded failure without retry, sanitized exception chains, original cancellation, and failure in a later batch without inventing missing rows. No real database, locks, sockets, files or provider is exercised. These tests characterize existing behavior, not a production change or a claim of transaction atomicity.

21 passed; Ruff check/format passed. Raw evidence retained privately under python/canonical-retrieval-reads-unit. Full-project 180-source coverage is measured separately without exclusions or relaxed thresholds.
