"""Unit-test the real nested upload observer without importing browser/runtime code."""

import ast
import re
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


def observer():
    source = Path(__file__).resolve().parents[1] / "scripts/v1/ux_recovery_check.py"
    tree = ast.parse(source.read_text())
    function = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "uncertain_upload"
    )
    # Compile the unchanged production function body; substitute external route I/O only.
    module = ast.Module(body=[function], type_ignores=[])
    namespace = {"re": re, "keys": [], "file_payloads": [], "uploads": []}
    exec(compile(ast.fix_missing_locations(module), str(source), "exec"), namespace)
    return namespace


def route(body):
    return SimpleNamespace(
        request=SimpleNamespace(post_data_buffer=body.encode()),
        fetch=Mock(
            return_value=SimpleNamespace(ok=True, json=lambda: {"id": "synthetic"})
        ),
        abort=Mock(),
        fulfill=Mock(),
    )


def test_real_upload_observer_extracts_exact_payload():
    ns = observer()
    body = 'name="idempotency_key"\r\n\r\nkey-1\r\n--boundary\r\nname="file"; filename="资料.md"\r\nContent-Type: text/plain\r\n\r\n正文\r\n二行\r\n--boundary--'
    ns["uncertain_upload"](route(body))
    assert ns["keys"] == ["key-1"]
    assert ns["file_payloads"] == ["正文\r\n二行"]


def test_missing_file_terminator_is_bounded():
    ns = observer()
    body = (
        'name="idempotency_key"\r\n\r\nkey-1\r\nname="file"; filename="x"\r\n'
        + "x\r\n\r\n" * 12000
    )
    request = route(body)
    started = time.process_time()
    with pytest.raises(AssertionError, match="No multipart file payload"):
        ns["uncertain_upload"](request)
    elapsed = time.process_time() - started
    request.fetch.assert_not_called()
    assert elapsed < 0.4, f"multipart observer used {elapsed:.3f}s CPU"


@pytest.mark.parametrize(
    "suffix",
    [
        'name="file"; filename="x"\r\nH: v\r\n\r\n\r\n--end',
        'name="file"; filename="x"\r\nH: v\r\n\r\na\r\n\r\nb\r\n--end',
        'name="file"; filename=""\r\nH\r\n\r\nbad\r\n--next\r\nname="file"; filename="y"\r\nH\r\n\r\ngood\r\n--end',
        'name="file"; filename="x"\r\n\r\npayload\r\n--end',
        'name="file"; filename="x"\r\nH: v\r\n\r\nmissing',
        "unrelated content",
    ],
)
def test_original_observer_extraction_semantics(suffix):
    old = re.search(
        r'name="file"; filename="[^\"]+"\r\n.*?\r\n\r\n(.*?)\r\n--', suffix, re.S
    )
    ns = observer()
    request = route('name="idempotency_key"\r\n\r\nkey\r\n--boundary\r\n' + suffix)
    if old:
        ns["uncertain_upload"](request)
        assert ns["file_payloads"] == [old.group(1)]
    else:
        with pytest.raises(AssertionError, match="No multipart file payload"):
            ns["uncertain_upload"](request)
        request.fetch.assert_not_called()
