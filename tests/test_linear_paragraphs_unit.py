"""Exact offsets and bounded-cost regressions for evidence paragraph splitting."""

import itertools
import re
import time

import pytest

from api.evidence_service import _paragraphs


def reference(text, maximum):
    result = []
    for match in re.finditer(r"\S(?:.*?\S)?(?=\s*(?:\n\s*\n|\Z))", text, re.DOTALL):
        start, end = match.span()
        for offset in range(start, end, maximum):
            stop = min(end, offset + maximum)
            result.append((offset, stop, text[offset:stop]))
    return result


@pytest.mark.parametrize("maximum", [1, 2, 7, 1600])
def test_exhaustive_short_text_preserves_original_spans(maximum):
    for size in range(6):
        for chars in itertools.product("a中 \n\t", repeat=size):
            text = "".join(chars)
            assert list(_paragraphs(text, maximum)) == reference(text, maximum)


@pytest.mark.parametrize(
    "text",
    [
        " \r\n标题\r\n单行\r\n \t\r\n尾段 ",
        "A\u00a0\u2028B\n\u3000\nC\u0085",
        "\n\n\n",
        "a\n b\n c",
        "a" * 3301,
    ],
)
def test_unicode_whitespace_and_chunk_boundaries(text):
    actual = list(_paragraphs(text, 13))
    assert actual == reference(text, 13)
    assert all(
        text[start:stop] == quote and stop - start <= 13
        for start, stop, quote in actual
    )


def test_long_nonseparator_whitespace_is_bounded():
    # One newline is not a paragraph separator. The entire original span survives.
    text = "A" + " " * 24000 + "\nB"
    started = time.process_time()
    actual = list(_paragraphs(text, 1600))
    elapsed = time.process_time() - started
    assert "".join(item[2] for item in actual) == text
    assert elapsed < 0.4, (
        f"paragraph scan used {elapsed:.3f}s CPU for {len(text)} chars"
    )
