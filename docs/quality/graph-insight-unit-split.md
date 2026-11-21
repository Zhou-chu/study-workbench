# Graph node and empty-insight unit split

Base `cd9c3873e1f4b9ff254e7cea7bd5faeeb1111f4a`. No production, main manifest, deployment, publishing or coverage-exclusion changes.

## Boundaries

`test_graph_nodes_unit.py` has 12 expanded cases: complete source-title-preservation and model-ID-forwarding classes, plus three complete transformation methods (DTO shape, missing input, three empty-text parameters). `save_source` executes real title/Asset mapping but Source.get/save are doubles, embed is false and execution_owner absent. The literal /tmp/file.pdf is an Asset value, not an opened file. `transform_content` executes actual forwarding/insight orchestration with graph and persistence doubles; its internal ownership helper returns without database calls because execution_owner is absent. Worker forwarding replaces Source/Transformation lookup and transform_graph. The transformation empty-content guard stops before DefaultPrompts/model provisioning. No real SDK scheduling or LangGraph workflow is executed.

`test_create_insight_worker_unit.py` has two complete direct worker/whitespace cases: graph lookup/invocation and source insight persistence are doubles. It proves exception propagation and whitespace early return, NOT actual retry scheduling despite the inherited explanatory test docstring. The original worker docstring references test_graphs.py; the relevant guard now lives in test_graph_nodes_unit.py. That historical prose was retained to preserve complete AST.

Original `test_graphs.py` retains 13 cases including real temporary upload write/delete, SDK tool invocation/graph compilation structure and content-processing configuration scenarios not independently promoted in this batch. It remains mixed, not wholesale unit. Original insight file retains all four actual TestClient/ASGI cases, API integration.

No shared fixture is needed: moved classes/functions have self-contained setup, and client fixture stays only in the API file. No tests import either old test module; tracked Python Import/ImportFrom and string references were audited. No downstream rewrite required.

## Verification

Evidence: `<private-evidence>/python/graph-insight-unit-split`.

- Expanded collection 31 -> 31 with exact case/class/parameter suffix multiset. Adjacent JSON records each old/new node ID.
- All 23 graph test methods and five insight top-level functions/fixture are AST-identical; no test duplication, altered decorators, parameters or assertions. Transformation class container is split while method names remain unchanged.
- Independent new units: 14 passed, one existing SDK Pydantic deprecation warning, 1.38s.
- Combined original/new: 31 passed, two existing SDK/TestClient deprecation warnings, 1.81s; no failures/skips.
- Ruff check/format check and git diff --check pass.
- All 180 first-party production Python paths/content are identical to base; sorted path-NUL-content SHA256 `71eddbf2136bb8c3891826d8f9a677db81f92e5d6004a4a6aec39a7644eba384`.

Runner: prepared Python runs `scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> --` with relevant test paths and `-q`; collection adds `--collect-only`. PATH uses prepared Git/Node24 before /usr/bin:/bin.

Frozen-a84cbfb unit baseline: graphs/source.py 127/178 lines and 36/62 branches; transformation.py 54/61 and 8/14. No new global coverage run or >90 claim. This is a classification-preserving extraction, not additional test scenarios or proof of real provider/database behavior.
