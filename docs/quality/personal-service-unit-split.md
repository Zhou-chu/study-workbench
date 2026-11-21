# Personal service logical unit split

The 12 original cases become 11 logical units and one component contract. All 13 function/class ASTs, including MemoryStore and every assertion/decorator, are unchanged. The fake store moves into a non-collected tests helper. Original and split combined runs each passed all 12 cases (one existing dependency deprecation warning). Ruff passed after import sorting.

Independent review confirmed persistence, dispatch, NotebookLM.ask, note repository and embedding calls are boundary doubles. The remote_unmapped note branch never invokes EvidenceService.validate_citation; the forged verified citation case deliberately retains that real independent validator and stays component-integration.

This is logical-unit classification, not a claim of literally zero filesystem calls during Python startup/import: existing configuration import initializes its directory under the offline runner isolation, and EvidenceService construction resolves a path. No case asserts filesystem behavior or uses real user data. Production sources, exclusion rules and denominator remain unchanged. Raw baseline/split evidence and original source are retained privately at python/personal-service-unit-split. No full-project gate, CI or deployment acceptance is claimed.
