"""Direct download MIME rejection with the storage boundary replaced."""

from unittest.mock import AsyncMock

import pytest

from open_notebook.exceptions import InvalidInputError


@pytest.mark.asyncio
async def test_download_rejects_active_imported_mime(monkeypatch):
    from types import SimpleNamespace

    import api.routers.evidence as module

    monkeypatch.setattr(
        module,
        "EvidenceService",
        lambda: SimpleNamespace(
            version=AsyncMock(return_value={"mime_type": "text/html"})
        ),
    )
    with pytest.raises(InvalidInputError, match="UNSAFE_ORIGINAL_TYPE"):
        await module.download("sv")
