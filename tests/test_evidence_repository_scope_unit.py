"""Evidence scope guard and registration with synthetic service boundaries."""

from contextlib import asynccontextmanager
from copy import deepcopy
from hashlib import sha256
from unittest.mock import AsyncMock, Mock

import pytest

from open_notebook.database import evidence_embedding_repository as target
from open_notebook.domain.evidence_retrieval import ScopeEntry, ScopeSnapshot
from open_notebook.exceptions import InvalidInputError
from tests.evidence_embedding_profile_fixture import make_profile


@pytest.mark.asyncio
async def test_empty_scope_reads_no_content(monkeypatch):
    query = AsyncMock()
    lock = Mock(side_effect=AssertionError("empty input must not acquire a lock"))
    connection = Mock(
        side_effect=AssertionError("empty input must not open a database connection")
    )
    monkeypatch.setattr(target, "repo_query", query)
    monkeypatch.setattr(target, "project_lock", lock)
    monkeypatch.setattr(target, "db_connection", connection)

    with pytest.raises(InvalidInputError, match="NO_SOURCES_SELECTED"):
        await target.EvidenceEmbeddingRepository().capture_scope("notebook:allowed", [])

    query.assert_not_awaited()
    lock.assert_not_called()
    connection.assert_not_called()


@pytest.mark.asyncio
async def test_register_attempt_binds_scope_and_profile_before_commit(monkeypatch):
    selected = ScopeSnapshot(
        notebook_id="notebook:research",
        entries=(
            ScopeEntry(
                version_id="v1",
                extraction_id="ex1",
                manifest_hash="a" * 64,
                scope_epoch=2,
            ),
        ),
    )
    profile = make_profile()
    metadata = [
        {
            "version_id": "v1",
            "extraction_id": "ex1",
            "source_id": "source:article",
            "manifest_hash": "a" * 64,
            "scope_epoch": 2,
            "canonical": [{"evidence_id": "excerpt1", "quote_hash": "b" * 64}],
        }
    ]
    before = deepcopy(metadata)
    events = []
    transactions = []

    @asynccontextmanager
    async def lock(notebook_id):
        events.append(("enter", notebook_id))
        try:
            yield
        finally:
            events.append(("exit", notebook_id))

    async def read_snapshot(snapshot):
        events.append(("revalidate", snapshot))
        return metadata

    async def transaction(_statement, params, *, operation):
        events.append(("write", operation))
        transactions.append(params)

    monkeypatch.setattr(target, "project_lock", lock)
    monkeypatch.setattr(target, "_transaction", transaction)
    repository = target.EvidenceEmbeddingRepository(
        query=AsyncMock(
            side_effect=AssertionError("unit must not directly read storage")
        )
    )
    monkeypatch.setattr(repository, "_assert_locked", read_snapshot)

    await repository.register_attempt("index-run-1", selected, profile)
    await repository.register_attempt("index-run-1", selected, profile)

    assert (
        events
        == [
            ("enter", "notebook:research"),
            ("revalidate", selected),
            ("write", "register_attempt"),
            ("exit", "notebook:research"),
        ]
        * 2
    )
    first, second = transactions
    assert first["fence"] != second["fence"]
    assert {k: v for k, v in first.items() if k != "fence"} == {
        k: v for k, v in second.items() if k != "fence"
    }
    assert first["notebook_id"] == "notebook:research"
    assert str(first["notebook_target"]) == "notebook:research"
    assert first["namespace"] == profile.fingerprint
    assert first["dimension"] == profile.dimension
    assert first["preprocessing_revision"] == profile.preprocessing_revision
    assert first["profile"] == profile.model_dump(exclude_computed_fields=True)
    assert first["attempt_id"] == "index-run-1"
    [entry] = first["entries"]
    assert entry["scope_epoch"] == 2
    assert str(entry["source_target"]) == "source:article"
    assert str(entry["version_target"]) == f"v1_version:{sha256(b'v1').hexdigest()}"
    assert (
        str(entry["extraction_target"]) == f"v1_extraction:{sha256(b'ex1').hexdigest()}"
    )
    [excerpt] = entry["canonical"]
    assert excerpt["quote_hash"] == "b" * 64
    assert str(excerpt["target"]) == f"v1_evidence:{sha256(b'excerpt1').hexdigest()}"
    assert metadata == before
