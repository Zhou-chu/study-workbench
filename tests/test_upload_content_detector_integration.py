"""Content identification integration using an owned temporary file."""

import pytest


class TestContentCoreRejectsUnrecognizedContent:
    @pytest.mark.asyncio
    async def test_file_detector_raises_for_unrecognized_content(self, tmp_path):
        from content_core.common.exceptions import UnsupportedTypeException
        from content_core.content.identification.file_detector import FileDetector

        garbage = tmp_path / "garbage.bin"
        garbage.write_bytes(
            bytes(range(256)) * 4
        )  # not any recognized signature/text pattern

        detector = FileDetector()
        with pytest.raises(UnsupportedTypeException):
            await detector.detect(str(garbage))
