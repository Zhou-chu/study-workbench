"""Owned Linux lifecycle: synthetic procfs/network first, no application imports."""

import os
from unittest.mock import MagicMock, Mock

import pytest
from runtime_lifecycle_test_fixtures import lifecycle

from scripts.v1 import local_check


def test_occupied_local_check_has_no_mutations(tmp_path, monkeypatch):
    lib = lifecycle()
    monkeypatch.setattr(local_check, "ROOT", tmp_path)
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--database-port",
            "18001",
            "--api-port",
            "5056",
            "--frontend-port",
            "13001",
        ],
    )
    monkeypatch.setattr(
        local_check, "require_free_ports", Mock(side_effect=RuntimeError("occupied"))
    )
    spawn = Mock(side_effect=AssertionError("must not start"))
    monkeypatch.setattr(lib.subprocess, "Popen", spawn)
    with pytest.raises(RuntimeError, match="occupied"):
        local_check.main()
    assert not list(tmp_path.iterdir())
    spawn.assert_not_called()


def test_fixture_missing_or_symlink_never_creates_or_reads_external_file(tmp_path):
    root = tmp_path / "repo"
    fixture_dir = root / "tests/fixtures/v1"
    fixture_dir.mkdir(parents=True)
    with pytest.raises(ValueError, match="public fixture"):
        local_check.fixture_inventory(root)
    assert list(fixture_dir.iterdir()) == []
    (fixture_dir / "fixture_course.md").symlink_to(tmp_path / "unread-private")
    with pytest.raises(ValueError, match="public fixture"):
        local_check.fixture_inventory(root)
    assert not (tmp_path / "unread-private").exists()


@pytest.mark.skipif(
    os.environ.get("STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE") != "1",
    reason="Set STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1 for owned disposable OS tests",
)
def test_real_disposable_dummy_listeners_stop_a_leaves_b_and_foreign_zero_requests(
    tmp_path,
):
    """Opt in with STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1; stdlib loopback dummies only."""
    import subprocess
    import sys
    import time

    lib = lifecycle()
    code = """
import http.server, sys
from pathlib import Path
portfile, requests = map(Path, sys.argv[1:])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with requests.open("a") as out: out.write("GET\\n")
        self.send_response(200); self.end_headers(); self.wfile.write(b"dummy")
    def do_POST(self):
        with requests.open("a") as out: out.write("POST\\n")
        self.send_response(200); self.end_headers()
    def log_message(self, *args): pass
server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
portfile.write_text(str(server.server_port))
server.serve_forever()
"""
    processes = []
    try:
        for label in ("a", "b"):
            proc = lib.start_owned(
                [
                    sys.executable,
                    "-c",
                    code,
                    str(tmp_path / label),
                    str(tmp_path / (label + "-requests")),
                ],
                env={"PATH": os.environ.get("PATH", "")},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            processes.append(proc)
        deadline = time.monotonic() + 5
        while not all((tmp_path / name).exists() for name in ("a", "b")):
            assert time.monotonic() < deadline
            assert all(p.poll() is None for p in processes)
            time.sleep(0.01)
        a, b = processes
        pa, pb = (int((tmp_path / label).read_text()) for label in ("a", "b"))
        assert lib.require_owned_listener(a, pa)
        assert lib.require_owned_listener(b, pb)
        with pytest.raises(RuntimeError, match="not owned"):
            lib.wait_for_service(
                "wrong-api",
                a,
                lambda: lib.http_ready(f"http://127.0.0.1:{pb}/health"),
                guard=lambda: lib.owned_listener_ready(a, pb),
            )
            lib.httpx.post(f"http://127.0.0.1:{pb}/write", trust_env=False)
        assert not (tmp_path / "b-requests").exists()
        lib.stop_processes([a], grace=0.01)
        assert a.closed
        assert b.poll() is None
        assert lib.require_owned_listener(b, pb)
        assert lib.http_ready(f"http://127.0.0.1:{pb}/health")
        assert (tmp_path / "b-requests").read_text() == "GET\n"
        assert not lib.listener_inodes(pa)
    finally:
        lib.stop_processes(processes, grace=0.01)


@pytest.fixture
def mocked_runner_custody(monkeypatch):
    # These runner tests fake every process; real custody belongs in bounded
    # subprocess tests, not the potentially multithreaded aggregate pytest host.
    custody = MagicMock()
    monkeypatch.setattr(local_check, "BrowserSubreaper", lambda: custody)
    yield custody
    custody.__enter__.assert_called_once_with()
    custody.__exit__.assert_called_once_with(None, None, None)


@pytest.mark.parametrize("foreign_index,expected_starts", [(0, 1), (1, 2)])
def test_local_runner_foreign_db_or_api_stops_before_dependents_and_writes(
    tmp_path, monkeypatch, foreign_index, expected_starts, mocked_runner_custody
):
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--database-port",
            "18001",
            "--api-port",
            "5056",
            "--frontend-port",
            "13001",
        ],
    )
    monkeypatch.setattr(local_check, "require_free_ports", lambda ports: None)
    monkeypatch.setattr(
        local_check, "fixture_inventory", lambda root: {"fixture_course.md": b"public"}
    )
    monkeypatch.setattr(local_check.tempfile, "mkdtemp", lambda **kwargs: str(tmp_path))
    processes = [Mock(poll=lambda: None) for _ in range(3)]
    spawn = Mock(side_effect=processes)
    monkeypatch.setattr(local_check, "start_owned", spawn)
    cleanup = Mock()
    monkeypatch.setattr(local_check, "stop_processes", cleanup)

    def ready(proc, port):
        if proc is processes[foreign_index]:
            raise RuntimeError("foreign listener not owned")
        return True

    monkeypatch.setattr(local_check, "owned_listener_ready", ready)
    monkeypatch.setattr(local_check, "require_owned_listener", ready)
    monkeypatch.setattr(local_check, "http_ready", lambda url: True)
    client = Mock(
        side_effect=AssertionError("no client/writes before verified ownership")
    )
    monkeypatch.setattr(local_check.httpx, "Client", client)
    with pytest.raises(RuntimeError, match="not owned"):
        local_check.main()
    assert spawn.call_count == expected_starts
    client.assert_not_called()
    cleanup.assert_called_once_with(processes[:expected_starts])


def test_local_runner_rechecks_ownership_at_first_write(
    tmp_path, monkeypatch, mocked_runner_custody
):
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--database-port",
            "18001",
            "--api-port",
            "5056",
            "--frontend-port",
            "13001",
        ],
    )
    monkeypatch.setattr(local_check, "require_free_ports", lambda ports: None)
    monkeypatch.setattr(
        local_check, "fixture_inventory", lambda root: {"fixture_course.md": b"public"}
    )
    monkeypatch.setattr(local_check.tempfile, "mkdtemp", lambda **kwargs: str(tmp_path))
    processes = [Mock(poll=lambda: None) for _ in range(3)]
    monkeypatch.setattr(local_check, "start_owned", Mock(side_effect=processes))
    monkeypatch.setattr(local_check, "stop_processes", Mock())
    monkeypatch.setattr(local_check, "owned_listener_ready", lambda proc, port: True)
    monkeypatch.setattr(local_check, "http_ready", lambda url: True)
    requests: list[str] = []

    def owner(proc, port):
        if len(requests) == 3:
            raise RuntimeError("ownership lost before write")
        return True

    monkeypatch.setattr(local_check, "require_owned_listener", owner)

    def anonymous_get(url, **kwargs):
        requests.append("anonymous GET")
        return Mock(status_code=401)

    monkeypatch.setattr(local_check.httpx, "get", anonymous_get)

    class Client:
        def __init__(self, **kwargs):
            self.guard = kwargs["event_hooks"]["request"][0]
            assert kwargs["trust_env"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, *args, **kwargs):
            self.guard()
            requests.append("POST")
            raise AssertionError("unowned write reached transport")

    monkeypatch.setattr(local_check.httpx, "Client", Client)
    with pytest.raises(RuntimeError, match="ownership lost"):
        local_check.main()
    assert requests == ["anonymous GET"] * 3
    assert not (tmp_path / "api-results.json").exists()
