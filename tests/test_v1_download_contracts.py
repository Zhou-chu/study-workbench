"""Synthetic protected binary contracts through actual routers and file services.

Only persistence is in memory. No user files, providers, or runtime are accessed.
"""

import hashlib
from types import SimpleNamespace
from urllib.parse import quote

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from test_v1_evidence_ingest import MemoryStore

from api.auth import PasswordAuthMiddleware
from api.evidence_service import EvidenceService
from api.personal_security import PersonalSecurityMiddleware
from api.portable_service import PortableService
from api.routers import evidence, notebooklm, portable
from open_notebook.exceptions import InvalidInputError, NotFoundError

PASSWORD = "public-synthetic-download-test"
AUTH = {"Authorization": f"Bearer {PASSWORD}"}


@pytest_asyncio.fixture
async def downloads(tmp_path, monkeypatch):
    from api.main import invalid_input_error_handler, not_found_error_handler

    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", PASSWORD)
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "legacy_password")
    store = MemoryStore()
    originals = EvidenceService(store=store, data_root=tmp_path)
    exports = PortableService(store=store, data_root=tmp_path)
    monkeypatch.setattr(evidence, "EvidenceService", lambda: originals)
    monkeypatch.setattr(portable, "get_portable_service", lambda: exports)
    app = FastAPI()
    for router in (evidence.router, portable.router, notebooklm.router):
        app.include_router(router, prefix="/api")
    app.dependency_overrides[notebooklm.get_notebooklm_service] = (
        lambda: SimpleNamespace(store=store, data_root=tmp_path)
    )
    app.exception_handlers.update(
        {
            InvalidInputError: invalid_input_error_handler,
            NotFoundError: not_found_error_handler,
        }
    )
    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, store, originals, tmp_path


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "payload", "mime"),
    [
        ("original.txt", b"public synthetic\r\n\x00bytes", "text/plain"),
        ("original.md", "# 合成\n".encode(), "text/markdown"),
        ("original.pdf", b"%PDF-1.4\nsynthetic fixture\n%%EOF", "application/pdf"),
    ],
)
async def test_original_preserves_bytes_mime_and_inline_unicode_filename(
    downloads, filename, payload, mime
):
    client, _, service, _ = downloads
    title = "合成 original"
    version = await service.ingest(
        "notebook:synthetic", "source:synthetic", title, payload, filename=filename
    )
    url = f"/api/personal/source-versions/{version['source_version_id']}/download"
    response = await client.get(url, headers=AUTH)
    assert response.status_code == 200
    assert response.content == payload
    assert response.headers["content-type"] == mime + (
        "; charset=utf-8" if mime.startswith("text/") else ""
    )
    assert response.headers["content-disposition"] == (
        "inline; filename*=utf-8''" + quote(title)
    )
    assert response.headers["content-length"] == str(len(payload))
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["export", "artifact"])
async def test_protected_download_uses_real_integrity_checks_and_attachment(
    downloads, kind
):
    client, store, _, root = downloads
    payload = b"\x00\xffpublic synthetic binary\r\n"
    relative = f"{kind}s/synthetic.bin"
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    record = {
        "file_path": relative,
        "byte_size": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "mime_type": "audio/mpeg",
    }
    await store.put(kind, "synthetic", record)
    url = f"/api/personal/{kind}s/synthetic/download"
    denied = await client.get(url)
    assert denied.status_code == 401
    assert denied.json() == {"detail": "Missing authorization header"}
    assert denied.headers["www-authenticate"] == "Bearer"
    response = await client.get(url, headers=AUTH)
    assert response.status_code == 200
    assert response.content == payload
    assert response.headers["content-type"] == (
        "application/zip" if kind == "export" else "audio/mpeg"
    )
    assert response.headers["content-disposition"] == (
        'attachment; filename="study-workbench-project.zip"'
        if kind == "export"
        else 'attachment; filename="synthetic.bin"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    path.write_bytes(b"changed")
    corrupted = await client.get(url, headers=AUTH)
    assert corrupted.status_code == 400
    assert corrupted.json() == {
        "detail": "Export integrity verification failed"
        if kind == "export"
        else "Artifact integrity check failed"
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["export", "artifact"])
async def test_download_path_escape_rejected_before_reading(downloads, kind):
    client, store, _, _ = downloads
    await store.put(kind, "synthetic", {"file_path": "../outside"})
    response = await client.get(
        f"/api/personal/{kind}s/synthetic/download", headers=AUTH
    )
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
@pytest.mark.parametrize("segment", ["source-versions", "exports", "artifacts"])
async def test_missing_binary_returns_json_error_not_binary(downloads, segment):
    client, _, _, _ = downloads
    response = await client.get(
        f"/api/personal/{segment}/missing/download", headers=AUTH
    )
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert isinstance(response.json()["detail"], str)
    assert "content-disposition" not in response.headers


@pytest.mark.asyncio
async def test_existing_framework_range_wire_is_not_always_json_or_full_file(downloads):
    client, _, service, _ = downloads
    payload = b"0123456789abcdef"
    version = await service.ingest(
        "notebook:range", "source:range", "range.txt", payload, filename="range.txt"
    )
    url = f"/api/personal/source-versions/{version['source_version_id']}/download"
    single = await client.get(url, headers={**AUTH, "Range": "bytes=2-4"})
    assert single.status_code == 206
    assert single.content == b"234"
    assert single.headers["content-type"] == "text/plain; charset=utf-8"
    assert single.headers["content-range"] == "bytes 2-4/16"
    multiple = await client.get(url, headers={**AUTH, "Range": "bytes=0-1,6-7"})
    assert multiple.status_code == 206
    assert multiple.headers["content-type"].startswith(
        "multipart/byteranges; boundary="
    )
    boundary = multiple.headers["content-type"].split("boundary=", 1)[1]
    # Boundaries are randomized by the framework; ranges and bytes are not.
    assert f"--{boundary}".encode() in multiple.content
    assert b"Content-Range: bytes 0-1/16\r\n\r\n01\r\n" in multiple.content
    assert b"Content-Range: bytes 6-7/16\r\n\r\n67\r\n" in multiple.content
    malformed = await client.get(url, headers={**AUTH, "Range": "not-a-range"})
    assert malformed.status_code == 400
    assert malformed.headers["content-type"] == "text/plain; charset=utf-8"
    assert malformed.text == "Malformed range header."
    unsatisfiable = await client.get(url, headers={**AUTH, "Range": "bytes=100-200"})
    assert unsatisfiable.status_code == 416
    assert unsatisfiable.headers["content-range"] == "bytes */16"
    assert unsatisfiable.headers["content-type"] == "text/plain; charset=utf-8"
    assert unsatisfiable.content == b""
    for response in (single, multiple, malformed, unsatisfiable):
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
