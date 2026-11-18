"""
Mixed utility/context tests, including real installed metadata and tokenizer
boundaries. Pure text/token fallback/version cases live in test_utils_unit.py.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from source_context_budget_fixtures import _mock_source

from open_notebook.domain.notebook import Source
from open_notebook.graphs.source_chat import (
    _format_source_context,
    _source_content_is_available,
)
from open_notebook.utils import (
    token_count,
)
from open_notebook.utils.context_builder import (
    SOURCE_TRUNCATION_NOTICE,
    _truncate_source_to_token_budget,
    build_source_context,
)

# ============================================================================
# TEST SUITE 3: Version Utilities
# ============================================================================


# ============================================================================
# TEST SUITE 4: Source Context Building
# ============================================================================


def _insight(insight_id, content="insight content"):
    return SimpleNamespace(id=insight_id, insight_type="summary", content=content)


class TestBuildSourceContext:
    """Test suite for build_source_context (used by the source-chat graph)."""

    @pytest.mark.asyncio
    async def test_source_and_insights_shape(self):
        """The response carries the source's full context and its insights."""
        source = _mock_source([_insight("source_insight:1")])

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(return_value=source),
        ) as mock_get:
            result = await build_source_context("123")

        mock_get.assert_awaited_once_with("source:123")  # bare id gets prefixed
        source.get_context.assert_awaited_once_with(
            context_size="long",
            insights=source.get_insights.return_value,
        )
        assert result["sources"] == [
            {
                "id": "source:123",
                "title": "T",
                "full_text": "body",
                "insights": [],
            }
        ]
        assert result["insights"] == [
            {
                "id": "source_insight:1",
                "source_id": "source:123",
                "insight_type": "summary",
                "content": "insight content",
            }
        ]
        assert result["notes"] == []
        assert result["total_items"] == 2
        assert result["total_tokens"] > 0
        assert result["metadata"] == {
            "source_count": 1,
            "note_count": 0,
            "insight_count": 1,
            "source_text_status": "available",
            "source_truncated": False,
        }
        assert result["total_tokens"] == token_count(_format_source_context(result))

    @pytest.mark.asyncio
    async def test_preserves_insights_that_fit_token_budget(self):
        """Insights are retained in order while they fit the token budget."""
        big = "word " * 300
        source = _mock_source(
            [_insight("source_insight:1", big), _insight("source_insight:2", big)]
        )

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(return_value=source),
        ):
            result = await build_source_context("source:123", max_tokens=600)

        # Budget fits the source and the first insight, not the second
        assert len(result["sources"]) == 1
        assert [i["id"] for i in result["insights"]] == ["source_insight:1"]
        assert result["total_tokens"] <= 600

    @pytest.mark.asyncio
    async def test_real_source_full_text_reaches_formatted_prompt(self):
        """Source.get_context(long) carries persisted full text into the prompt."""
        full_text = "Complete source text that must reach Source Chat."
        source = Source(id="source:123", title="T", full_text=full_text)
        mock_get_insights = AsyncMock(return_value=[])

        with (
            patch(
                "open_notebook.utils.context_builder.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch.object(Source, "get_insights", new=mock_get_insights),
        ):
            result = await build_source_context("source:123", max_tokens=500)

        formatted = _format_source_context(result)
        assert full_text in formatted
        assert SOURCE_TRUNCATION_NOTICE not in formatted
        assert result["metadata"]["source_text_status"] == "available"
        assert result["metadata"]["source_truncated"] is False
        mock_get_insights.assert_awaited_once_with()

    @pytest.mark.asyncio
    async def test_large_source_is_deterministically_and_explicitly_truncated(self):
        """An oversized source keeps a marked prefix instead of disappearing."""
        full_text = "evidence " * 1000
        source = _mock_source([])
        source.get_context.return_value["full_text"] = full_text

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(return_value=source),
        ):
            first = await build_source_context("source:123", max_tokens=120)
            second = await build_source_context("source:123", max_tokens=120)

        first_text = first["sources"][0]["full_text"]
        assert first_text == second["sources"][0]["full_text"]
        assert first_text.endswith(SOURCE_TRUNCATION_NOTICE)
        assert len(first_text) < len(full_text)
        assert first["total_tokens"] <= 120
        assert first["metadata"]["source_text_status"] == "truncated"
        assert first["metadata"]["source_truncated"] is True
        assert first["total_tokens"] == token_count(_format_source_context(first))
        assert _source_content_is_available(first["sources"][0], first)

        formatted = _format_source_context(first)
        assert first_text in formatted
        assert SOURCE_TRUNCATION_NOTICE in formatted

    @pytest.mark.asyncio
    async def test_large_source_reserves_budget_for_insights(self):
        """An oversized source leaves deterministic headroom for insights."""
        full_text = "evidence " * 1000
        source = _mock_source([_insight("source_insight:1")])
        source.get_context.return_value["full_text"] = full_text

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(return_value=source),
        ):
            result = await build_source_context("source:123", max_tokens=500)

        assert [insight["id"] for insight in result["insights"]] == ["source_insight:1"]
        assert result["sources"][0]["full_text"].endswith(SOURCE_TRUNCATION_NOTICE)
        assert result["total_tokens"] <= 500
        assert result["metadata"]["insight_count"] == 1
        assert result["metadata"]["source_text_status"] == "truncated"

    @pytest.mark.asyncio
    async def test_tiny_budget_omits_source_with_explicit_status(self):
        """A budget smaller than source metadata never returns oversized context."""
        source = _mock_source([])
        source.get_context.return_value["full_text"] = "evidence " * 1000

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(return_value=source),
        ):
            result = await build_source_context("source:123", max_tokens=1)

        assert result["sources"] == []
        assert result["total_tokens"] <= 1
        assert result["metadata"]["source_text_status"] == "omitted_budget"

    def test_notice_only_budget_omits_source(self):
        """A truncation notice alone is not reported as available source text."""
        source_context = {
            "id": "source:123",
            "title": "T",
            "full_text": "evidence " * 100,
            "insights": [],
        }
        notice_only = {
            **source_context,
            "full_text": SOURCE_TRUNCATION_NOTICE,
        }
        one_character = {
            **source_context,
            "full_text": "e" + SOURCE_TRUNCATION_NOTICE,
        }
        notice_tokens = token_count(
            _format_source_context({"sources": [notice_only], "insights": []})
        )
        one_character_tokens = token_count(
            _format_source_context({"sources": [one_character], "insights": []})
        )
        assert notice_tokens < one_character_tokens

        budgeted_source, source_truncated = _truncate_source_to_token_budget(
            source_context,
            one_character_tokens - 1,
        )

        assert budgeted_source is None
        assert source_truncated is True

    def test_formatter_does_not_apply_a_second_character_limit(self):
        """Formatting preserves text already accepted by the token budget."""
        full_text = "x" * 6000
        formatted = _format_source_context(
            {
                "sources": [
                    {
                        "id": "source:123",
                        "title": "T",
                        "full_text": full_text,
                    }
                ],
                "insights": [],
                "total_tokens": token_count(full_text),
                "metadata": {
                    "source_count": 1,
                    "insight_count": 0,
                    "source_text_status": "available",
                },
            }
        )

        assert full_text in formatted
        formatted_content = formatted.split("**Content:**\n", maxsplit=1)[1]
        assert formatted_content == f"{full_text}\n"
        assert "[Content truncated]" not in formatted
        assert "CONTEXT METADATA" not in formatted

    @pytest.mark.asyncio
    async def test_missing_source_text_is_reported_honestly(self):
        """A source without text is identified without a content indicator."""
        source = _mock_source([_insight("source_insight:1")])
        source.get_context.return_value["full_text"] = None

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(return_value=source),
        ):
            result = await build_source_context("source:123", max_tokens=500)

        formatted = _format_source_context(result)
        assert "[Source text is unavailable in this context.]" in formatted
        assert result["metadata"]["source_text_status"] == "missing"
        assert not _source_content_is_available(result["sources"][0], result)
        assert result["metadata"]["insight_count"] == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
