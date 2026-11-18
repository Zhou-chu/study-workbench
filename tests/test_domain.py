"""Retained domain filesystem/lock and podcast collaboration contracts."""

import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.domain.notebook import (
    Asset,
    Notebook,
    Source,
)

# ============================================================================
# TEST SUITE 1: RecordModel Singleton Pattern
# ============================================================================


# ============================================================================
# TEST SUITE 2: ModelManager Instance Isolation
# ============================================================================


# ============================================================================
# TEST SUITE 3: Notebook Domain Logic
# ============================================================================


class TestNotebookDomain:
    """Test suite for Notebook validation and business rules."""

    @pytest.mark.asyncio
    async def test_notebook_delete_cascades_chat_sessions(self):
        """Deleting a notebook must also delete its chat sessions (issue #1124)."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")

        chat_session_one = SimpleNamespace(delete=AsyncMock(return_value=True))
        chat_session_two = SimpleNamespace(delete=AsyncMock(return_value=True))

        async def fake_get_notes(self, include_content=False):
            return []

        async def fake_get_chat_sessions(self):
            return [chat_session_one, chat_session_two]

        with (
            patch.object(Notebook, "get_notes", new=fake_get_notes),
            patch(
                "open_notebook.database.note_repository.repo_query",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "open_notebook.database.note_repository.delete_notebook_notes_locked",
                new=AsyncMock(return_value=0),
            ),
            patch.object(Notebook, "get_chat_sessions", new=fake_get_chat_sessions),
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "open_notebook.domain.base.repo_delete",
                new=AsyncMock(return_value=True),
            ),
        ):
            result = await notebook.delete()

        chat_session_one.delete.assert_awaited_once()
        chat_session_two.delete.assert_awaited_once()
        assert result["deleted_chat_sessions"] == 2


# ============================================================================
# TEST SUITE 4: Source Domain
# ============================================================================


class TestSourceDomain:
    """Test suite for Source domain model."""

    @pytest.mark.asyncio
    async def test_source_delete_cleans_up_file(self):
        """Test that deleting a source removes the associated file."""
        # Create a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as tmp_file:
            tmp_file.write(b"Test content")
            tmp_path = Path(tmp_file.name)

        try:
            # Create source with file asset
            source = Source(
                id="source:test_delete",
                title="Test Source",
                asset=Asset(file_path=str(tmp_path)),
            )

            # Verify file exists
            assert tmp_path.exists()

            # Mock the parent delete method to avoid database operations
            with (
                patch.object(
                    Source.__bases__[0], "delete", new_callable=AsyncMock
                ) as mock_delete,
                patch(
                    "open_notebook.domain.notebook.repo_query",
                    new=AsyncMock(return_value=[]),
                ),
            ):
                mock_delete.return_value = True

                # Delete the source
                result = await source.delete()

                # Verify parent delete was called
                mock_delete.assert_called_once()
                assert result is True

            # Verify file was deleted
            assert not tmp_path.exists()

        finally:
            # Cleanup in case test fails
            if tmp_path.exists():
                tmp_path.unlink()

    @pytest.mark.asyncio
    async def test_source_delete_without_file(self):
        """Test that deleting a source without a file doesn't fail."""
        # Create source without file asset
        source = Source(id="source:test_no_file", title="Test Source", asset=None)

        # Mock the parent delete method
        with (
            patch.object(
                Source.__bases__[0], "delete", new_callable=AsyncMock
            ) as mock_delete,
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(return_value=[]),
            ),
        ):
            mock_delete.return_value = True

            # Delete should complete without error
            result = await source.delete()
            assert result is True
            mock_delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_source_delete_continues_on_file_error(self):
        """Test that source deletion continues even if file deletion fails."""
        # Create source with non-existent file
        source = Source(
            id="source:test_missing_file",
            title="Test Source",
            asset=Asset(file_path="/nonexistent/path/file.txt"),
        )

        # Mock the parent delete method
        with (
            patch.object(
                Source.__bases__[0], "delete", new_callable=AsyncMock
            ) as mock_delete,
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(return_value=[]),
            ),
        ):
            mock_delete.return_value = True

            # Delete should complete even though file doesn't exist
            result = await source.delete()
            assert result is True
            mock_delete.assert_called_once()


# ============================================================================
# TEST SUITE 5: Note Domain
# ============================================================================


# ============================================================================
# TEST SUITE 6: Podcast Domain Validation
# ============================================================================


# ============================================================================
# TEST SUITE 7: Transformation Domain
# ============================================================================


# ============================================================================
# TEST SUITE 8: Content Settings
# ============================================================================


# ============================================================================
# TEST SUITE 9: Episode Profile Validation
# ============================================================================


# ============================================================================
# TEST SUITE: Credential flexible config bag (#875)
# ============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
