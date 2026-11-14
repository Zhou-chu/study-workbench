"""In-memory evidence record limit without ingestion or parser subprocess."""

import pytest


def test_evidence_record_limit_is_opt_in_and_never_truncates():
    from api.evidence_service import build_evidence_records, parse_text_bytes
    from open_notebook.exceptions import InvalidInputError

    version = {
        "origin": "derived_snapshot",
        "source_version_id": "sv_bounded",
        "notebook_id": "notebook:one",
        "source_title": "Small paragraphs",
    }
    blocks = parse_text_bytes("\n\n".join(["tiny"] * 1001).encode(), 1024 * 1024)[
        "blocks"
    ]
    assert len(build_evidence_records(version, "ex_bounded", blocks)) == 1001
    with pytest.raises(InvalidInputError, match="EVIDENCE_LIMIT"):
        build_evidence_records(version, "ex_bounded", blocks, max_records=1000)
