# SSL and reader lossless test classification

Base: `aa7ccde`. This is classification migration, not new business coverage.
No production code or production coverage inventory changes.

- SSL environment mapping: 6 expanded unit cases in `test_ssl_config_unit.py`.
  The identical autouse environment-cleanup fixture is retained in both files.
- SSL CA precedence and missing CA: 2 tool integration cases remain in
  `test_ssl_config.py`; production `os.path.isfile` accesses the filesystem.
- Reader unsafe-original MIME rejection: 1 direct-function unit case in
  `test_reader_download_policy_unit.py`, with EvidenceService/version replaced.
- Historical reader HTTP response: 1 API integration case remains in
  `test_v1_reader_history.py`, exercising actual FastAPI/TestClient routing.

All original function ASTs, decorators, parameter values and assertions are
unchanged. Expanded case names match exactly across the split (10 before/after).
No helper is imported from a collected test module. Artifact identity and retry
visibility remain unchanged and mixed.

## Verification

Using the prepared full environment and offline runner with prepared tokenizer:

```sh
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer --   tests/test_ssl_config.py tests/test_ssl_config_unit.py   tests/test_v1_reader_history.py tests/test_reader_download_policy_unit.py -q
```

Original combined: 10 passed, 2 warnings (1.59s).
Split combined: 10 passed, 2 warnings (1.31s).
Unit files alone: 7 passed, 1 warning (1.15s).
Ruff check and format check pass for all four files.
Exact-file mypy checks all four: no test diagnostics, but native exit 1 due to
four pre-existing imported SDK optional-handle errors in `sdk_adapter.py`
(lines 540, 543, 544, 545). No ignore/cast/scope exclusion was added.
Full manifest file hashes were verified. Full-project coverage and CI were not
rerun; this split does not establish the strict coverage gate.
