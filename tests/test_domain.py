"""
Unit tests for the open_notebook.domain module.

This test suite focuses on validation logic, business rules, and data structures
that can be tested without database mocking.
"""

import sys
import tempfile
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.podcast_service import PodcastService
from open_notebook.domain.notebook import (
    Asset,
    Note,
    Notebook,
    Source,
    SourceInsight,
)
from open_notebook.exceptions import InvalidInputError
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile

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

    def test_notebook_name_validation(self):
        """Test empty/whitespace names are rejected."""
        # Empty name should raise error
        with pytest.raises(InvalidInputError, match="Notebook name cannot be empty"):
            Notebook(name="", description="Test")

        # Whitespace-only name should raise error
        with pytest.raises(InvalidInputError, match="Notebook name cannot be empty"):
            Notebook(name="   ", description="Test")

        # Valid name should work
        notebook = Notebook(name="Valid Name", description="Test")
        assert notebook.name == "Valid Name"

    def test_notebook_archived_flag(self):
        """Test archived flag defaults to False."""
        notebook = Notebook(name="Test", description="Test")
        assert notebook.archived is False

        notebook_archived = Notebook(name="Test", description="Test", archived=True)
        assert notebook_archived.archived is True

    @pytest.mark.asyncio
    async def test_notebook_get_context_includes_source_full_text(self):
        """Test notebook context includes full source content for podcasts."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")
        sources = [
            Source(
                id="source:first",
                title="First Source",
                full_text="First source full text for podcast generation.",
            ),
            Source(
                id="source:second",
                title="Second Source",
                full_text="Second source full text for podcast generation.",
            ),
        ]
        get_sources_calls = []

        async def fake_get_sources(self, include_full_text=False):
            get_sources_calls.append(include_full_text)
            return sources

        async def fake_get_notes(self, include_content=False):
            return []

        async def fake_get_for_sources(cls, source_ids):
            return {sid: [] for sid in source_ids}

        with (
            patch.object(Notebook, "get_sources", new=fake_get_sources),
            patch.object(Notebook, "get_notes", new=fake_get_notes),
            patch.object(
                SourceInsight, "get_for_sources", new=classmethod(fake_get_for_sources)
            ),
        ):
            context = await notebook.get_context()

        assert get_sources_calls == [True]
        assert "## Source: First Source" in context
        assert "First source full text for podcast generation." in context
        assert "## Source: Second Source" in context
        assert "Second source full text for podcast generation." in context
        assert "Notebook(id=" not in context

    @pytest.mark.asyncio
    async def test_notebook_get_context_includes_note_content(self):
        """Test notebook context includes linked note content."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")
        notes = [
            Note(
                id="note:first",
                title="Research Note",
                content="Important notebook note for the podcast.",
            )
        ]
        get_notes_calls = []

        async def fake_get_sources(self, include_full_text=False):
            return []

        async def fake_get_notes(self, include_content=False):
            get_notes_calls.append(include_content)
            return notes

        with (
            patch.object(Notebook, "get_sources", new=fake_get_sources),
            patch.object(Notebook, "get_notes", new=fake_get_notes),
        ):
            context = await notebook.get_context()

        assert get_notes_calls == [True]
        assert "## Note: Research Note" in context
        assert "Important notebook note for the podcast." in context

    @pytest.mark.asyncio
    async def test_notebook_get_context_returns_empty_string_without_content(self):
        """Test notebooks with no source or note content produce empty context."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")

        async def fake_get_sources(self, include_full_text=False):
            return []

        async def fake_get_notes(self, include_content=False):
            return []

        with (
            patch.object(Notebook, "get_sources", new=fake_get_sources),
            patch.object(Notebook, "get_notes", new=fake_get_notes),
        ):
            assert await notebook.get_context() == ""

    @pytest.mark.asyncio
    async def test_notebook_get_context_propagates_source_errors(self):
        """Test source context failures are not swallowed by notebook context."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")
        source = Source(id="source:first", title="First Source")

        async def fake_get_sources(self, include_full_text=False):
            return [source]

        async def fake_get_notes(self, include_content=False):
            return []

        async def fake_get_for_sources(cls, source_ids):
            return {sid: [] for sid in source_ids}

        async def fake_get_context(self, context_size="short", insights=None):
            raise RuntimeError("source context failed")

        with (
            patch.object(Notebook, "get_sources", new=fake_get_sources),
            patch.object(Notebook, "get_notes", new=fake_get_notes),
            patch.object(
                SourceInsight, "get_for_sources", new=classmethod(fake_get_for_sources)
            ),
            patch.object(Source, "get_context", new=fake_get_context),
        ):
            with pytest.raises(RuntimeError, match="source context failed"):
                await notebook.get_context()

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

    def test_source_command_field_parsing(self):
        """Test RecordID parsing for command field."""
        # Test with string command
        source = Source(title="Test", command="command:123")
        assert source.command is not None

        # Test with None command
        source2 = Source(title="Test", command=None)
        assert source2.command is None

        # Existing-source saves must not overwrite separately claimed ownership
        source3 = Source(id="source:123", title="Test", command="command:456")
        save_data = source3._prepare_save_data()
        assert "command" not in save_data
        assert "command" in source._prepare_save_data()

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

    @pytest.mark.asyncio
    async def test_vectorize_raises_valueerror_when_no_text(self):
        """Test that vectorize() raises ValueError (not DatabaseOperationError) for empty text."""
        source = Source(id="source:test_empty", title="Test", full_text=None)
        with pytest.raises(ValueError, match="has no text to vectorize"):
            await source.vectorize()

    @pytest.mark.asyncio
    async def test_vectorize_raises_valueerror_when_empty_string(self):
        """Test that vectorize() raises ValueError for empty string."""
        source = Source(id="source:test_empty_str", title="Test", full_text="")
        with pytest.raises(ValueError, match="has no text to vectorize"):
            await source.vectorize()

    @pytest.mark.asyncio
    async def test_vectorize_raises_valueerror_when_whitespace_only(self):
        """Test that vectorize() raises ValueError for whitespace-only text."""
        source = Source(id="source:test_ws", title="Test", full_text="   \n\t  ")
        with pytest.raises(ValueError, match="has no text to vectorize"):
            await source.vectorize()

    @pytest.mark.asyncio
    async def test_vectorize_submits_command_with_valid_text(self):
        """Test that vectorize() submits embed_source command when text is valid."""
        source = Source(id="source:test_valid", title="Test", full_text="Real content")
        with patch(
            "open_notebook.domain.notebook.submit_command", return_value="command:123"
        ) as mock_submit:
            result = await source.vectorize()
            mock_submit.assert_called_once_with(
                "open_notebook",
                "embed_source",
                {"source_id": "source:test_valid"},
            )
            assert result == "command:123"


# ============================================================================
# TEST SUITE 5: Note Domain
# ============================================================================




# ============================================================================
# TEST SUITE 6: Podcast Domain Validation
# ============================================================================




class TestPodcastService:
    """Test suite for podcast service notebook content resolution."""

    @pytest.mark.asyncio
    async def test_submit_generation_job_uses_notebook_context_content(self):
        """Test notebook podcast jobs submit real source content, not model repr."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")
        sources = [
            Source(
                id="source:first",
                title="First Source",
                full_text="First source full text for submitted podcast content.",
            ),
            Source(
                id="source:second",
                title="Second Source",
                full_text="Second source full text for submitted podcast content.",
            ),
        ]
        submitted_args = {}

        async def fake_get_sources(self, include_full_text=False):
            return sources

        async def fake_get_notes(self, include_content=False):
            return []

        async def fake_get_for_sources(cls, source_ids):
            return {sid: [] for sid in source_ids}

        async def fake_submit_command(app_name, command_name, command_args):
            submitted_args.update(command_args)
            return "command:podcast"

        fake_commands_module = ModuleType("commands.podcast_commands")
        # The real commands/__init__.py runs `from .podcast_commands import
        # generate_podcast_command` when the package is imported, so the fake
        # submodule must expose that name or the package import fails before the
        # patched submit_command is reached.
        # setattr: dynamic module attribute mypy can't know about
        setattr(fake_commands_module, "generate_podcast_command", lambda *a, **k: None)

        with (
            patch.object(
                EpisodeProfile, "get_by_name", new=AsyncMock(return_value=object())
            ),
            patch.object(
                SpeakerProfile,
                "get_by_name",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        id="speaker_profile:speakers", name="Speakers"
                    )
                ),
            ),
            patch.object(Notebook, "get", new=AsyncMock(return_value=notebook)),
            patch.object(Notebook, "get_sources", new=fake_get_sources),
            patch.object(Notebook, "get_notes", new=fake_get_notes),
            patch.object(
                SourceInsight, "get_for_sources", new=classmethod(fake_get_for_sources)
            ),
            patch("api.podcast_service.submit_command", new=fake_submit_command),
            patch.dict(
                sys.modules, {"commands.podcast_commands": fake_commands_module}
            ),
        ):
            job_id = await PodcastService.submit_generation_job(
                episode_profile_name="Episode",
                speaker_profile_name="Speakers",
                episode_name="Episode Name",
                notebook_id="notebook:test",
            )

        assert job_id == "command:podcast"
        content = submitted_args["content"]
        assert "First source full text for submitted podcast content." in content
        assert "Second source full text for submitted podcast content." in content
        assert "Notebook(id=" not in content


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
