"""AST-isolated QA response contract; never execute its browser or mkdir harness."""

import ast
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "apps/web/scripts/visual-review.py"


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/api/personal/n/workspace-view", {"marker": "workspace"}),
        ("/api/notebooks", [{"id": "n", "name": "Synthetic notebook"}]),
        ("/api/notebooks/n", {"id": "n", "name": "Synthetic notebook"}),
        ("/api/personal/notes", [{"id": "note:synthetic", "content": "body"}]),
        ("/api/personal/turns", []),
        ("/api/credentials", []),
        ("/api/credentials/env-status", {}),
        ("/unknown", {}),
    ],
)
def test_response_keeps_object_and_array_contract(path: str, expected: object) -> None:
    function = next(
        node
        for node in ast.parse(SCRIPT.read_text()).body
        if isinstance(node, ast.FunctionDef) and node.name == "api"
    )
    requests: list[dict[str, str]] = []
    namespace: dict[str, object] = {
        "json": json,
        "urlparse": urlparse,
        "requests": requests,
        "workspace": {"marker": "workspace"},
        "notebooks": [{"id": "n", "name": "Synthetic notebook"}],
        "notes": [{"id": "note:synthetic", "content": "body"}],
    }
    exec(
        compile(ast.Module(body=[function], type_ignores=[]), str(SCRIPT), "exec"),
        namespace,
    )
    handler = namespace["api"]
    assert callable(handler)
    replies: list[dict[str, object]] = []

    def fulfill(**kwargs: object) -> None:
        replies.append(kwargs)

    route = SimpleNamespace(
        request=SimpleNamespace(url="https://preview.invalid" + path, method="GET"),
        fulfill=fulfill,
    )
    handler(route)
    assert len(replies) == 1
    reply = replies[0]
    assert reply["status"] == 200
    assert reply["content_type"] == "application/json"
    body = reply["body"]
    assert isinstance(body, str)
    assert json.loads(body) == expected
    assert requests == [{"path": path, "method": "GET"}]
