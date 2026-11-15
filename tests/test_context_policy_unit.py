"""Context formatting/budget policy with storage and tokenizer availability seams."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
import tiktoken

from open_notebook.domain.notebook import Source, SourceInsight
from open_notebook.exceptions import DatabaseOperationError, NotFoundError
from open_notebook.utils import context_builder as target


def source(text="word " * 200):
    return {"id": "source:synthetic", "title": "Synthetic", "full_text": text}


def words(rendered):
    return int(len(rendered.split()) * 1.3)


@pytest.mark.parametrize("text", [None, 42, "", "  "])
def test_unavailable_text_renders_explicit_notice(text):
    rendered = target.format_source_context({"sources": [source(text)]})
    assert "[Source text is unavailable in this context.]" in rendered
    assert "**Source ID:** source:synthetic" in rendered


def test_formatter_preserves_unicode_and_defaults_ignores_non_objects():
    rendered = target.format_source_context(
        {"sources": [None, {"full_text": "中文\nA"}], "insights": [7, {}]}
    )
    assert (
        rendered
        == "## SOURCE CONTENT\n**Source ID:** Unknown\n**Title:** No title\n**Content:**\n中文\nA\n\n## SOURCE INSIGHTS\n**Insight ID:** Unknown\n**Type:** Unknown\n**Content:** No content\n"
    )
    assert target.format_source_context({}) == ""


@pytest.mark.parametrize(
    "record,expected",
    [
        ("x", "source:x"),
        ("source:x", "source:x"),
        ("note:x", "source:note:x"),
        ("", "source:"),
    ],
)
def test_table_prefix_is_exact_not_generic_colon_detection(record, expected):
    assert target._ensure_prefix("source", record) == expected


@pytest.mark.parametrize("budget", [30, 45, 80, 120])
def test_fallback_retains_maximal_complete_word_prefix_and_metadata(budget):
    original = source("alpha \t beta\n gamma " * 100)
    before = deepcopy(original)
    result, truncated = target._truncate_source_to_token_budget(
        original, budget, encoding=None
    )
    assert truncated and result is not None
    assert original == before
    assert result["id"] == original["id"] and result["title"] == original["title"]
    prefix = result["full_text"].removesuffix(target.SOURCE_TRUNCATION_NOTICE)
    assert original["full_text"].startswith(prefix) and prefix.strip()
    rendered = target.format_source_context({"sources": [result]})
    assert words(rendered) <= budget
    # Independently extend by the next complete word; the fallback must not
    # silently discard a fitting word (its cost is monotonic).
    remainder = original["full_text"][len(prefix) :]
    next_word = remainder.split()[0]
    extended = {
        **result,
        "full_text": prefix + " " + next_word + target.SOURCE_TRUNCATION_NOTICE,
    }
    assert words(target.format_source_context({"sources": [extended]})) > budget


@pytest.mark.parametrize("budget", [0, 1, 5, -1])
def test_tiny_budget_never_returns_notice_without_source(budget):
    assert target._truncate_source_to_token_budget(source(), budget, encoding=None) == (
        None,
        True,
    )


@pytest.mark.parametrize("text", [None, "", " ", 123])
def test_overbudget_missing_text_is_not_reported_as_truncated(text):
    assert target._truncate_source_to_token_budget(
        source(text), 0, encoding=None, source_is_over_budget=True
    ) == (None, False)


def test_exact_fit_returns_unchanged_object():
    item = source("small text")
    count = words(target.format_source_context({"sources": [item]}))
    result, truncated = target._truncate_source_to_token_budget(
        item, count, encoding=None
    )
    assert result is item and truncated is False


def test_shared_insight_budget_is_included_not_double_counted():
    item = source()
    insights = [{"id": "i", "insight_type": "summary", "content": "important fact"}]
    result, truncated = target._truncate_source_to_token_budget(
        item, 70, insights, encoding=None
    )
    assert truncated and result is not None
    rendered = target.format_source_context({"sources": [result], "insights": insights})
    assert words(rendered) <= 70
    alone, _ = target._truncate_source_to_token_budget(item, 70, encoding=None)
    assert len(result["full_text"]) < len(alone["full_text"])


@pytest.fixture
def offline_tokenizer(monkeypatch):
    def unavailable(*args, **kwargs):
        raise OSError("synthetic unavailable tokenizer cache")

    monkeypatch.setattr(tiktoken, "get_encoding", unavailable)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text,budget,status",
    [
        ("small", None, "available"),
        (None, None, "missing"),
        ("", 100, "missing"),
        ("word " * 300, 55, "truncated"),
        ("word " * 300, 1, "omitted_budget"),
    ],
)
async def test_source_context_real_projection_and_fallback_budget(
    monkeypatch, offline_tokenizer, text, budget, status
):
    record = Source(id="source:synthetic", title="Synthetic", full_text=text)
    # Storage getters are the only domain seams. Real Source.get_context and
    # real context formatter/truncation execute; no stub of their outputs.
    fetch = AsyncMock(return_value=record)
    monkeypatch.setattr(target.Source, "get", fetch)
    monkeypatch.setattr(target.Source, "get_insights", AsyncMock(return_value=[]))
    result = await target.build_source_context("synthetic", budget)
    fetch.assert_awaited_once_with("source:synthetic")
    assert result["metadata"]["source_text_status"] == status
    assert result["metadata"]["source_truncated"] is (
        status in ("truncated", "omitted_budget")
    )
    assert result["total_items"] == len(result["sources"])
    assert result["notes"] == result["insights"] == []
    assert result["total_tokens"] == words(target.format_source_context(result))
    if budget is not None:
        assert result["total_tokens"] <= budget
    if status == "available":
        assert result["sources"][0]["full_text"] == text
    assert record.full_text == text


@pytest.mark.asyncio
async def test_fallback_keeps_later_small_insight_after_oversized_one(
    monkeypatch, offline_tokenizer
):
    record = Source(id="source:x", title="T", full_text="short")
    items = [
        SourceInsight(
            id="source_insight:large",
            source="source:x",
            insight_type="summary",
            content="word " * 200,
        ),
        SourceInsight(
            id="source_insight:small",
            source="source:x",
            insight_type="summary",
            content="fact",
        ),
    ]
    monkeypatch.setattr(target.Source, "get", AsyncMock(return_value=record))
    monkeypatch.setattr(target.Source, "get_insights", AsyncMock(return_value=items))
    result = await target.build_source_context("source:x", 50)
    assert [i["id"] for i in result["insights"]] == ["source_insight:small"]
    assert result["sources"][0]["insights"] == []
    assert result["total_items"] == 2
    assert result["total_tokens"] == words(target.format_source_context(result)) <= 50


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [None, NotFoundError("missing")])
async def test_missing_source_has_explicit_zero_context(monkeypatch, missing):
    fetch = (
        AsyncMock(return_value=None)
        if missing is None
        else AsyncMock(side_effect=missing)
    )
    monkeypatch.setattr(target.Source, "get", fetch)
    result = await target.build_source_context("missing")
    assert result["sources"] == result["insights"] == result["notes"] == []
    assert result["total_tokens"] == result["total_items"] == 0
    assert result["metadata"]["source_text_status"] == "not_found"


@pytest.mark.asyncio
async def test_storage_failure_is_wrapped_but_cancellation_propagates(monkeypatch):
    monkeypatch.setattr(
        target.Source, "get", AsyncMock(side_effect=RuntimeError("synthetic failure"))
    )
    with pytest.raises(
        DatabaseOperationError, match="Failed to build context: synthetic failure"
    ):
        await target.build_source_context("x")
    monkeypatch.setattr(
        target.Source, "get", AsyncMock(side_effect=asyncio.CancelledError())
    )
    with pytest.raises(asyncio.CancelledError):
        await target.build_source_context("x")
