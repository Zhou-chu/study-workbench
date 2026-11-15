# Evidence read reuse and retry-policy checkpoint

Frozen verification revision: 667afc9. Adds 21 request-local evidence read units
and losslessly separates five existing retry-policy assertions from one actual
SDK/Tenacity/Loguru integration case. Production behavior and inventory remain
unchanged. Independent review approved both boundaries. No authentication or
encryption code was modified; no database, provider or deployment was used.

Full offline Python: 5588 passed, 128 skipped, two warnings, seven unchanged
historical database runner temporary-parent custody precondition failures,
146.29s. The exact seven test names and cloud constraint are listed in
core-security-classification-checkpoint.md; no permission or safety bypass was
introduced. This remains a failing local full-suite result, not full acceptance.

Reviewed Python unit subset: 123 files, 2619 passed, one warning, 129.37s.
Native execution evidence has 2619 cases and 7857 phases, with no deselection or
collection failures. All 181 production files remain, with 24,026 statements,
7,036 branches and 56 unchanged existing exclusions. Source hashes match before
and after. Lines 12,682/24,026 = 52.7845%; branches 3,024/7,036 = 42.9790%; native
combined coverage 50.5634%, exit 1 against 90.01. Raw-set comparison to the prior
core-security subset adds exactly 19 lines and 8 arcs. This is a measured union,
not a sum of module percentages or a claim of complete strict acceptance.

All 558 manifest entries have matching hashes. Classification: 245 unit,
155 mixed, 68 component integration, 54 tool integration, 28 API integration
and 8 static contracts. The complete strict gate remains blocked by mixed files.
Full Ruff and format checks pass. Full mypy remains 211 errors in 37 files,
472 checked; no ignore, cast, test deletion or scope reduction was used.

Reproduce using the locked environment, prepared tokenizer and offline runner;
raw complete logs, native XML/JSON, source digests, selection, execution receipts
and the stage runner are retained externally. Exact hosted CI is a separate
check on the published revision, never inferred from these local results.

Exact frontend static commands also pass locally: workspace lint/typecheck and
legacy lint/tsc all exit 0, retaining seven legacy lint warnings. No browser or
server was started.
