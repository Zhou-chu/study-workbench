"""Bounded real-function regressions; no provider, database or service calls."""

import itertools
import json
import multiprocessing
import random
import re

import pytest

from open_notebook.graphs.grounded_chat import GroundedChatService
from open_notebook.utils.chunking import (
    _calculate_markdown_score,
    _count_markdown_links,
)


def _adversarial_case(kind, size, connection):
    try:
        if kind == "response":
            result = GroundedChatService._response(
                '{"answer":' + " " * size + '"正常", "citations": []}'
            )
            connection.send(result == ("正常", []))
        else:
            connection.send(_calculate_markdown_score("[" * size) == 0.0)
    finally:
        connection.close()


@pytest.mark.parametrize("kind", ["response", "markdown"])
@pytest.mark.parametrize("size", [20000, 80000, 320000])
def test_long_adversarial_input_completes_without_backtracking(kind, size):
    if "fork" not in multiprocessing.get_all_start_methods():
        pytest.skip("bounded regression uses POSIX fork after imports")
    context = multiprocessing.get_context("fork")
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_adversarial_case, args=(kind, size, child))
    process.start()
    child.close()
    try:
        assert parent.poll(3), f"{kind} exceeded bounded processing time"
        assert parent.recv() is True
        process.join(1)
        assert process.exitcode == 0
    finally:
        if process.is_alive():
            process.terminate()
        process.join(1)
        if process.is_alive():
            process.kill()
            process.join(1)
        process.close()
        parent.close()


@pytest.mark.parametrize("prefix", ["", "```", "```json", "```json\n", "```\u2003"])
@pytest.mark.parametrize("suffix", ["", "```", "\n```", "\u2003```"])
def test_response_fence_compatibility(prefix, suffix):
    value = {"answer": "你好 α 😀", "citations": [{"quote": "原文"}]}
    raw = "\u2003" + prefix + json.dumps(value, ensure_ascii=False) + suffix + "\n"
    historical = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    expected = json.loads(historical)
    assert GroundedChatService._response(raw) == (
        expected["answer"],
        expected["citations"],
    )


@pytest.mark.parametrize(
    "text",
    [
        "[a](b)",
        "[a](b)[c](d)",
        "[[nested]](url)",
        "[a](nested(url))",
        "[a]()",
        "[](b)",
        "[a]()[later](url)",
        "[[[",
        "[a](unfinished",
        "[a\nb](c)",
        "[a](b\nc)",
        "[中\r文](😀)",
        "[中\u2028文](α)",
        "[x](a)[y](b) [空](　)",
        "[a](b)) [c](d)",
    ],
)
def test_markdown_link_heuristic_preserves_nested_and_empty_delimiter_behavior(text):
    expected = len(re.findall(r"\[.+?\]\(.+?\)", text))
    assert _count_markdown_links(text) == expected


def test_markdown_counter_matches_historical_regex_on_exhaustive_short_inputs():
    for length in range(7):
        for values in itertools.product("[]()字\n", repeat=length):
            text = "".join(values)
            assert _count_markdown_links(text) == len(
                re.findall(r"\[.+?\]\(.+?\)", text)
            ), repr(text)
    randomizer = random.Random(704)
    for _ in range(2000):
        text = "".join(randomizer.choices("[]()字😀α\n\r\t\u2003\u2028", k=80))
        assert _count_markdown_links(text) == len(
            re.findall(r"\[.+?\]\(.+?\)", text)
        ), repr(text)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "```",
        "````",
        "`````",
        "``````",
        "```json```",
        "```JSON{} ```",
        "```jsonx{} ```",
        "{}",
        "[]",
        "null",
        "{broken",
        '{"answer":""}',
        '{"answer":"ok", "citations": [1]}',
    ],
)
def test_response_malformed_input_rejection_is_unchanged(raw):
    from open_notebook.exceptions import ExternalServiceError

    with pytest.raises(ExternalServiceError, match="INVALID_MODEL_RESPONSE"):
        GroundedChatService._response(raw)
