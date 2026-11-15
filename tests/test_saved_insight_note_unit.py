"""Saved-insight and note decisions with persistence and enqueue replaced."""

import asyncio
from dataclasses import dataclass
from typing import Literal
from unittest.mock import AsyncMock

import pytest

from open_notebook.database import note_repository
from open_notebook.domain import notebook as domain
from open_notebook.exceptions import (
    CommandSubmissionUnknownError,
    DatabaseOperationError,
    InvalidInputError,
)


@dataclass
class Boundaries:
    query: AsyncMock
    create: AsyncMock
    update: AsyncMock
    submit: AsyncMock
    attach: AsyncMock
    delete: AsyncMock


@pytest.fixture
def io(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    doubles = Boundaries(
        query=AsyncMock(return_value=[]),
        create=AsyncMock(),
        update=AsyncMock(),
        submit=AsyncMock(return_value="command:queued"),
        attach=AsyncMock(return_value={"linked": True}),
        delete=AsyncMock(),
    )
    monkeypatch.setattr(domain, "repo_query", doubles.query)
    monkeypatch.setattr(domain, "submit_command", doubles.submit)
    for name, double in (
        ("create_note", doubles.create),
        ("update_note", doubles.update),
        ("add_to_notebook", doubles.attach),
        ("delete_note", doubles.delete),
    ):
        monkeypatch.setattr(note_repository, name, double)
    return doubles


@pytest.fixture
def insight() -> domain.SourceInsight:
    return domain.SourceInsight(
        id="source_insight:sample", insight_type="摘要", content=" 保留完整正文。 "
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("notebook_id", [None, "notebook:sample"])
async def test_save_insight_persists_a_note_and_uses_its_returned_id_for_embedding(
    io: Boundaries, insight: domain.SourceInsight, notebook_id: str | None
) -> None:
    io.query.return_value = [{"source": {"id": "source:sample", "title": "体系结构"}}]
    fields = {"title": "摘要 from source 体系结构", "content": " 保留完整正文。 "}

    async def persist(*, fields: dict, notebook_id: str | None):
        io.submit.assert_not_awaited()
        return note_repository.NoteWriteResult(
            native={"id": "note:saved", "revision": 1, **fields}, snapshot=None
        )

    io.create.side_effect = persist
    result = await insight.save_as_note(notebook_id)

    assert isinstance(result, domain.Note)
    assert (result.id, result.revision, result.title, result.content) == (
        "note:saved",
        1,
        "摘要 from source 体系结构",
        " 保留完整正文。 ",
    )
    io.create.assert_awaited_once_with(fields=fields, notebook_id=notebook_id)
    assert io.query.await_args is not None
    assert str(io.query.await_args.args[1]["id"]) == "source_insight:sample"
    io.submit.assert_awaited_once_with(
        "open_notebook", "embed_note", {"note_id": "note:saved"}
    )
    io.update.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("returned_rows", [[], [{"source": None}]])
async def test_unavailable_source_does_not_save_a_dangling_insight(
    io: Boundaries, insight: domain.SourceInsight, returned_rows: list[dict]
) -> None:
    io.query.return_value = returned_rows
    with pytest.raises(DatabaseOperationError):
        await insight.save_as_note("notebook:sample")
    io.create.assert_not_awaited()
    io.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["source-read", "note-write"])
async def test_cancelled_insight_save_preserves_cancellation_without_enqueuing(
    io: Boundaries, insight: domain.SourceInsight, boundary: str
) -> None:
    cancelled = asyncio.CancelledError()
    if boundary == "source-read":
        io.query.side_effect = cancelled
    else:
        io.query.return_value = [{"source": {"title": "体系结构"}}]
        io.create.side_effect = cancelled

    with pytest.raises(asyncio.CancelledError) as caught:
        await insight.save_as_note("notebook:sample")

    assert caught.value is cancelled
    assert io.create.await_count == int(boundary == "note-write")
    io.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("revision", [None, 3])
async def test_edit_note_uses_explicit_or_loaded_revision_and_refreshes_saved_fields(
    io: Boundaries, revision: int | None
) -> None:
    note = domain.Note(
        id="note:sample", title="Previous", content="Saved text", revision=2
    )
    io.update.return_value = note_repository.NoteWriteResult(
        native={
            "id": "note:sample",
            "title": "New",
            "content": "Saved text",
            "revision": 4,
        },
        snapshot=None,
    )

    result = await note.save(
        fields={"title": "New", "embedding": [1], "id": "note:other"},
        expected_revision=revision,
    )

    assert (note.id, note.revision, note.title, note.content) == (
        "note:sample",
        4,
        "New",
        "Saved text",
    )
    assert result == "command:queued"
    io.update.assert_awaited_once_with(
        note_id="note:sample",
        fields={"title": "New"},
        expected_revision=2 if revision is None else 3,
    )
    io.create.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["explicit", "assigned"])
async def test_blank_edit_is_rejected_before_writing(
    io: Boundaries, route: str
) -> None:
    note = domain.Note(id="note:sample", content="Saved text")
    fields = {"content": " \t "}
    if route == "assigned":
        note.content = " \t "
        fields = {}

    with pytest.raises(InvalidInputError):
        await note.save(fields=fields)

    io.update.assert_not_awaited()
    io.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("strict", "failure"),
    [
        (False, "unknown"),
        (True, "unknown"),
        (False, "definite"),
        (True, "definite"),
    ],
)
async def test_embedding_uncertainty_keeps_job_and_note_identity_without_replay(
    io: Boundaries, strict: bool, failure: str
) -> None:
    note = domain.Note(id="note:sample", content="Saved text")
    unknown = CommandSubmissionUnknownError(command_id="command:uncertain")
    io.submit.side_effect = (
        unknown if failure == "unknown" else RuntimeError("Not queued")
    )

    if strict and failure == "unknown":
        with pytest.raises(CommandSubmissionUnknownError) as caught:
            await note.submit_embedding(strict=True)
        assert caught.value is unknown
        assert (unknown.resource_type, unknown.resource_id, unknown.command_id) == (
            "note",
            "note:sample",
            "command:uncertain",
        )
    else:
        assert await note.submit_embedding(strict=strict) is None

    io.submit.assert_awaited_once_with(
        "open_notebook", "embed_note", {"note_id": "note:sample"}
    )
    io.update.assert_not_awaited()
    io.create.assert_not_awaited()


@pytest.mark.asyncio
async def test_automatic_embedding_failure_keeps_confirmed_saved_note(
    io: Boundaries,
) -> None:
    note = domain.Note(title="Draft", content="Saved text")
    io.create.return_value = note_repository.NoteWriteResult(
        native={"id": "note:stored", "title": "Draft", "content": "Saved text"},
        snapshot=None,
    )
    io.submit.side_effect = RuntimeError("Queue unavailable")

    assert await note.save(notebook_id="notebook:sample") is None
    assert (note.id, note.content) == ("note:stored", "Saved text")
    io.create.assert_awaited_once()
    io.submit.assert_awaited_once_with(
        "open_notebook", "embed_note", {"note_id": "note:stored"}
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("note_id", "content"), [(None, "Unsaved text"), ("note:sample", None)]
)
async def test_no_enqueue_without_saved_content(
    io: Boundaries, note_id: str | None, content: str | None
) -> None:
    note = domain.Note(id=note_id, content=content)
    assert await note.submit_embedding(strict=True) is None
    io.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("note_id", "notebook_id"), [(None, "notebook:sample"), ("note:sample", "")]
)
async def test_linking_requires_both_ids(
    io: Boundaries, note_id: str | None, notebook_id: str
) -> None:
    with pytest.raises(InvalidInputError):
        await domain.Note(id=note_id).add_to_notebook(notebook_id)
    io.attach.assert_not_awaited()


@pytest.mark.asyncio
async def test_linking_targets_the_exact_note_and_notebook(io: Boundaries) -> None:
    result = await domain.Note(id="note:sample").add_to_notebook("notebook:target")
    assert result == {"linked": True}
    io.attach.assert_awaited_once_with("note:sample", "notebook:target")


@pytest.mark.asyncio
async def test_unsaved_note_never_reaches_delete_repository(io: Boundaries) -> None:
    with pytest.raises(InvalidInputError):
        await domain.Note().delete()
    io.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_targets_the_persisted_note(io: Boundaries) -> None:
    await domain.Note(id="note:sample").delete()
    io.delete.assert_awaited_once_with("note:sample")


@pytest.mark.parametrize("context_size", ["short", "long"])
def test_note_context_retains_identifiers_and_bounds_excerpt(
    context_size: Literal["short", "long"],
) -> None:
    note = domain.Note(id="note:sample", title="结果", content="字" * 100 + "结语")
    result = note.get_context(context_size=context_size)
    assert result == {
        "id": "note:sample",
        "title": "结果",
        "content": "字" * 100 + ("结语" if context_size == "long" else ""),
    }


@pytest.mark.asyncio
async def test_notebook_context_includes_full_saved_note_and_omits_empty_entries(
    io: Boundaries,
) -> None:
    io.query.side_effect = [
        [
            {
                "source": {
                    "id": "source:sample",
                    "title": "阅读资料",
                    "full_text": "来源全文",
                }
            }
        ],
        [
            {
                "note": {
                    "id": "note:sample",
                    "title": "保存结果",
                    "content": "字" * 100 + "结语",
                }
            },
            {"note": {"id": "note:empty", "title": "Empty"}},
        ],
        [
            {
                "id": "source_insight:sample",
                "source": "source:sample",
                "insight_type": "摘要",
                "content": "重点",
            },
        ],
    ]
    notebook = domain.Notebook(id="notebook:sample", name="Sample", description="")

    result = await notebook.get_context()

    assert result == (
        "## Source: 阅读资料\n\n来源全文\n\nInsights:\n- 摘要: 重点\n\n"
        "## Note: 保存结果\n\n" + "字" * 100 + "结语"
    )
    reads = io.query.await_args_list
    assert len(reads) == 3
    assert "omit source.full_text" not in reads[0].args[0]
    assert "omit note.content" not in reads[1].args[0]
    assert "omit note.embedding" in reads[1].args[0]
    assert [str(rid) for rid in reads[2].args[1]["source_ids"]] == ["source:sample"]
