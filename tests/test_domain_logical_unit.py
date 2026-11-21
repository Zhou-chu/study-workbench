"""Logical domain validation, context projection and vector dispatch units."""

from unittest.mock import patch

import pytest

from open_notebook.domain.notebook import (
    Note,
    Notebook,
    Source,
    SourceInsight,
)
from open_notebook.exceptions import InvalidInputError


class TestNotebookDomain:
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


class TestSourceDomain:
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
