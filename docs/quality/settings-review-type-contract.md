# Settings QA fixture type contract

Public baseline: `02576c6154e3358cb334c9170a616fa897378093`.

The QA runner's exec namespace was inferred as `dict[str, str]`, making
its API callback appear non-callable; its failure-mode dictionary was inferred
as accepting only `None`. The namespace now admits objects and validates the
actual callback before server startup. A separate narrowed alias preserves the
callable contract inside the route callback. Failure modes explicitly admit
strings and `None`. No `Any`, type-ignore, or mypy scope reduction was added.

Verification in an isolated cloud checkout using Python 3.12, pytest 9.0.3,
mypy 1.19.1, Ruff 0.14.13 and Pydantic 2.12.5:

- Before: exact QA module mypy reports three errors.
- Red: four invalid handler cases fail to raise; valid callback case passes.
- Green: five AST-isolated contract checks pass; exact script and test mypy pass.
- Ruff check and format pass for both files.

The tests execute only selected extraction/validation AST statements. They do
not execute the whole QA runner, its dynamic fixture loader, Vite or Playwright.
They are conservatively classified as tool-integration, not added to strict
unit coverage. No full-project mypy or runtime acceptance claim is made from
this minimal cloud environment. Historical private desktop candidates are not
present or overwritten. The two sanitized public QA-script path conventions
remain unchanged. No provider calls, user profiles, databases or deployment
were used.

Full `pytest -q --maxfail=1` was attempted in the minimal environment and
failed during collection of `tests/test_add_insight_failure_propagation.py`
because `loguru` is not installed. This is not a full-suite pass; the locked
application environment must run the regression before publication acceptance.
Independent source review found no blocking issue in the two-file fix.

## Locked-environment follow-up

After `uv sync --frozen --group dev`, full-repository Ruff check and format
checks both pass. Full mypy reports 232 errors in 42 files (463 sources), down
from the hosted baseline's 235 errors in 43 files: the three repaired QA
errors disappear, without changing checker scope. Classification has 549
entries and only the existing 158 unresolved mixed-test errors.

The complete isolated offline regression reports 5478 passed, 128 skipped,
two warnings and seven failures, all in `test_historical_database_runner.py`.
Each failure rejects this cloud machine's `/tmp` ownership/sticky-bit custody
before reaching the simulated database behavior. No system permissions or
security checks were changed to force a pass. The exact baseline's GitHub
mixed job succeeded; this candidate still requires its own hosted result.
The early minimal-environment missing-dependency failure above remains recorded
as a superseded setup attempt, not omitted from the evidence.
