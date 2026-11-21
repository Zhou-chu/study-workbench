"""Controller source-file presence without a filesystem boundary."""

from unittest.mock import Mock

from api.routers import sources


def test_no_asset_returns_none(monkeypatch):
    filesystem = Mock(
        side_effect=AssertionError("source without an asset must not access files")
    )
    monkeypatch.setattr(sources, "os", filesystem)
    source = Mock(asset=None)

    assert sources._is_source_file_available(source) is None

    assert filesystem.mock_calls == []
