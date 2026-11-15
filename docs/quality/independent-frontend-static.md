# Preserve frontend static diagnostics after backend failure

Exact hosted checkpoints had passing dependency setup and a failing Python
mypy step, which caused the subsequent frontend lint/typecheck step to be
skipped. The frontend step now requires successful dependency installation
and a non-cancelled workflow, not Python-static success. Commands, pinned
Actions, permissions, triggers, branch scope and failure propagation are
unchanged. No continue-on-error or shell failure suppression is introduced;
a Python failure still makes the static job fail.

GitHub documents the implicit success condition and recommends !cancelled()
for work that should run after success or failure but respect cancellation:
https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions

The structural regression first failed (1 failed, 12 passed), then all 13
CI-tool contracts passed. Exact test-file mypy and Ruff pass. This does not
simulate GitHub's expression engine: a subsequent exact hosted run must prove
that frontend commands actually execute. These remain tool-integration tests,
not strict-unit coverage. No deployed service or production data was changed.

Local integrated verification with both npm lockfiles installed: workspace
lint/typecheck, legacy lint and legacy tsc all exit 0; legacy lint retains seven
warnings. Full Python lint/format pass and mypy still fails with 213 errors,
so none of those results is hidden by a successful frontend check. The hosted
runner's control-flow behavior remains to be verified on the published revision.
