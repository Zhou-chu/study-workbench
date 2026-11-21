"""Review-tool contracts without executing the runner or starting a process/browser."""

import ast
import io
import subprocess
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import unquote, urlparse

import pytest

SCRIPT = Path(__file__).parents[1] / "apps/web/scripts/model-setup-journey-review.py"


@pytest.fixture
def extract() -> Callable[..., None]:
    tree = ast.parse(SCRIPT.read_text())
    # The review script is not executed; only the extraction operation is compiled.
    helper = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "_extract_baseline_archive"
    )

    def execute(operations: SimpleNamespace, root: Path, destination: Path) -> None:
        namespace = {"subprocess": operations, "Path": Path}
        module = ast.fix_missing_locations(ast.Module(body=[helper], type_ignores=[]))
        exec(compile(module, str(SCRIPT), "exec"), namespace)
        function = namespace["_extract_baseline_archive"]
        assert callable(function)
        function(root, destination)

    return execute


class Producer:
    def __init__(self, stdout: io.BytesIO | None, code: int = 0):
        self.stdout = stdout
        self.code = code
        self.returncode: int | None = None
        self.waited = False
        self.wait_timeout: float | None = None
        self.killed = False
        self.pipe_closed_when_reaped = False

    def wait(self, timeout: float | None = None) -> int:
        self.wait_timeout = timeout
        self.waited = True
        self.pipe_closed_when_reaped = self.stdout is None or self.stdout.closed
        self.returncode = self.code
        return self.code

    def poll(self) -> int | None:
        return self.returncode

    def kill(self) -> None:
        self.killed = True


def operations(producer: Producer) -> SimpleNamespace:
    return SimpleNamespace(
        Popen=Mock(return_value=producer), run=Mock(), PIPE=subprocess.PIPE
    )


ROOT = Path("/synthetic-source")
DEST = Path("/synthetic-destination")


def test_extract_streams_archive_then_closes_and_reaps_producer(
    extract: Callable,
) -> None:
    stream = io.BytesIO(b"synthetic archive")
    producer = Producer(stdout=stream)
    ops = operations(producer)
    extract(ops, ROOT, DEST)

    args = ops.Popen.call_args
    assert args.args[0][:3] == ["git", "archive", "9ee810"]
    assert args.kwargs == {"cwd": ROOT, "stdout": subprocess.PIPE}
    ops.run.assert_called_once_with(
        ["tar", "-xf", "-", "-C", str(DEST)], stdin=stream, check=True
    )
    assert producer.waited and producer.pipe_closed_when_reaped
    assert not producer.killed


@pytest.mark.parametrize(
    "failure", [subprocess.CalledProcessError(2, ["tar"]), KeyboardInterrupt()]
)
def test_extract_reaps_own_producer_after_consumer_failure(
    extract: Callable, failure: BaseException
) -> None:
    producer = Producer(stdout=io.BytesIO(b"synthetic archive"))
    ops = operations(producer)
    ops.run.side_effect = failure

    with pytest.raises(type(failure)) as caught:
        extract(ops, ROOT, DEST)

    assert caught.value is failure
    assert producer.killed and producer.waited and producer.pipe_closed_when_reaped


@pytest.mark.parametrize("operation", ["poll", "kill", "wait"])
@pytest.mark.parametrize("kind", ["tar", "interrupted"])
def test_extract_preserves_original_failure_when_cleanup_itself_fails(
    extract: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    kind: str,
) -> None:
    producer = Producer(stdout=io.BytesIO())
    ops = operations(producer)
    original: BaseException = (
        subprocess.CalledProcessError(2, ["tar"])
        if kind == "tar"
        else KeyboardInterrupt()
    )
    ops.run.side_effect = original
    broken_cleanup = Mock(side_effect=OSError("Synthetic private cleanup path"))
    monkeypatch.setattr(producer, operation, broken_cleanup)

    with pytest.raises(type(original)) as caught:
        extract(ops, ROOT, DEST)

    assert caught.value is original
    assert getattr(caught.value, "__notes__", []) == [
        "Could not fully confirm baseline archive producer cleanup."
    ]
    assert producer.stdout is not None and producer.stdout.closed
    broken_cleanup.assert_called_once()
    if operation == "wait":
        broken_cleanup.assert_called_once_with(timeout=15)
        assert producer.returncode is None
    else:
        assert producer.waited and producer.wait_timeout == 15


def test_extract_never_invokes_tar_without_an_explicit_pipe(extract: Callable) -> None:
    producer = Producer(stdout=None)
    ops = operations(producer)
    with pytest.raises(RuntimeError, match="stdout pipe"):
        extract(ops, ROOT, DEST)
    ops.run.assert_not_called()
    assert producer.killed and producer.waited


def test_extract_rejects_nonzero_producer_even_when_tar_succeeds(
    extract: Callable,
) -> None:
    producer = Producer(stdout=io.BytesIO(b"synthetic archive"), code=7)
    ops = operations(producer)
    with pytest.raises(RuntimeError, match="git archive.*7"):
        extract(ops, ROOT, DEST)
    assert producer.waited and producer.pipe_closed_when_reaped
    assert not producer.killed


def test_extract_does_not_kill_a_producer_that_already_exited(
    extract: Callable,
) -> None:
    producer = Producer(stdout=io.BytesIO(), code=9)
    producer.returncode = 9
    ops = operations(producer)
    ops.run.side_effect = subprocess.CalledProcessError(2, ["tar"])
    with pytest.raises(subprocess.CalledProcessError):
        extract(ops, ROOT, DEST)
    assert producer.waited and producer.pipe_closed_when_reaped
    assert not producer.killed


@pytest.mark.parametrize(
    ("path", "scenario", "method", "action", "expected_code", "payload"),
    [
        ("/api/auth/status", "empty", "GET", None, 200, {"auth_enabled": False}),
        ("/api/providers", "empty", "GET", None, 200, [{"id": "synthetic-provider"}]),
        ("/api/credentials", "empty", "GET", None, 200, [{"id": "credential:sample"}]),
        (
            "/api/models",
            "metadata_failure",
            "GET",
            None,
            503,
            {"detail": "Synthetic metadata failure"},
        ),
        (
            "/api/models/defaults",
            "unknown_write",
            "PUT",
            "save",
            503,
            {"detail": "Synthetic unknown receipt"},
        ),
    ],
)
def test_model_review_synthetic_routes_preserve_object_and_array_responses(
    path: str,
    scenario: str,
    method: str,
    action: str | None,
    expected_code: int,
    payload: dict | list,
) -> None:
    tree = ast.parse(SCRIPT.read_text())
    intercept = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "intercept"
    )
    failures = Mock()
    journal: list[dict] = []
    namespace = {
        "urlparse": urlparse,
        "unquote": unquote,
        "PORT": 18864,
        "PROVIDERS": [{"id": "synthetic-provider"}],
        "current": {
            "scenario": scenario,
            "action": action,
            "tag": "sample",
            "data": {"credentials": [{"id": "credential:sample"}]},
        },
        "failure": failures,
        "report": {"network": journal},
    }
    module = ast.fix_missing_locations(ast.Module(body=[intercept], type_ignores=[]))
    exec(compile(module, str(SCRIPT), "exec"), namespace)
    route = SimpleNamespace(
        request=SimpleNamespace(url="http://127.0.0.1:18864" + path, method=method),
        fulfill=Mock(),
        abort=Mock(),
        continue_=Mock(),
    )
    function = namespace["intercept"]
    assert callable(function)
    function(route)
    route.fulfill.assert_called_once_with(status=expected_code, json=payload)
    route.abort.assert_not_called()
    route.continue_.assert_not_called()
    failures.assert_not_called()
    assert len(journal) == 1
    assert journal[0]["decision"].startswith("synthetic_")
