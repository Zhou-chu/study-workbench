"""Direct source input policy with no ASGI, DNS, disk or command dispatch."""

import asyncio
from types import SimpleNamespace
from typing import TypedDict, Unpack
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException, UploadFile

from api.models import SourceCreate
from api.routers import sources as m
from open_notebook.exceptions import UnsupportedTypeException


class FormOverrides(TypedDict, total=False):
    type: str
    notebook_id: str | None
    notebooks: str | None
    url: str | None
    content: str | None
    title: str | None
    transformations: str | None
    embed: str
    delete_source: str
    async_processing: str
    file: UploadFile | None


def form(**changes: Unpack[FormOverrides]):
    args: FormOverrides = {
        "type": "text",
        "notebook_id": None,
        "notebooks": None,
        "url": None,
        "content": "body",
        "title": None,
        "transformations": None,
        "embed": "false",
        "delete_source": "false",
        "async_processing": "false",
        "file": None,
    }
    args.update(changes)
    return m.parse_source_form_data(**args)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("TRUE", True),
        ("1", True),
        ("yes", True),
        ("On", True),
        ("false", False),
        ("0", False),
        ("off", False),
        (" true ", False),
    ],
)
def test_form_boolean_conversion_is_explicit_and_consistent(value, expected):
    row, upload = form(embed=value, delete_source=value, async_processing=value)
    assert (row.embed, row.delete_source, row.async_processing) == (expected,) * 3
    assert upload is None and row.content == "body"


def test_form_preserves_upload_and_typed_fields_without_reading():
    upload = Mock(spec=UploadFile)
    row, returned = form(
        type="upload",
        notebooks='["notebook:a","notebook:b"]',
        transformations='["transformation:a"]',
        title="标题",
        file=upload,
    )
    assert returned is upload
    upload.read.assert_not_called()
    assert row.notebooks == ["notebook:a", "notebook:b"]
    assert row.transformations == ["transformation:a"]
    assert row.title == "标题" and row.file_path is None


def test_legacy_notebook_is_normalized_without_losing_original_field():
    row, _ = form(notebook_id="notebook:legacy")
    assert row.notebook_id == "notebook:legacy"
    assert row.notebooks == ["notebook:legacy"]


@pytest.mark.parametrize("field", ["notebooks", "transformations"])
def test_invalid_json_field_returns_specific_422(field):
    with pytest.raises(HTTPException) as caught:
        if field == "notebooks":
            form(notebooks="[malformed")
        else:
            assert field == "transformations"
            form(transformations="[malformed")
    assert caught.value.status_code == 422
    assert caught.value.detail == "Invalid JSON in " + field + " field"


@pytest.mark.parametrize(
    "changes",
    [
        {"notebooks": "{}"},
        {"transformations": "7"},
        {"notebooks": "[3]"},
        {"notebook_id": "legacy", "notebooks": "[]"},
    ],
)
def test_model_invalid_form_returns_validation_422(changes):
    with pytest.raises(HTTPException) as caught:
        form(**changes)
    assert caught.value.status_code == 422
    assert caught.value.detail.startswith("Invalid source data:")


@pytest.fixture
def boundaries(monkeypatch):
    url = AsyncMock()
    support = AsyncMock(return_value=SimpleNamespace(supported=True))
    monkeypatch.setattr(m, "validate_url", url)
    monkeypatch.setattr(m, "check_file_support", support)
    # Resolver result is an external filesystem observation, not a tested symlink guard.
    resolved: dict[str, str] = {}
    monkeypatch.setattr(m, "UPLOADS_FOLDER", "uploads-root")
    monkeypatch.setattr(
        m,
        "Path",
        lambda path: SimpleNamespace(resolve=lambda: resolved.get(path, path)),
    )
    resolved["uploads-root"] = "/isolated/uploads"
    return SimpleNamespace(url=url, support=support, resolved=resolved)


@pytest.mark.asyncio
async def test_link_keeps_exact_url_only_after_admission(boundaries):
    value = "https://example.invalid/document?x=1"
    row = SourceCreate(type="link", url=value, content="ignored")
    assert await m._build_content_state(row, None) == {"url": value}
    boundaries.url.assert_awaited_once_with(value, "source")
    boundaries.support.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        ValueError("blocked address"),
        RuntimeError("unavailable"),
        asyncio.CancelledError(),
    ],
)
async def test_url_admission_errors_do_not_produce_content_state(boundaries, error):
    boundaries.url.side_effect = error
    expected = HTTPException if isinstance(error, ValueError) else type(error)
    with pytest.raises(expected) as caught:
        await m._build_content_state(
            SourceCreate(type="link", url="https://example.invalid"), None
        )
    if isinstance(error, ValueError):
        assert (
            caught.value.status_code == 400 and caught.value.detail == "blocked address"
        )
    else:
        assert caught.value is error
    boundaries.support.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "row,detail",
    [
        (SourceCreate(type="link"), "URL is required for link type"),
        (SourceCreate(type="text", content=""), "Content is required for text type"),
        (
            SourceCreate(type="upload"),
            "File upload or file_path is required for upload type",
        ),
        (
            SourceCreate(type="other"),
            "Invalid source type. Must be link, upload, or text",
        ),
    ],
)
async def test_missing_type_specific_inputs_fail_before_io(boundaries, row, detail):
    with pytest.raises(HTTPException) as caught:
        await m._build_content_state(row, None)
    assert caught.value.status_code == 400 and caught.value.detail == detail
    boundaries.url.assert_not_awaited()
    boundaries.support.assert_not_awaited()


@pytest.mark.asyncio
async def test_text_preserves_content_without_any_remote_or_file_probe(boundaries):
    assert await m._build_content_state(
        SourceCreate(type="text", content="  正文\n"), None
    ) == {"content": "  正文\n"}
    boundaries.url.assert_not_awaited()
    boundaries.support.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "actual", ["/isolated/uploads", "/isolated/uploads-other/file", "/elsewhere/file"]
)
async def test_resolved_upload_must_be_descendant_before_header_probe(
    boundaries, actual
):
    boundaries.resolved["incoming"] = actual
    with pytest.raises(HTTPException) as caught:
        await m._build_content_state(SourceCreate(type="upload"), "incoming")
    assert caught.value.status_code == 400
    assert (
        caught.value.detail == "Invalid file path: must be within the uploads directory"
    )
    boundaries.support.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("uploaded", [None, "incoming"])
async def test_upload_path_precedence_and_delete_flag(boundaries, uploaded):
    boundaries.resolved.update(
        incoming="/isolated/uploads/new", legacy="/isolated/uploads/old"
    )
    row = SourceCreate(type="upload", file_path="legacy", delete_source=True)
    result = await m._build_content_state(row, uploaded)
    chosen = uploaded or "legacy"
    assert result == {"file_path": chosen, "delete_source": True}
    boundaries.support.assert_awaited_once_with(chosen)
    boundaries.url.assert_not_awaited()


@pytest.mark.asyncio
async def test_supported_path_still_rejects_known_unsupported_content(boundaries):
    boundaries.resolved["incoming"] = "/isolated/uploads/file"
    boundaries.support.return_value = SimpleNamespace(
        supported=False, reason="not extractable", identified_type="synthetic"
    )
    with pytest.raises(UnsupportedTypeException, match="not extractable.*synthetic"):
        await m._build_content_state(SourceCreate(type="upload"), "incoming")
    boundaries.support.assert_awaited_once_with("incoming")
