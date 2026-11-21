"""Authored schema and public synthetic fixture contracts."""

import json

from v1_api_contract_fixtures import CONTRACT, FIXTURES, fixture


def test_schema_records_real_paths_requests_and_known_response_gaps():
    schema = json.loads(CONTRACT.read_text())
    paths = schema["paths"]
    assert len(paths) > 100  # Whole app, not a personal-router substitute.
    assert "/api/notebooks" in paths
    turn = schema["components"]["schemas"]["TurnRequest"]
    assert turn["properties"]["engine"]["enum"] == ["notebooklm", "independent"]
    assert {v["type"] for v in turn["properties"]["model_id"]["anyOf"]} == {
        "string",
        "null",
    }
    ids = [
        op["operationId"]
        for item in paths.values()
        for op in item.values()
        if isinstance(op, dict) and "operationId" in op
    ]
    assert len(ids) == len(set(ids))
    for path, method in (
        ("/api/personal/chats/{chat_session_id}/turns", "post"),
        ("/api/personal/jobs/{job_id}", "get"),
        ("/api/personal/jobs/{job_id}/cancel", "post"),
    ):
        assert paths[path][method]["responses"]["200"]["content"]["application/json"][
            "schema"
        ]
    workspace = paths["/api/personal/notebooks/{notebook_id}/workspace"]["get"]
    assert workspace["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/WorkspaceResponse")
    portable = paths["/api/personal/imports/portable"]["post"]
    assert "201" in portable["responses"]
    assert portable["requestBody"]["content"]["multipart/form-data"]["schema"][
        "required"
    ] == ["file"]
    for path in (
        "/api/personal/exports/{export_id}/download",
        "/api/personal/source-versions/{source_version_id}/download",
    ):
        assert "get" in paths[path]


def test_public_examples_are_explicit_synthetic_data_with_utc_timestamp():
    from datetime import datetime, timedelta

    from open_notebook.domain.evidence import EvidenceCitation

    job = fixture("job")["response"]
    assert job["notebook_id"] == "notebook:synthetic"
    assert datetime.fromisoformat(job["created_at"]).utcoffset() == timedelta(0)
    citation = EvidenceCitation.model_validate(fixture("turn")["unmapped_citation"])
    assert citation.source_version_id is None
    assert citation.reference_validity == "unverified"
    for path in FIXTURES.glob("*.json"):
        text = path.read_text()
        if path.name == "auth-session-created.json":
            # Native auth schema necessarily names token fields. Permit only
            # these exact zero-entropy fixtures, never real/random credentials.
            synthetic = json.loads(text)
            assert synthetic.pop("access_token") == "swa1_" + "A" * 43
            assert synthetic.pop("refresh_token") == "swr1_" + "A" * 43
            assert synthetic["session_id"] == "00000000-0000-4000-8000-000000000000"
            text = json.dumps(synthetic)
        assert not any(
            value in text
            for value in (
                "/home/",
                "Bearer ",
                "sk-proj-",
                "storage_state",
                "access_token",
                "refresh_token",
                "@gmail.com",
            )
        )
