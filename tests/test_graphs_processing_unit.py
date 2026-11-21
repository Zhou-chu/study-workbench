"""Direct extraction policy with synthetic ModelManager and content extraction."""

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestContentProcessDeleteSource:
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
