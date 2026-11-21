"""Notebook inclusion decisions with domain retrieval/context IO replaced.

These do not validate generation, actual source reading, or unreadable-source UX.
"""

import asyncio
from dataclasses import dataclass
from unittest.mock import AsyncMock, Mock

import pytest

from open_notebook.domain.notebook import Note, Notebook, Source, SourceInsight
from open_notebook.utils import context_builder as target

pytestmark = pytest.mark.asyncio


@dataclass
class SourceStub:
    id: str | None
    get_context: AsyncMock


@dataclass
class NoteStub:
    id: str
    get_context: Mock


@dataclass
class Boundaries:
    notebook: Notebook
    sources: AsyncMock
    notes: AsyncMock
    source_get: AsyncMock
    note_get: AsyncMock
    insights: AsyncMock


@pytest.fixture
def io(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    b = Boundaries(
        notebook=Notebook(id="notebook:fixture", name="Research", description=""),
        sources=AsyncMock(return_value=[]),
        notes=AsyncMock(return_value=[]),
        source_get=AsyncMock(),
        note_get=AsyncMock(),
        insights=AsyncMock(return_value={}),
    )
    for owner, name, value in (
        (Notebook, "get_sources", b.sources),
        (Notebook, "get_notes", b.notes),
        (Source, "get", b.source_get),
        (Note, "get", b.note_get),
        (SourceInsight, "get_for_sources", b.insights),
    ):
        monkeypatch.setattr(owner, name, value)
    return b


async def test_explicit_scope_keeps_all_selected_contents_and_excludes_distractor(
    io: Boundaries,
) -> None:
    payloads = {
        "source:cpu": {"id": "source:cpu", "full_text": "控制器"},
        "source:memory": {"id": "source:memory", "full_text": "存储层次"},
        "source:bus": {"id": "source:bus", "full_text": "开头\n文件末尾：总线仲裁"},
    }
    records = {
        key: SourceStub(key, AsyncMock(return_value=value))
        for key, value in payloads.items()
    }
    io.source_get.side_effect = lambda key: records[key]
    config = {
        "sources": {
            "cpu": "full content",
            "source:memory": "full content",
            "bus": "full content",
            "distractor": "not in context",
        }
    }
    data, rendered = await target.build_notebook_context(io.notebook, config)
    assert data == {"sources": list(payloads.values()), "notes": []}
    assert rendered == "".join(str(p) for p in payloads.values())
    assert "文件末尾：总线仲裁" in rendered
    assert [c.args[0] for c in io.source_get.await_args_list] == list(payloads)
    io.sources.assert_not_awaited()
    io.notes.assert_not_awaited()
    io.insights.assert_not_awaited()
    for record in records.values():
        record.get_context.assert_awaited_once_with(context_size="long")
    assert config["sources"]["distractor"] == "not in context"


@pytest.mark.parametrize(
    ("status", "size"),
    [("insights", "short"), ("full content", "long")],
)
async def test_source_inclusion_mode_is_forwarded_without_rewriting_payload(
    io: Boundaries, status: str, size: str
) -> None:
    payload = {"id": "source:chosen", "title": "保留来源", "insights": ["概念"]}
    record = SourceStub("source:chosen", AsyncMock(return_value=payload))
    io.source_get.return_value = record
    data, rendered = await target.build_notebook_context(
        io.notebook, {"sources": {"chosen": status}}
    )
    assert data["sources"] == [payload]
    assert rendered == str(payload)
    record.get_context.assert_awaited_once_with(context_size=size)


async def test_explicit_empty_selection_does_not_fall_back_to_all_records(
    io: Boundaries,
) -> None:
    data, rendered = await target.build_notebook_context(
        io.notebook, {"sources": {}, "notes": {}}
    )
    assert data == {"sources": [], "notes": []}
    assert rendered == ""
    io.sources.assert_not_awaited()
    io.notes.assert_not_awaited()
    io.source_get.assert_not_awaited()
    io.note_get.assert_not_awaited()


async def test_selected_notes_keep_long_context_and_omitted_notes_are_not_read(
    io: Boundaries,
) -> None:
    payload = {"id": "note:chosen", "content": "保存的成果"}
    record = NoteStub("note:chosen", Mock(return_value=payload))
    io.note_get.return_value = record
    data, rendered = await target.build_notebook_context(
        io.notebook,
        {"notes": {"note:chosen": "full content", "other": "not in context"}},
    )
    assert data == {"sources": [], "notes": [payload]}
    assert rendered == str(payload)
    io.note_get.assert_awaited_once_with("note:chosen")
    record.get_context.assert_called_once_with(context_size="long")


@pytest.mark.parametrize("config", [None, {}])
async def test_default_context_batches_insights_and_retains_source_then_note_order(
    io: Boundaries, config: dict | None
) -> None:
    source_a = {"id": "source:a", "insights": ["A"]}
    source_b = {"id": "source:b", "insights": []}
    note = {"id": "note:a", "content": "成果"}
    records = [
        SourceStub("source:a", AsyncMock(return_value=source_a)),
        SourceStub("source:b", AsyncMock(return_value=source_b)),
    ]
    note_record = NoteStub("note:a", Mock(return_value=note))
    io.sources.return_value = records
    io.notes.return_value = [note_record]
    io.insights.return_value = {"source:a": ["A"]}
    data, rendered = await target.build_notebook_context(io.notebook, config)
    assert data == {"sources": [source_a, source_b], "notes": [note]}
    assert rendered == str(source_a) + str(source_b) + str(note)
    io.insights.assert_awaited_once_with(["source:a", "source:b"])
    records[0].get_context.assert_awaited_once_with(
        context_size="short", insights=["A"]
    )
    records[1].get_context.assert_awaited_once_with(context_size="short", insights=[])
    note_record.get_context.assert_called_once_with(context_size="short")
    io.source_get.assert_not_awaited()
    io.note_get.assert_not_awaited()


async def test_insight_store_unavailable_does_not_discard_readable_source_context(
    io: Boundaries,
) -> None:
    payload = {"id": "source:a", "title": "Readable"}
    record = SourceStub("source:a", AsyncMock(return_value=payload))
    io.sources.return_value = [record]
    io.insights.side_effect = OSError("fixture unavailable")
    data, rendered = await target.build_notebook_context(io.notebook, None)
    assert data["sources"] == [payload]
    assert rendered == str(payload)
    record.get_context.assert_awaited_once_with(context_size="short", insights=[])


@pytest.mark.parametrize("boundary", ["sources", "notes", "insights"])
async def test_default_context_cancellation_is_not_silently_converted_to_empty(
    io: Boundaries, boundary: str
) -> None:
    cancellation = asyncio.CancelledError("fixture cancellation")
    getattr(io, boundary).side_effect = cancellation
    with pytest.raises(asyncio.CancelledError) as raised:
        await target.build_notebook_context(io.notebook, None)
    assert raised.value is cancellation


@pytest.mark.parametrize("kind", ["sources", "notes"])
@pytest.mark.parametrize("stage", ["get", "context"])
async def test_explicit_selection_cancellation_preserves_caller_control(
    io: Boundaries, kind: str, stage: str
) -> None:
    cancellation = asyncio.CancelledError("fixture cancellation")
    getter = io.source_get if kind == "sources" else io.note_get
    if stage == "get":
        getter.side_effect = cancellation
    elif kind == "sources":
        getter.return_value = SourceStub(
            "source:a", AsyncMock(side_effect=cancellation)
        )
    else:
        getter.return_value = NoteStub("note:a", Mock(side_effect=cancellation))
    with pytest.raises(asyncio.CancelledError) as raised:
        await target.build_notebook_context(io.notebook, {kind: {"a": "full content"}})
    assert raised.value is cancellation
