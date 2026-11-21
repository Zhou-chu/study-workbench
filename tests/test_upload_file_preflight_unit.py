"""Upload-support verdict mapping with the file checker replaced."""

from unittest.mock import AsyncMock, patch

import pytest


class TestPreflightFileSupport:
    """The upload flow rejects unsupported files at ingestion via content-core's
    check_file_support(), so they never enqueue a doomed background job (#975)."""

    @pytest.mark.asyncio
    async def test_unsupported_verdict_raises(self):
        from content_core import FileSupport

        from api.routers.sources import _assert_file_supported
        from open_notebook.exceptions import UnsupportedTypeException

        verdict = FileSupport(
            supported=False,
            file_path="/uploads/archive.zip",
            identified_type="application/zip",
            reason="Unsupported file type: application/zip",
        )
        with patch(
            "api.routers.sources.check_file_support",
            new=AsyncMock(return_value=verdict),
        ):
            with pytest.raises(UnsupportedTypeException) as exc:
                await _assert_file_supported("/uploads/archive.zip")

        # message carries both the reason and the detected type for the UI
        assert "application/zip" in str(exc.value)

    @pytest.mark.asyncio
    async def test_supported_verdict_passes(self):
        from content_core import FileSupport

        from api.routers.sources import _assert_file_supported

        verdict = FileSupport(
            supported=True,
            file_path="/uploads/doc.pdf",
            identified_type="application/pdf",
            processor="pdf",
        )
        with patch(
            "api.routers.sources.check_file_support",
            new=AsyncMock(return_value=verdict),
        ):
            # must not raise
            await _assert_file_supported("/uploads/doc.pdf")

    @pytest.mark.asyncio
    async def test_check_errors_are_swallowed(self):
        """A missing file on retry (or any check error) must not become a hard
        415 — extraction downstream will surface the real problem."""
        from api.routers.sources import _assert_file_supported

        with patch(
            "api.routers.sources.check_file_support",
            new=AsyncMock(side_effect=FileNotFoundError("gone")),
        ):
            # must not raise
            await _assert_file_supported("/uploads/missing.pdf")
