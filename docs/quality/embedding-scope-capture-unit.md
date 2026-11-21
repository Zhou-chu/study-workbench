# Embedding repository canonical scope unit evidence

Base: 2dadeee307dbb81db29373c514adf0a3dad11476. Production unchanged.

38 strict unit cases execute real capture_scope, _metadata, _canonical,
_capture_locked, assert_scope and _assert_locked, real immutable DTOs and hashing.
Only injected query adapter and project_lock are synthetic. Query returns copied
fixed projections, not a fake SQL interpreter. No DB/provider/network/filesystem
lock/user data. No mixed fixture imports. This proves neither SQL execution nor
transaction isolation.

Cases protect sorted/deduplicated selection, exact physical targets, membership
before evidence read, version/extraction/notebook/physical binding, hash/cardinality
integrity, empty canonical sets, epoch typing/uniqueness, fresh revalidation and
cancellation releasing the barrier. Assertions bind query order, exact parameters,
snapshot hashes and no later I/O on rejection. Ready and partial metadata covered.

Verification: 38 passed; Ruff check/format and diff check pass. No production bug
found; no fabricated RED. Full denominator: 180 sources, 23902 lines / 6998 arcs,
56 pre-existing exclusions. 515 lines (2.15%), 66 arcs (0.94%), combined 1.88%.
Native coverage exit 1: original 90.01 threshold unmet. Not whole-project success.

Repository: 149/371 lines (40.16%), 49/150 arcs (32.67%). Six selected methods:
80/81 lines, 47/48 arcs. Direct _metadata empty-selection guard unexecuted because
public capture_scope rejects earlier; retained in denominator.
Delta vs frozen-d36ebf4/unit: +83 lines/+48 arcs, set comparison not combined run.

Evidence prefix <private-evidence>/python/embedding-scope:
- verified.log and exit.json: authoritative subprocess returncode
- .json, .ini, .coverage: native report/config/data
Earlier shell native_exit echo was unreliable (PowerShell expansion), superseded
by directly captured subprocess result. All earlier logs retained.

Replay:
 <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_embedding_scope_capture_unit.py -q --cov --cov-config=<private-evidence>/python/embedding-scope.ini --cov-report=json:<private-evidence>/python/embedding-scope.json --cov-report=term

Test SHA256: 75ce2732ebb9b370ffdbca248abdeb2f4092e8afd5d780d551a69e3ae034bd69
