"""ASGI source download path containment behavior."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.domain.notebook import Asset, Source


def make_source(file_path=None, **overrides):
    defaults = dict(
        id="source:test123",
        title="Test Source",
        asset=Asset(file_path=file_path) if file_path else None,
    )
    defaults.update(overrides)
    return Source(**defaults)


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestDownloadEndpointRejectsSiblingDirectoryBypass:
    """End-to-end through the actual HTTP endpoint."""

    def test_download_returns_403_for_sibling_directory_file(
        self, client, tmp_path, monkeypatch
    ):
        real_root = tmp_path / "uploads"
        real_root.mkdir()
        monkeypatch.setattr("api.routers.sources.UPLOADS_FOLDER", str(real_root))

        sibling = tmp_path / "uploads_evil"
        sibling.mkdir()
        evil_file = sibling / "secret.txt"
        evil_file.write_bytes(b"not yours")

        source = make_source(file_path=str(evil_file))
        with patch(
            "api.routers.sources.Source.get", new=AsyncMock(return_value=source)
        ):
            response = client.get("/api/sources/source:test123/download")

        assert response.status_code == 403
