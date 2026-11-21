# Personal security dispatch unit decisions

Base `f12fe664`. 28 new parameterized cases call the real middleware dispatch
with in-memory Starlette Request/Response. Only the password loader and next
handler are doubles; no ASGI/TestClient, filesystem, network or application
startup. Environment values are monkeypatch-isolated. No production changes.

Coverage includes nonlegacy bypass without legacy credential observation,
unprotected-route bypass, private versus personal path protection, missing
credentials (503, no continuation), four mutation methods denied for foreign
Origin including wildcard configuration, same-origin and explicit-origin
allowance, absent Origin behavior, GET/HEAD/OPTIONS, response identity and
privacy/nosniff header replacement. This does not test bearer authentication,
real credential custody, ASGI middleware composition or device-mode policy.
No new production defect is claimed.

## Reproduction and measured evidence

Use the prepared locked environment and offline tokenizer cache:

```sh
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_personal_security_dispatch_unit.py -q
python -m mypy tests/test_personal_security_dispatch_unit.py
ruff check tests/test_personal_security_dispatch_unit.py
ruff format --check tests/test_personal_security_dispatch_unit.py
```

28 unit cases passed (0.51s); exact mypy and Ruff pass. Combined regression
with existing `test_v1_access_control.py`: 36 passed, 1 warning (10.76s).
The HTTP regression remains integration, not unit.

Separate unit-only native coverage: 28 passed (10.32s), 181 production files,
24,026 statements and 7,036 branches; 56 unchanged default excluded lines.
Personal security module: 23/23 lines and 8/8 branches. Compared with the saved
historical reviewed-unit report, this run touches 17 previously missing lines
and 8 missing arcs. This is a historical intersection, not a newly measured
whole-suite union. Whole-project totals for this narrow run are 163/24,026
lines and 13/7,036 branches, combined 0.56661%; native exit 1 retains the
90.01 threshold. Full-project strict acceptance remains unproven.

Independent review approved classification as `unit`, targeting
`api/personal_security.py`; the manifest now records the exact test hash.
Raw reports are retained externally. See the integrated core-security
checkpoint for the subsequent complete-source reviewed subset measurement.
