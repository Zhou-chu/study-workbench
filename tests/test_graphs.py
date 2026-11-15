"""
Unit tests for the open_notebook.graphs module.

This test suite focuses on testing graph structures, tools, and validation
without heavy mocking of the actual processing logic.
"""

from datetime import datetime
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from open_notebook.graphs.prompt import PatternChainState, graph
from open_notebook.graphs.tools import get_current_timestamp
from open_notebook.graphs.transformation import (
    graph as transformation_graph,
)

# ============================================================================
# TEST SUITE 1: Graph Tools
# ============================================================================


class TestGraphTools:
    """Test suite for graph tool definitions."""

    def test_get_current_timestamp_format(self):
        """Test timestamp tool returns correct format."""
        timestamp = get_current_timestamp.invoke({})

        assert isinstance(timestamp, str)
        assert len(timestamp) == 14  # YYYYMMDDHHmmss format
        assert timestamp.isdigit()

    def test_get_current_timestamp_validity(self):
        """Test timestamp represents valid datetime."""
        timestamp = get_current_timestamp.invoke({})

        # Parse it back to datetime to verify validity
        year = int(timestamp[0:4])
        month = int(timestamp[4:6])
        day = int(timestamp[6:8])
        hour = int(timestamp[8:10])
        minute = int(timestamp[10:12])
        second = int(timestamp[12:14])

        # Should be valid date components
        assert 2020 <= year <= 2100
        assert 1 <= month <= 12
        assert 1 <= day <= 31
        assert 0 <= hour <= 23
        assert 0 <= minute <= 59
        assert 0 <= second <= 59

        # Should parse as datetime
        dt = datetime.strptime(timestamp, "%Y%m%d%H%M%S")
        assert isinstance(dt, datetime)

    def test_get_current_timestamp_is_tool(self):
        """Test that function is properly decorated as a tool."""
        # Check it has tool attributes
        assert hasattr(get_current_timestamp, "name")
        assert hasattr(get_current_timestamp, "description")


# ============================================================================
# TEST SUITE 2: Prompt Graph State
# ============================================================================


class TestPromptGraph:
    """Test suite for prompt pattern chain graph."""

    def test_pattern_chain_state_structure(self):
        """Test PatternChainState structure and fields."""
        state = PatternChainState(
            prompt="Test prompt", parser=None, input_text="Test input", output=""
        )

        assert state["prompt"] == "Test prompt"
        assert state["parser"] is None
        assert state["input_text"] == "Test input"
        assert state["output"] == ""

    def test_prompt_graph_compilation(self):
        """Test that prompt graph compiles correctly."""
        assert graph is not None

        # Graph should have the expected structure
        assert hasattr(graph, "invoke")
        assert hasattr(graph, "ainvoke")


# ============================================================================
# TEST SUITE 3: Transformation Graph
# ============================================================================


class TestTransformationGraph:
    """Test suite for transformation graph workflows."""

    def test_transformation_graph_compilation(self):
        """Test that transformation graph compiles correctly."""
        assert transformation_graph is not None
        assert hasattr(transformation_graph, "invoke")
        assert hasattr(transformation_graph, "ainvoke")


# ============================================================================
# TEST SUITE 4: Source Graph - Title Preservation
# ============================================================================


# ============================================================================
# TEST SUITE 5: Source Graph - content_process (content-core 2.x)
# ============================================================================


class TestContentProcessDeleteSource:
    """content-core 2.x no longer deletes the uploaded file; the graph must."""

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_uploaded_file_deleted_when_flag_set(
        self, mock_model_manager, mock_extract, tmp_path
    ):
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        # No STT default configured -> no audio override, no DB access.
        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_extract.return_value = ExtractionOutput(
            title="Doc", content="extracted text"
        )

        uploaded = tmp_path / "upload.pdf"
        uploaded.write_text("data")

        state = {
            "source_id": "source:123",
            "content_state": {"file_path": str(uploaded), "delete_source": True},
            "embed": False,
            "apply_transformations": [],
        }

        result = await content_process(cast(SourceState, state))

        assert result["extraction"].content == "extracted text"
        assert not uploaded.exists()  # file removed by the graph
        mock_extract.assert_awaited_once()
        # The broader YouTube transcript language list is wired into the config
        # (content-core's own default is only en/es/pt).
        config = mock_extract.await_args.kwargs["config"]
        assert "de" in config.youtube_languages
        assert "ja" in config.youtube_languages

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_uploaded_file_kept_when_flag_not_set(
        self, mock_model_manager, mock_extract, tmp_path
    ):
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_extract.return_value = ExtractionOutput(title="Doc", content="text")

        uploaded = tmp_path / "upload.pdf"
        uploaded.write_text("data")

        state = {
            "source_id": "source:123",
            "content_state": {"file_path": str(uploaded), "delete_source": False},
            "embed": False,
            "apply_transformations": [],
        }

        await content_process(cast(SourceState, state))

        assert uploaded.exists()  # file preserved

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_empty_extraction_raises_valueerror(
        self, mock_model_manager, mock_extract, tmp_path
    ):
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_extract.return_value = ExtractionOutput(title="", content="   ")

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://example.com"},
            "embed": False,
            "apply_transformations": [],
        }

        with pytest.raises(ValueError):
            await content_process(cast(SourceState, state))

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.ContentSettings")
    # Runtime present: nothing to fall back from.
    @patch("open_notebook.graphs.source.engine_runtime_missing", return_value=None)
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_persisted_engines_wired_into_config(
        self, mock_model_manager, mock_extract, _mock_runtime, mock_settings
    ):
        """The persisted content-processing engines reach ContentCoreConfig, so
        a user-selected engine (e.g. crawl4ai) actually takes effect."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_settings.get_instance = AsyncMock(
            return_value=MagicMock(
                youtube_preferred_languages=None,
                default_content_processing_engine_url="crawl4ai",
                default_content_processing_engine_doc="docling",
                docling_ocr=False,
                docling_formulas=True,
                docling_vision=True,
            )
        )
        mock_extract.return_value = ExtractionOutput(title="T", content="body")

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://example.com"},
            "embed": False,
            "apply_transformations": [],
        }

        await content_process(cast(SourceState, state))

        config = mock_extract.await_args.kwargs["config"]
        assert config.url_engine == "crawl4ai"
        assert config.document_engine == "docling"
        assert config.docling_ocr is False
        assert config.docling_formulas is True
        assert config.docling_vision is True

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.ContentSettings")
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_persisted_youtube_languages_wired_into_config(
        self, mock_model_manager, mock_extract, mock_settings
    ):
        """ContentSettings.youtube_preferred_languages overrides the built-in
        default list, so users can add transcript languages without a code
        change (regression: the setting was dropped in the content-core 2.x
        migration and silently ignored)."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_settings.get_instance = AsyncMock(
            return_value=MagicMock(
                youtube_preferred_languages=["ko", "en"],
                default_content_processing_engine_url=None,
                default_content_processing_engine_doc=None,
                docling_ocr=None,
                docling_formulas=None,
                docling_vision=None,
            )
        )
        mock_extract.return_value = ExtractionOutput(title="T", content="body")

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://youtu.be/abc"},
            "embed": False,
            "apply_transformations": [],
        }

        await content_process(cast(SourceState, state))

        config = mock_extract.await_args.kwargs["config"]
        assert config.youtube_languages == ["ko", "en"]

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.ContentSettings")
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_unavailable_engine_falls_back_to_auto(
        self, mock_model_manager, mock_extract, mock_settings
    ):
        """A stored engine whose runtime is absent must not reach content-core.

        The selection is persisted in the database while runtime availability
        comes from environment flags, so a redeploy that drops
        OPEN_NOTEBOOK_ENABLE_CRAWL4AI leaves the setting pointing at a runtime
        that is not installed. Passing it through failed every URL ingestion
        with "Could not extract any text content from this source" and no clue
        as to why; the extraction must degrade to content-core's "auto" chain
        instead.
        """
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_settings.get_instance = AsyncMock(
            return_value=MagicMock(
                youtube_preferred_languages=None,
                default_content_processing_engine_url="crawl4ai",
                default_content_processing_engine_doc="docling",
                docling_ocr=True,
                docling_formulas=False,
                docling_vision=False,
            )
        )
        mock_extract.return_value = ExtractionOutput(title="T", content="body")

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://example.com"},
            "embed": False,
            "apply_transformations": [],
        }

        with patch(
            "open_notebook.graphs.source.engine_runtime_missing",
            side_effect=lambda engine: {
                "crawl4ai": "OPEN_NOTEBOOK_ENABLE_CRAWL4AI",
                "docling": "OPEN_NOTEBOOK_ENABLE_DOCLING",
            }.get(engine),
        ):
            await content_process(cast(SourceState, state))

        config = mock_extract.await_args.kwargs["config"]
        assert config.url_engine == "auto"
        assert config.document_engine == "auto"

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.ContentSettings")
    @patch("open_notebook.graphs.source.extract_content")
    @patch("open_notebook.graphs.source.ModelManager")
    async def test_runtime_free_engines_never_fall_back(
        self, mock_model_manager, mock_extract, mock_settings
    ):
        """Engines needing no opt-in runtime are passed through untouched."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, content_process

        mm_instance = MagicMock()
        mm_instance.get_defaults = AsyncMock(
            return_value=MagicMock(default_speech_to_text_model=None)
        )
        mock_model_manager.return_value = mm_instance
        mock_settings.get_instance = AsyncMock(
            return_value=MagicMock(
                youtube_preferred_languages=None,
                default_content_processing_engine_url="firecrawl",
                default_content_processing_engine_doc="simple",
                docling_ocr=True,
                docling_formulas=False,
                docling_vision=False,
            )
        )
        mock_extract.return_value = ExtractionOutput(title="T", content="body")

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://example.com"},
            "embed": False,
            "apply_transformations": [],
        }

        await content_process(cast(SourceState, state))

        config = mock_extract.await_args.kwargs["config"]
        assert config.url_engine == "firecrawl"
        assert config.document_engine == "simple"


# ============================================================================
# TEST SUITE 6: Per-transformation model_id forwarding (#1137)
# ============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
