"""Cross-entrypoint collaboration for the shared upload budget."""

import pytest


@pytest.mark.asyncio
async def test_upload_and_capabilities_share_actual_budget(monkeypatch):
    from io import BytesIO

    from fastapi import UploadFile

    from api.routers import evidence
    from open_notebook.exceptions import InvalidInputError

    async def get(_):
        return object()

    monkeypatch.setattr(evidence.Notebook, "get", get)
    monkeypatch.setattr(evidence, "EvidenceService", object)
    monkeypatch.setattr(evidence, "get_source_upload_max_bytes", lambda: 2)
    with pytest.raises(InvalidInputError, match="FILE_TOO_LARGE"):
        await evidence.upload(
            "notebook:synthetic",
            UploadFile(BytesIO(b"123"), filename="synthetic.txt"),
            idempotency_key="synthetic",
        )
    assert (await evidence.client_capabilities())["limits"][
        "source_upload_max_bytes"
    ] == 2
