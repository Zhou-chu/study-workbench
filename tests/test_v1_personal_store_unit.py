"""Direct logical-unit cases extracted without changing assertions or parameters."""

from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_store_rejects_unknown_kind_before_database():
    from api.personal_store import PersonalStore

    with pytest.raises(ValueError):
        await PersonalStore().get("credential", "x")


def test_record_identity_stable_and_kind_separated():
    from api.personal_store import record_key

    # Golden SHA256("x") protocol vector: a constant or altered encoding fails.
    digest = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"
    assert record_key("version", "x") == f"v1_version:{digest}"
    assert record_key("evidence", "x") == f"v1_evidence:{digest}"
    assert record_key("version", "y") != f"v1_version:{digest}"


@pytest.mark.asyncio
async def test_production_store_extraction_invalidation_delegates_under_existing_barrier(
    monkeypatch,
):
    from api.personal_store import PersonalStore
    from open_notebook.database import evidence_embedding_repository as module

    invalidate = AsyncMock()
    monkeypatch.setattr(
        module.EvidenceEmbeddingRepository, "invalidate_locked", invalidate
    )
    await PersonalStore().invalidate_evidence_scope(
        "notebook:allowed", ["v1"], "reparse"
    )
    invalidate.assert_awaited_once_with("notebook:allowed", ["v1"], "reparse")
