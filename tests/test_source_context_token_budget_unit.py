"""Direct source-content predicates and token-budget logic with synthetic encoding."""

from unittest.mock import AsyncMock, patch

import pytest
from source_context_budget_fixtures import _mock_source

from open_notebook.graphs.source_chat import _source_content_is_available
from open_notebook.utils.context_builder import (
    SOURCE_TRUNCATION_NOTICE,
    _truncate_source_to_token_budget,
    build_source_context,
)


class TestBuildSourceContext:
    @pytest.mark.parametrize(
        ("status", "full_text", "expected"),
        [
            ("available", "complete text", True),
            ("truncated", "partial text", True),
            ("missing", "", False),
            ("omitted_budget", "stale text", False),
            (None, "legacy text", True),
            (None, "", False),
        ],
    )
    def test_source_content_availability_rules(
        self,
        status,
        full_text,
        expected,
    ):
        """Explicit statuses win, while legacy contexts fall back to their text."""
        metadata = {} if status is None else {"source_text_status": status}

        assert (
            _source_content_is_available(
                {"id": "source:123", "full_text": full_text},
                {"metadata": metadata},
            )
            is expected
        )

    def test_truncation_handles_non_monotonic_bpe_counts(self):
        """A longer fitting token prefix survives a shorter over-budget one."""
        full_text = "abcdefghij"
        source_context = {
            "id": "source:123",
            "title": "T",
            "full_text": full_text,
            "insights": [],
        }

        class NonMonotonicEncoding:
            def encode(self, text, **_kwargs):
                if text == full_text:
                    return list(range(len(full_text)))
                if SOURCE_TRUNCATION_NOTICE in text:
                    prefix = text.split("**Content:**\n", maxsplit=1)[1].split(
                        SOURCE_TRUNCATION_NOTICE,
                        maxsplit=1,
                    )[0]
                    token_counts = {8: 11, 9: 10, 10: 12}
                    return list(range(token_counts.get(len(prefix), len(prefix) + 1)))
                return list(range(20))

            def decode_bytes(self, tokens):
                return full_text[: len(tokens)].encode()

        with patch(
            "tiktoken.get_encoding",
            return_value=NonMonotonicEncoding(),
        ):
            budgeted_source, source_truncated = _truncate_source_to_token_budget(
                source_context,
                max_tokens=10,
            )

        assert budgeted_source is not None
        assert budgeted_source["full_text"] == (
            full_text[:9] + SOURCE_TRUNCATION_NOTICE
        )
        assert source_truncated is True

    def test_token_prefix_search_has_bounded_candidate_checks(self):
        """Large tokenized sources do not trigger a linear re-encode scan."""
        full_text = "x" * 10_000
        source_context = {
            "id": "source:123",
            "title": "T",
            "full_text": full_text,
            "insights": [],
        }

        class CountingEncoding:
            def __init__(self):
                self.encode_calls = 0

            def encode(self, text, **_kwargs):
                self.encode_calls += 1
                if text == full_text:
                    return list(range(len(full_text)))
                if SOURCE_TRUNCATION_NOTICE in text:
                    prefix = text.split("**Content:**\n", maxsplit=1)[1].split(
                        SOURCE_TRUNCATION_NOTICE,
                        maxsplit=1,
                    )[0]
                    return list(range(len(prefix) + 20))
                return list(range(len(full_text) + 20))

            def decode_bytes(self, tokens):
                return ("x" * len(tokens)).encode()

        encoding = CountingEncoding()
        with patch("tiktoken.get_encoding", return_value=encoding):
            budgeted_source, source_truncated = _truncate_source_to_token_budget(
                source_context,
                max_tokens=1_000,
            )

        assert budgeted_source is not None
        assert budgeted_source["full_text"].startswith("x" * 980)
        assert source_truncated is True
        assert encoding.encode_calls < 35

    @pytest.mark.asyncio
    async def test_large_source_reuses_initial_tokenization(self):
        """Source Chat does not re-tokenize the full document during truncation."""
        full_text = "x" * 10_000
        source = _mock_source([])
        source.get_context.return_value["full_text"] = full_text

        class CountingEncoding:
            def __init__(self):
                self.full_text_calls = 0
                self.full_render_calls = 0

            def encode(self, text, **_kwargs):
                if text == full_text:
                    self.full_text_calls += 1
                    return list(range(len(full_text)))
                if full_text in text:
                    self.full_render_calls += 1
                    return list(range(len(full_text) + 20))
                if SOURCE_TRUNCATION_NOTICE in text:
                    prefix = text.split("**Content:**\n", maxsplit=1)[1].split(
                        SOURCE_TRUNCATION_NOTICE,
                        maxsplit=1,
                    )[0]
                    return list(range(len(prefix) + 20))
                return []

            def decode_bytes(self, tokens):
                return ("x" * len(tokens)).encode()

        encoding = CountingEncoding()
        with (
            patch(
                "open_notebook.utils.context_builder.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch("tiktoken.get_encoding", return_value=encoding),
        ):
            result = await build_source_context("source:123", max_tokens=1_000)

        assert result["metadata"]["source_truncated"] is True
        assert encoding.full_render_calls == 1
        assert encoding.full_text_calls == 1

    def test_incomplete_utf8_prefix_is_not_reported_as_source_text(self):
        """A decoded-empty token prefix follows the omitted-budget path."""
        full_text = "🙂"
        source_context = {
            "id": "source:123",
            "title": "T",
            "full_text": full_text,
            "insights": [],
        }

        class IncompleteEncoding:
            def encode(self, text, **_kwargs):
                if text == full_text:
                    return [1]
                if SOURCE_TRUNCATION_NOTICE in text:
                    return [1]
                return list(range(20))

            def decode_bytes(self, _tokens):
                return b"\xf0"

        with patch("tiktoken.get_encoding", return_value=IncompleteEncoding()):
            budgeted_source, source_truncated = _truncate_source_to_token_budget(
                source_context,
                max_tokens=10,
            )

        assert budgeted_source is None
        assert source_truncated is True

    def test_word_fallback_search_has_logarithmic_candidate_checks(self):
        """Offline fallback does not repeatedly scan every word prefix."""
        full_text = "word " * 1_000
        source_context = {
            "id": "source:123",
            "title": "T",
            "full_text": full_text,
            "insights": [],
        }

        def fallback_count(text):
            return int(len(text.split()) * 1.3)

        with (
            patch("tiktoken.get_encoding", side_effect=OSError("offline")),
            patch(
                "open_notebook.utils.context_builder.token_count",
                side_effect=fallback_count,
            ) as mock_token_count,
        ):
            budgeted_source, source_truncated = _truncate_source_to_token_budget(
                source_context,
                max_tokens=100,
            )

        assert budgeted_source is not None
        assert source_truncated is True
        assert mock_token_count.call_count < 15

    @pytest.mark.asyncio
    async def test_missing_source_yields_empty_context(self):
        """A missing source produces an empty context, not an error."""
        from open_notebook.exceptions import NotFoundError

        with patch(
            "open_notebook.utils.context_builder.Source.get",
            new=AsyncMock(side_effect=NotFoundError("nope")),
        ):
            result = await build_source_context("source:missing")

        assert result["sources"] == []
        assert result["insights"] == []
        assert result["total_tokens"] == 0
        assert result["metadata"]["source_text_status"] == "not_found"
