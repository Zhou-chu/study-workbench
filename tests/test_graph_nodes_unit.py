"""Direct graph/worker logic with external boundaries replaced."""

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.runnables import RunnableConfig

from open_notebook.domain.notebook import Source
from open_notebook.graphs.transformation import (
    TransformationState,
    run_transformation,
)


class TestTransformationGraph:
    def test_transformation_state_structure(self):
        """Test TransformationState structure and fields."""
        from unittest.mock import MagicMock

        from open_notebook.domain.notebook import Source
        from open_notebook.domain.transformation import Transformation

        mock_source = MagicMock(spec=Source)
        mock_transformation = MagicMock(spec=Transformation)

        state = TransformationState(
            input_text="Test text",
            source=mock_source,
            transformation=mock_transformation,
            output="",
        )

        assert state["input_text"] == "Test text"
        assert state["source"] == mock_source
        assert state["transformation"] == mock_transformation
        assert state["output"] == ""

    @pytest.mark.asyncio
    async def test_run_transformation_assertion_no_content(self):
        """Test transformation raises assertion with no content."""
        from unittest.mock import MagicMock

        from open_notebook.domain.transformation import Transformation

        mock_transformation = MagicMock(spec=Transformation)

        state = {
            "input_text": None,
            "transformation": mock_transformation,
            "source": None,
        }

        config: RunnableConfig = {"configurable": {"model_id": None}}

        with pytest.raises(AssertionError, match="No content to transform"):
            await run_transformation(state, config)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("full_text", ["", "   \n\t ", None])
    async def test_run_transformation_rejects_source_without_text(self, full_text):
        """A source with no extracted text must not reach the model, and no
        insight is saved (#1394)."""
        from open_notebook.domain.transformation import Transformation
        from open_notebook.exceptions import InvalidInputError

        mock_source = MagicMock(spec=Source)
        mock_source.full_text = full_text
        mock_source.add_insight = AsyncMock()

        state = {
            "input_text": None,
            "transformation": MagicMock(spec=Transformation),
            "source": mock_source,
        }
        config: RunnableConfig = {"configurable": {"model_id": None}}

        with patch(
            "open_notebook.graphs.transformation.provision_langchain_model",
            new_callable=AsyncMock,
        ) as mock_provision:
            with pytest.raises(InvalidInputError, match="no text content"):
                await run_transformation(state, config)

        mock_provision.assert_not_called()
        mock_source.add_insight.assert_not_called()


class TestSaveSourceTitlePreservation:
    """Test save_source node preserves user-set titles (#670)."""

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.Source.get")
    async def test_custom_title_preserved(self, mock_get):
        """User-set title is NOT overwritten by the extracted title."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, save_source

        mock_source = MagicMock(spec=Source)
        mock_source.title = "My Custom Research Title"
        mock_source.save = AsyncMock()
        mock_get.return_value = mock_source

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://example.com", "file_path": None},
            "extraction": ExtractionOutput(title="video.mp4", content="Some content"),
            "embed": False,
            "apply_transformations": [],
        }

        # cast: the node only reads these keys; SourceState is a total TypedDict
        await save_source(cast(SourceState, state))

        assert mock_source.title == "My Custom Research Title"
        mock_source.save.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.Source.get")
    async def test_placeholder_title_replaced(self, mock_get):
        """Placeholder 'Processing...' title IS replaced by extracted title."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, save_source

        mock_source = MagicMock(spec=Source)
        mock_source.title = "Processing..."
        mock_source.save = AsyncMock()
        mock_get.return_value = mock_source

        state = {
            "source_id": "source:123",
            "content_state": {"url": "https://example.com", "file_path": None},
            "extraction": ExtractionOutput(
                title="Extracted Article Title", content="Some content"
            ),
            "embed": False,
            "apply_transformations": [],
        }

        # cast: the node only reads these keys; SourceState is a total TypedDict
        await save_source(cast(SourceState, state))

        assert mock_source.title == "Extracted Article Title"
        mock_source.save.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.Source.get")
    async def test_none_title_replaced(self, mock_get):
        """None title IS replaced by extracted title."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, save_source

        mock_source = MagicMock(spec=Source)
        mock_source.title = None
        mock_source.save = AsyncMock()
        mock_get.return_value = mock_source

        state = {
            "source_id": "source:123",
            "content_state": {"url": None, "file_path": "/tmp/file.pdf"},
            "extraction": ExtractionOutput(title="Extracted Title", content="Content"),
            "embed": False,
            "apply_transformations": [],
        }

        # cast: the node only reads these keys; SourceState is a total TypedDict
        await save_source(cast(SourceState, state))

        assert mock_source.title == "Extracted Title"
        mock_source.save.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("open_notebook.graphs.source.Source.get")
    async def test_empty_title_replaced(self, mock_get):
        """Empty string title IS replaced by extracted title."""
        from content_core.common import ExtractionOutput

        from open_notebook.graphs.source import SourceState, save_source

        mock_source = MagicMock(spec=Source)
        mock_source.title = ""
        mock_source.save = AsyncMock()
        mock_get.return_value = mock_source

        state = {
            "source_id": "source:123",
            "content_state": {"url": None, "file_path": None},
            "extraction": ExtractionOutput(title="Extracted Title", content="Content"),
            "embed": False,
            "apply_transformations": [],
        }

        # cast: the node only reads these keys; SourceState is a total TypedDict
        await save_source(cast(SourceState, state))

        assert mock_source.title == "Extracted Title"
        mock_source.save.assert_awaited_once()


class TestTransformationModelIdForwarding:
    """Both call sites must forward transformation.model_id into the graph via
    config.configurable so per-transformation model selection is honored (#1137).
    """

    @pytest.mark.asyncio
    @patch(
        "open_notebook.graphs.source.transform_graph.ainvoke", new_callable=AsyncMock
    )
    async def test_source_graph_forwards_model_id(self, mock_ainvoke):
        """open_notebook.graphs.source.transform_content forwards model_id."""
        from open_notebook.domain.transformation import Transformation
        from open_notebook.graphs.source import transform_content

        mock_ainvoke.return_value = {"output": "result"}

        mock_source = MagicMock(spec=Source)
        mock_source.full_text = "some content"
        mock_source.add_insight = AsyncMock()

        transformation = MagicMock(spec=Transformation)
        transformation.name = "summary"
        transformation.title = "Summary"
        transformation.model_id = "model:custom"

        state = {"source": mock_source, "transformation": transformation}

        await transform_content(state)  # type: ignore[arg-type]

        mock_ainvoke.assert_awaited_once()
        config = mock_ainvoke.await_args.kwargs["config"]
        assert config["configurable"]["model_id"] == "model:custom"

    @pytest.mark.asyncio
    @patch(
        "open_notebook.graphs.source.transform_graph.ainvoke", new_callable=AsyncMock
    )
    async def test_source_graph_forwards_none_model_id(self, mock_ainvoke):
        """When model_id is unset (None), None is forwarded (falls back to default)."""
        from open_notebook.domain.transformation import Transformation
        from open_notebook.graphs.source import transform_content

        mock_ainvoke.return_value = {"output": "result"}

        mock_source = MagicMock(spec=Source)
        mock_source.full_text = "some content"
        mock_source.add_insight = AsyncMock()

        transformation = MagicMock(spec=Transformation)
        transformation.name = "summary"
        transformation.title = "Summary"
        transformation.model_id = None

        state = {"source": mock_source, "transformation": transformation}

        await transform_content(state)  # type: ignore[arg-type]

        config = mock_ainvoke.await_args.kwargs["config"]
        assert config["configurable"]["model_id"] is None

    @pytest.mark.asyncio
    @patch("commands.source_commands.transform_graph.ainvoke", new_callable=AsyncMock)
    @patch("commands.source_commands.Transformation.get", new_callable=AsyncMock)
    @patch("commands.source_commands.Source.get", new_callable=AsyncMock)
    async def test_command_forwards_model_id(
        self, mock_source_get, mock_transformation_get, mock_ainvoke
    ):
        """commands.source_commands.run_transformation_command forwards model_id."""
        from commands.source_commands import (
            RunTransformationInput,
            run_transformation_command,
        )
        from open_notebook.domain.transformation import Transformation

        mock_source_get.return_value = MagicMock(spec=Source)

        transformation = MagicMock(spec=Transformation)
        transformation.model_id = "model:custom"
        mock_transformation_get.return_value = transformation

        mock_ainvoke.return_value = {"output": "result"}

        input_data = RunTransformationInput(
            source_id="source:123", transformation_id="transformation:456"
        )

        await run_transformation_command(input_data)

        mock_ainvoke.assert_awaited_once()
        config = mock_ainvoke.await_args.kwargs["config"]
        assert config["configurable"]["model_id"] == "model:custom"
