"""Dispose upload fixtures with synthetic source and queue storage."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from api.models import SourceCreate
from api.routers import sources
from open_notebook.domain.notebook import Asset, Source


@pytest.fixture
def sync_creation(monkeypatch, tmp_path):
    path = tmp_path / "original.txt"
    original = "\ufeff🌞 原始资料。\r\n".encode()
    path.write_bytes(original)
    records = {}
    children = ["embedding:existing", "source_insight:existing"]
    saves = []

    async def save(source):
        source.id = "source:fixture"
        saves.append(source)
        records[source.id] = source.model_copy(deep=True)

    async def delete():
        records.clear()
        children.clear()

    processed = Source(
        id="source:fixture",
        title="Processed",
        full_text="retained extracted text",
        asset=Asset(file_path=str(path)),
    )
    delete_source = AsyncMock(side_effect=delete)
    cleanup = Mock(wraps=sources._cleanup_uploaded_file)
    associate = AsyncMock()
    get_source = AsyncMock(return_value=processed)
    chunks = AsyncMock(return_value=1)
    submit = AsyncMock()
    execute = Mock(return_value=SimpleNamespace(is_success=lambda: True))
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "delete", delete_source)
    monkeypatch.setattr(Source, "add_to_notebook", associate)
    monkeypatch.setattr(Source, "get", get_source)
    monkeypatch.setattr(Source, "get_embedded_chunks", chunks)
    monkeypatch.setattr(sources.Notebook, "get", AsyncMock(return_value=object()))
    monkeypatch.setattr(sources.Transformation, "get", AsyncMock(return_value=object()))
    monkeypatch.setattr(
        sources, "save_uploaded_file", AsyncMock(return_value=str(path))
    )
    monkeypatch.setattr(sources, "UPLOADS_FOLDER", str(tmp_path))
    monkeypatch.setattr(sources, "_assert_file_supported", AsyncMock())
    monkeypatch.setattr(sources, "_cleanup_uploaded_file", cleanup)
    monkeypatch.setattr(sources, "execute_command_sync", execute)
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    data = SourceCreate(
        type="upload", async_processing=False, notebooks=["notebook:fixture"]
    )
    return SimpleNamespace(
        path=path,
        original=original,
        records=records,
        children=children,
        saves=saves,
        processed=processed,
        delete=delete_source,
        cleanup=cleanup,
        associate=associate,
        get=get_source,
        chunks=chunks,
        submit=submit,
        execute=execute,
        data=data,
    )


def assert_retained(state):
    assert state.path.read_bytes() == state.original
    assert set(state.records) == {"source:fixture"}
    assert state.children == ["embedding:existing", "source_insight:existing"]
    assert len(state.saves) == 1
    state.delete.assert_not_awaited()
    state.cleanup.assert_not_called()
    state.submit.assert_not_awaited()
