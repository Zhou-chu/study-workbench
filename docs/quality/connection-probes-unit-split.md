# Connection probe unit split

The existing 52-case offline suite is split into 50 direct unit cases and two filesystem boundary cases. All 18 original top-level function ASTs, decorators and assertions are retained unchanged. No production source or coverage exclusion changes.

The unit cases replace DNS pinning, HTTP client, external model manager/provider instances and audio loading at their boundaries. Real probe URL/header formation, result interpretation, voice selection and error classification remain under test. No live provider, credential, DNS lookup, socket or audio file is used by those cases. The two real file-open/write cases remain tool-integration and are not counted as unit.

Validation: original 52 passed; split combined 52 passed; isolated unit 50 passed; Ruff check passed. Raw before/after evidence and original source are retained in the private evidence archive (python/connection-probes-split). This is not a full-project coverage or Quality Gate pass.
