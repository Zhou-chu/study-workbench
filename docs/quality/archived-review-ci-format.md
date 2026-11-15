# Archived review script: CI formatting repair

## Scope and provenance

The public PR run `43667738782` at `8cb99cd` stopped at Ruff on 39 E701/E702 findings in `docs/v1/evidence/model-setup-2026-11-11/final-review-e59ab1e.py`. This patch is based on private source `6b72f5c19346e4efed456b57718fd80566f830f9`; its full-scope check also reports one I001 in that script. The private and public snapshots are not claimed byte-identical.

The archived script is now a formatting-maintained copy, not a new execution artifact. Original source remains recoverable with `git show 6b72f5c:docs/v1/evidence/model-setup-2026-11-11/final-review-e59ab1e.py`. An external evidence snapshot also preserves exact original bytes. Archived screenshots, JSON reports and all other historical outputs are unchanged. None of the browser script, API, database, deployment or service launch code was executed for this repair. Existing script runtime assumptions and safety limitations are not improved or revalidated here.

Ruff formatting alone eliminates all 39 statement-layout findings with exactly equal Python ASTs (excluding location attributes). The remaining I001 fix inserts import grouping whitespace and changes only the aliases within the same `from playwright.sync_api import ...` statement from `sync_playwright, expect` to `expect, sync_playwright`. Thus the final entire AST is NOT byte-for-byte structurally identical: after normalizing only that one import's alias ordering it is equal. No import module, alias binding, condition, call, literal, assertion or ordering of executable body statements changes. This is import-style maintenance, not a claim to an executed behavioral regression.

Full-scope format check additionally found four previously unformatted test files. They received formatting only; exact ASTs and all assertion/parameter nodes remain equal. No test was dropped, relabeled or weakened. Test-layer hashes must be refreshed at integration; this patch does not edit their layers or the production coverage inventory.

## Private byte and AST audit (historical source; not public byte hashes)

| Path | Original SHA256 | Maintained SHA256 | Exact AST | Assertion count unchanged |
| --- | --- | --- | --- | --- |
| `docs/v1/evidence/model-setup-2026-11-11/final-review-e59ab1e.py` | `5affbecbad8e3c3db0f399bcf4bf7cf44a9f9aaa9d408c6adbb442d3587f8f9d` | `c34f286214d130feddc3f59082686c0d12efbf59691557797cbdb1d294a8cb89` | False | 12 |
| `tests/test_domain_values_unit.py` | `22bc95440cb94b2c242d391824ee93f1634e2284a92388307a6f3ec8322a05d1` | `8d19e319cc1cb6cccbfa31ccbea3b401bf985a37aa72854dd7bd850233dee8b4` | True | 42 |
| `tests/test_evidence_indexing_state_unit.py` | `63e896996b9d3202d5e98bf9f8c132bd3b0c31be240a8811a99d9a1a6a2c723c` | `f9db25b40dde13ceffd44d5aec1f25b3d2a6e71852175e4c38a26ad01a508c40` | True | 40 |
| `tests/test_personal_store_bulk_unit.py` | `97c48bd2438e819ba6c963cad7967d1c957f477521cd89a355aa4d6eedc6d5f8` | `c1c5cc40f3a3c892635f74e7d625385548f2e1a5c6a20dc4ef24330ed36046d4` | True | 8 |
| `tests/test_v1_evidence_reads.py` | `1fec2bca2bb0d6b298d0ccc816f644a737aa2628c2e7086f0b1ab6ff4f073d51` | `1a6900e62f752be135d22a43778b986d2ed29149ed705fc072b7dcd4880ab005` | True | 37 |

## Reproducible static contract

For the private audit, use its original Git objects, never import or execute the archived file. Public clones do not contain that private ancestor; public reproduction uses parent `8cb99cdf08edf30e658ca29d01818da7789aac28` instead:

```python
import ast
import subprocess
from pathlib import Path

paths = [
    "docs/v1/evidence/model-setup-2026-11-11/final-review-e59ab1e.py",
    "tests/test_domain_values_unit.py",
    "tests/test_evidence_indexing_state_unit.py",
    "tests/test_personal_store_bulk_unit.py",
    "tests/test_v1_evidence_reads.py",
]
for path in paths:
    old = ast.parse(subprocess.check_output(["git", "show", "8cb99cdf08edf30e658ca29d01818da7789aac28:" + path]))
    new = ast.parse(Path(path).read_bytes())
    if path.startswith("docs/"):
        for tree in (old, new):
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == "playwright.sync_api":
                    node.names.sort(key=lambda alias: alias.name)
    assert ast.dump(old, include_attributes=False) == ast.dump(new, include_attributes=False), path
```

## Private validation and remaining gate failures

- Prepared Ruff `check .`: exit 0, all checks passed.
- Prepared Ruff `format --check .`: exit 0, 462 files already formatted.
- Prepared `python -m mypy .`: **235 errors in 43 files**, 462 source files checked. This is NOT a green static job. No type exclusions, ignore rules or scope were changed.
- The errors include archived script 24, current model-setup review script 75, visual-review 10, settings-controls review 3, unit pytest evidence 5, NotebookLM SDK adapter 4, and 114 across tests. These require a separate reviewed type-correction batch; formatting cannot honestly fix them.
- No application tests, fresh browser acceptance or complete PR job rerun is claimed. The code/parameter/assertion conservation evidence is static.

External evidence directory: `notebook-quality-20261113/ci/archive-format` holds original snapshots, full Ruff before/after logs, AST/hash audit and full mypy output. The first shell wrapper lost its exit-code variable across shells; the raw failure log is retained, and a Python subprocess repeat records the actual process exit code separately. Existing strict-unit coverage/mixed classification blockers remain independent and unresolved.

## Public candidate validation

The archived script was formatted from the already sanitized public parent, not overwritten from private source. Its public original is retained in that Git parent and an external snapshot. After normalizing only the Playwright import alias ordering, its AST is equal; all four test ASTs are exactly equal and their resulting bytes match the private endpoint. The private hash table above is historical, not a claim that public archive bytes equal private bytes.

Actual public full-scope mypy: 235 errors in 43 files (462 checked), exit 1. Four related test files: 107 passed, one dependency warning, 1.80 seconds. Ruff initially found one import-grouping diagnostic and two inherited public scripts needing formatting; these initial failures are retained externally. No browser script was executed.

Publication verification also exposed Ruff namespace inference from ignored coverage/web reports. A real-source two-root regression passed without reports and failed with reports before the fix. Explicit known-third-party coverage classification makes both pass without changing source import execution order, suppressing rules or excluding files. The full CI tool contract suite has12 passing cases; tests remain tool-integration. A preliminary minimal fixture was replaced by the actual source layout before accepting the RED evidence. No code installs or network calls occur in the regression.

Final public verification after the explicit dependency classification and AST-identical inherited-script formatting: Ruff check and format-check exit 0, 462 files formatted; CI contract 12 passed in 0.22 seconds. Full mypy was repeated and still reports 235 errors in 43 files (462 checked), exit 1. No type scope was reduced.
