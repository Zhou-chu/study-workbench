"""Bounded subprocess regressions; no provider, database or service calls."""

import multiprocessing

import pytest

from open_notebook.graphs.grounded_chat import GroundedChatService
from open_notebook.utils.chunking import _calculate_markdown_score


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
