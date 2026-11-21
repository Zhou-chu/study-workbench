"""Direct graph/worker logic with external boundaries replaced."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_worker_treats_invalid_input_as_permanent():
    """An InvalidInputError from the graph (e.g. its empty-content guard) ends
    the job as failed: re-raised, and in stop_on so it is not retried. The
    guard itself is covered in tests/test_graphs.py."""
    from commands.source_commands import (
        RunTransformationInput,
        run_transformation_command,
    )
    from open_notebook.exceptions import InvalidInputError

    with (
        patch(
            "commands.source_commands.Source.get",
            new=AsyncMock(return_value=SimpleNamespace(full_text="")),
        ),
        patch(
            "commands.source_commands.Transformation.get",
            new=AsyncMock(return_value=SimpleNamespace(model_id=None)),
        ),
        patch(
            "commands.source_commands.transform_graph.ainvoke",
            new=AsyncMock(
                side_effect=InvalidInputError("There is no text content to transform")
            ),
        ),
    ):
        with pytest.raises(InvalidInputError):
            await run_transformation_command(
                RunTransformationInput(
                    source_id="source:abc", transformation_id="transformation:t1"
                )
            )


@pytest.mark.asyncio
async def test_source_processing_skips_transformations_on_whitespace_text():
    """process_source applies default transformations through the source graph;
    whitespace-only text is skipped there instead of failing the job."""
    from open_notebook.graphs.source import transform_content

    source = SimpleNamespace(full_text="  \n ", add_insight=AsyncMock())
    with patch(
        "open_notebook.graphs.source.transform_graph.ainvoke", new=AsyncMock()
    ) as mock_invoke:
        result = await transform_content(
            {"source": source, "transformation": SimpleNamespace(name="t")}  # type: ignore[typeddict-item]
        )

    assert result is None
    mock_invoke.assert_not_called()
    source.add_insight.assert_not_called()
