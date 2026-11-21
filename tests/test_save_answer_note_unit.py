"""Save-answer decisions; repository and embedding I/O are the only write doubles."""

import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.personal_service import PersonalService
from open_notebook import config
from open_notebook.database import note_repository
from open_notebook.domain.notebook import Note
from open_notebook.exceptions import InvalidInputError


@pytest.fixture
def saving(monkeypatch: pytest.MonkeyPatch):
    result = note_repository.NoteWriteResult(
        native={"id": "note:synthetic", "content": "saved answer", "revision": 3},
        snapshot={"note_id": "note:synthetic", "revision": 3},
    )
    events: list[str] = []

    async def persist(**kwargs):
        events.append("persist")
        return result

    async def embedded():
        events.append("embed")

    create = AsyncMock(side_effect=persist)
    update = AsyncMock(side_effect=persist)
    embed = AsyncMock(side_effect=embedded)
    monkeypatch.setattr(note_repository, "create_note", create)
    monkeypatch.setattr(note_repository, "update_note", update)
    monkeypatch.setattr(Note, "submit_embedding", embed)
    monkeypatch.setattr(config, "get_note_write_mode", lambda: "canonical")
    store = SimpleNamespace(get=AsyncMock(return_value={"notebook_id": "nb_one"}))
    return SimpleNamespace(
        service=PersonalService(store),
        store=store,
        create=create,
        update=update,
        embed=embed,
        result=result,
        events=events,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [None, "", " \t\n"])
async def test_empty_answer_is_rejected_before_reads_or_writes(saving, content):
    with pytest.raises(InvalidInputError, match="EMPTY_NOTE"):
        await saving.service.save_note("nb_one", {"content": content})
    saving.store.get.assert_not_awaited()
    saving.create.assert_not_awaited()
    saving.update.assert_not_awaited()
    saving.embed.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [None, {}, {"notebook_id": "nb_other"}])
async def test_answer_scope_must_belong_to_target_notebook(saving, version):
    saving.store.get.return_value = version
    with pytest.raises(InvalidInputError, match="OUT_OF_SCOPE"):
        await saving.service.save_note(
            "nb_one",
            {"content": "answer", "scope_snapshot": {"source_version_ids": ["sv_one"]}},
        )
    saving.store.get.assert_awaited_once_with("version", "sv_one")
    saving.create.assert_not_awaited()
    saving.update.assert_not_awaited()
    saving.embed.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "title,expected", [(None, "Study note"), ("", "Study note"), ("a" * 501, "a" * 500)]
)
async def test_create_normalizes_title_preserves_answer_and_scope_before_embedding(
    saving, title, expected
):
    scope = {"source_version_ids": ["sv_one"], "selection_origin": "explicit"}
    request = {"title": title, "content": "  answer\n", "scope_snapshot": scope}
    before = copy.deepcopy(request)
    result = await saving.service.save_note("nb_one", request)
    saving.create.assert_awaited_once_with(
        fields={"title": expected, "content": "  answer\n"},
        notebook_id="nb_one",
        snapshot={"citations": [], "scope_snapshot": scope},
    )
    saving.update.assert_not_awaited()
    saving.embed.assert_awaited_once_with()
    assert result is saving.result.snapshot
    assert saving.events == ["persist", "embed"]
    assert request == before


@pytest.mark.asyncio
@pytest.mark.parametrize("revision", [None, 7])
async def test_update_preserves_revision_and_write_mode_without_creating(
    saving, revision
):
    request = {"title": "Revised", "content": "answer", "expected_revision": revision}
    assert (
        await saving.service.save_note("nb_one", request, "note:existing")
        is saving.result.snapshot
    )
    saving.update.assert_awaited_once_with(
        note_id="note:existing",
        notebook_id="nb_one",
        fields={"title": "Revised", "content": "answer"},
        snapshot={"citations": [], "scope_snapshot": {}},
        expected_revision=revision,
        mode="canonical",
    )
    saving.create.assert_not_awaited()
    assert saving.events == ["persist", "embed"]


@pytest.mark.asyncio
async def test_unmapped_remote_citation_cannot_claim_local_identity_or_verification(
    saving,
):
    citation = {
        "citation_id": "c1",
        "kind": "remote_unmapped",
        "source_title": "Remote",
        "quote": "quote",
        "remote_reference": {"url": "https://example.test/source"},
        "reference_validity": "verified",
        "source_version_id": "sv_forged",
        "locator": {"page_index": 5},
        "extra": "discard",
    }
    before = copy.deepcopy(citation)
    await saving.service.save_note(
        "nb_one", {"content": "answer", "citations": [citation]}
    )
    saved = saving.create.await_args.kwargs["snapshot"]["citations"]
    assert saved == [
        {
            "citation_id": "c1",
            "kind": "remote_unmapped",
            "source_title": "Remote",
            "quote": "quote",
            "remote_reference": {"url": "https://example.test/source"},
            "evidence_id": None,
            "source_version_id": None,
            "locator": None,
            "reference_validity": "unverified",
        }
    ]
    assert citation == before
    saving.store.get.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("editing", [False, True])
@pytest.mark.parametrize("cancelled", [False, True])
async def test_persistence_failure_never_attempts_embedding_or_alternate_write(
    saving, editing, cancelled
):
    error = (
        asyncio.CancelledError()
        if cancelled
        else RuntimeError("synthetic persistence failure")
    )
    target = saving.update if editing else saving.create
    target.side_effect = error
    with pytest.raises(type(error)) as caught:
        await saving.service.save_note(
            "nb_one", {"content": "answer"}, "note:existing" if editing else None
        )
    assert caught.value is error
    target.assert_awaited_once()
    (saving.create if editing else saving.update).assert_not_awaited()
    saving.embed.assert_not_awaited()


@pytest.mark.asyncio
async def test_embedding_failure_after_save_does_not_replay_persistence(saving):
    error = RuntimeError("synthetic embedding failure")
    saving.embed.side_effect = error
    with pytest.raises(RuntimeError) as caught:
        await saving.service.save_note("nb_one", {"content": "answer"})
    assert caught.value is error
    saving.create.assert_awaited_once()
    saving.update.assert_not_awaited()
    saving.embed.assert_awaited_once()
    assert saving.events == ["persist"]
