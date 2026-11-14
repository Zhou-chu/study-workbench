"""Port isolation is exercised with synthetic config and mocked OS/network calls."""

import signal
import sys
from pathlib import Path
from unittest.mock import MagicMock, Mock, call

import pytest

from scripts.v1 import run_native, runtime_lifecycle

ISOLATED_PORTS = (18001, 5056, 13001)
PORT_FLAGS = [
    "--database-port",
    "18001",
    "--api-port",
    "5056",
    "--frontend-port",
    "13001",
]


def test_selected_ports_supply_consistent_defaults_without_touching_storage(tmp_path):
    env = {"STUDY_WORKBENCH_RUNTIME_DIR": str(tmp_path / "fresh-runtime")}
    run_native.apply_runtime_defaults(env, tmp_path / "repo", ports=ISOLATED_PORTS)
    assert env["SURREAL_URL"] == "ws://127.0.0.1:18001/rpc"
    assert env["INTERNAL_API_URL"] == "http://127.0.0.1:5056"
    assert env["API_URL"] == env["CORS_ORIGINS"] == "http://127.0.0.1:13001"
    assert not (tmp_path / "fresh-runtime").exists()


@pytest.mark.parametrize(
    "key,value",
    [
        ("SURREAL_URL", "ws://127.0.0.1:18000/rpc"),
        ("INTERNAL_API_URL", "http://127.0.0.1:5055"),
        ("API_URL", "http://localhost:13000/custom"),
        ("CORS_ORIGINS", "https://public.example,http://127.0.0.1:13000"),
        ("SURREAL_URL", "ws://another-store:18001/rpc"),
        ("SURREAL_URL", "ws://[::1]:18001/rpc"),
        ("SURREAL_URL", "ws://localhost:18001/rpc"),
        ("SURREAL_URL", "ws://127.0.0.1:18001/other"),
        ("SURREAL_URL", "ws://synthetic-secret@127.0.0.1:18001/rpc"),
        ("SURREAL_URL", "ws://127.0.0.1:18001/rpc?secret=synthetic-secret"),
        ("INTERNAL_API_URL", "http://another-api:5056"),
        ("INTERNAL_API_URL", "https://127.0.0.1:5056"),
        ("INTERNAL_API_URL", "http://127.0.0.1:5056/path"),
        ("INTERNAL_API_URL", "http://127.0.0.1:invalid"),
    ],
)
def test_isolated_ports_reject_inconsistent_endpoints_without_echoing_values(
    tmp_path, key, value
):
    runtime = tmp_path / "fresh-runtime"
    with pytest.raises(ValueError) as error:
        run_native.apply_runtime_defaults(
            {key: value, "STUDY_WORKBENCH_RUNTIME_DIR": str(runtime)},
            tmp_path / "repo",
            ports=ISOLATED_PORTS,
        )
    assert "synthetic-secret" not in str(error.value)
    assert value not in str(error.value)
    assert not runtime.exists()


def test_isolated_ports_preserve_explicit_public_urls_and_storage(tmp_path):
    original = {
        "SURREAL_URL": "ws://127.0.0.1:18001/rpc",
        "INTERNAL_API_URL": "http://127.0.0.1:5056/",
        "API_URL": "https://public.example/custom",
        "CORS_ORIGINS": "https://public.example,http://127.0.0.1:13001",
        "STUDY_WORKBENCH_RUNTIME_DIR": str(tmp_path / "fresh-runtime"),
        "STUDY_WORKBENCH_DATA_DIR": str(tmp_path / "fresh-personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(tmp_path / "fresh-upstream"),
    }
    env = original.copy()
    run_native.apply_runtime_defaults(env, tmp_path / "repo", ports=ISOLATED_PORTS)
    assert original.items() <= env.items()
    assert not (tmp_path / "fresh-runtime").exists()


def test_default_ports_preserve_custom_remote_backends(tmp_path):
    env = {
        "SURREAL_URL": "wss://custom-db.example:443/rpc",
        "INTERNAL_API_URL": "https://custom-api.example/base",
    }
    original = env.copy()
    run_native.apply_runtime_defaults(env, tmp_path / "repo")
    assert original.items() <= env.items()


@pytest.mark.parametrize(
    "flags",
    [
        ["--database-port", "0"],
        ["--api-port", "65536"],
        ["--frontend-port", "-1"],
        ["--api-port", "abc"],
        ["--api-port", "18000"],
    ],
)
def test_bad_ports_fail_before_configuration_or_storage(monkeypatch, capsys, flags):
    config = Mock(side_effect=AssertionError("config must not be read"))
    monkeypatch.setattr(run_native, "validate_private_config", config)
    monkeypatch.setattr(
        sys, "argv", ["run_native", "--config", "/synthetic/config", *flags]
    )
    with pytest.raises(SystemExit) as error:
        run_native.main()
    assert error.value.code == 2
    assert "unrecognized arguments" not in capsys.readouterr().err
    config.assert_not_called()


def test_port_preflight_checks_only_selected_ports(monkeypatch):
    sock = MagicMock()
    sock.__enter__.return_value = sock
    monkeypatch.setattr(run_native.socket, "socket", Mock(return_value=sock))
    run_native.require_free_ports(ISOLATED_PORTS)
    assert sock.bind.call_args_list == [
        call(("127.0.0.1", port)) for port in ISOLATED_PORTS
    ]


def test_listener_validation_checks_selected_ports_not_old_ports(monkeypatch):
    # Old API 5055 is unrelated; selected API 5056 is the launcher's responsibility.
    monkeypatch.setattr(
        Path, "read_text", lambda self: "header\n0: 00000000:13BF 00000000:0000 0A\n"
    )
    run_native.verify_loopback_listeners(ISOLATED_PORTS)
    monkeypatch.setattr(
        Path, "read_text", lambda self: "header\n0: 00000000:13C0 00000000:0000 0A\n"
    )
    with pytest.raises(RuntimeError, match="non-loopback"):
        run_native.verify_loopback_listeners(ISOLATED_PORTS)


@pytest.fixture
def mocked_launcher(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    env = {
        "OPEN_NOTEBOOK_PASSWORD": "synthetic-app-secret",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": "synthetic-encryption-secret",
        "SURREAL_PASSWORD": "synthetic-db-secret",
        "STUDY_WORKBENCH_RUNTIME_DIR": str(tmp_path / "fresh-runtime"),
        "STUDY_WORKBENCH_DATA_DIR": str(tmp_path / "fresh-personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(tmp_path / "fresh-upstream"),
    }
    monkeypatch.setattr(run_native, "ROOT", root)
    monkeypatch.setattr(
        run_native, "validate_private_config", Mock(return_value=tmp_path / "config")
    )
    monkeypatch.setattr(run_native, "build_runtime_environment", Mock(return_value=env))
    monkeypatch.setattr(run_native.os, "umask", Mock())
    monkeypatch.setattr(run_native.signal, "signal", Mock())
    killpg = Mock()
    monkeypatch.setattr(run_native.os, "killpg", killpg)
    procs = [
        Mock(pid=91000 + index, poll=Mock(return_value=None)) for index in range(4)
    ]
    popen = Mock(side_effect=procs)
    monkeypatch.setattr(run_native.subprocess, "Popen", popen)
    monkeypatch.setattr(
        runtime_lifecycle, "process_identity", lambda pid: (pid, pid, 1)
    )
    monkeypatch.setattr(runtime_lifecycle.os, "waitid", Mock(return_value=None))
    monkeypatch.setattr(run_native, "owned_listener_ready", Mock(return_value=True))
    monkeypatch.setattr(run_native, "require_owned_listener", Mock(return_value=True))
    get = Mock(return_value=Mock(status_code=200))
    monkeypatch.setattr(run_native.httpx, "get", get)
    worker = Mock(return_value=True)
    monkeypatch.setattr(run_native, "worker_startup_observed", worker)
    sock = MagicMock()
    sock.__enter__.return_value = sock
    monkeypatch.setattr(run_native.socket, "socket", Mock(return_value=sock))
    read_text = Path.read_text
    monkeypatch.setattr(
        Path,
        "read_text",
        lambda self, *a, **kw: "header\n"
        if self.parent == Path("/proc/net")
        else read_text(self, *a, **kw),
    )

    def sleep(seconds):
        if seconds == 1:
            raise KeyboardInterrupt

    monkeypatch.setattr(run_native.time, "sleep", sleep)
    monkeypatch.setattr(
        sys,
        "argv",
        ["run_native", "--config", "/synthetic/config", "--frontend-dev", *PORT_FLAGS],
    )
    return env, procs, popen, get, worker, sock, killpg


def test_main_propagates_isolated_ports_to_every_boundary(mocked_launcher, capsys):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    run_native.main()
    commands = [invocation.args[0] for invocation in popen.call_args_list]
    assert commands[0][commands[0].index("--bind") + 1] == "127.0.0.1:18001"
    assert commands[1][commands[1].index("--port") + 1] == "5056"
    assert commands[3][commands[3].index("--port") + 1] == "13001"
    assert env["PORT"] == "13001" and env["HOSTNAME"] == "127.0.0.1"
    assert env["API_URL"] == env["CORS_ORIGINS"] == "http://127.0.0.1:13001"
    assert env["INTERNAL_API_URL"] == "http://127.0.0.1:5056"
    assert env["SURREAL_URL"] == "ws://127.0.0.1:18001/rpc"
    assert get.call_args_list == [
        call(url, timeout=1, trust_env=False)
        for url in (
            "http://127.0.0.1:18001/health",
            "http://127.0.0.1:5056/health",
            "http://127.0.0.1:13001/login",
        )
    ]
    worker.assert_called_once_with(
        Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]) / "worker.log", 0
    )
    assert sock.bind.call_args_list == [
        call(("127.0.0.1", port)) for port in ISOLATED_PORTS
    ]
    output = capsys.readouterr().out
    assert "Frontend http://127.0.0.1:13001" in output
    for old_port in ("18000", "5055", "13000"):
        assert old_port not in repr(commands) + repr(get.call_args_list) + output
    for secret in (
        "synthetic-app-secret",
        "synthetic-encryption-secret",
        "synthetic-db-secret",
    ):
        assert secret not in repr(commands) + repr(get.call_args_list) + output
    assert env["SURREAL_PASS"] == env["SURREAL_PASSWORD"]
    assert env["STUDY_WORKBENCH_PRIVATE_MODE"] == "1"
    for invocation in popen.call_args_list:
        assert invocation.kwargs["start_new_session"] is True
        assert invocation.kwargs["umask"] == 0o077
        assert invocation.kwargs["env"] is env
        assert invocation.kwargs["stdout"].closed
    assert killpg.call_args_list == [
        call(proc.pid, sig)
        for sig in (signal.SIGTERM, signal.SIGKILL)
        for proc in reversed(procs)
    ]


def test_startup_failure_closes_logs_and_only_stops_owned_groups(
    mocked_launcher, capsys
):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    popen.side_effect = [procs[0], OSError("synthetic-db-secret")]
    with pytest.raises(SystemExit) as error:
        run_native.main()
    assert "synthetic-db-secret" not in str(error.value) + capsys.readouterr().out
    assert killpg.call_args_list == [
        call(procs[0].pid, signal.SIGTERM),
        call(procs[0].pid, signal.SIGKILL),
    ]
    assert popen.call_count == 2
    assert all(
        invocation.kwargs["stdout"].closed for invocation in popen.call_args_list
    )


def test_bad_local_url_fails_before_runtime_creation_or_processes(mocked_launcher):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    env["SURREAL_URL"] = "ws://synthetic-db-secret@127.0.0.1:18000/rpc"
    with pytest.raises(SystemExit) as error:
        run_native.main()
    assert "synthetic-db-secret" not in str(error.value)
    assert not Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]).exists()
    popen.assert_not_called()
    get.assert_not_called()
    sock.bind.assert_not_called()
    killpg.assert_not_called()


def test_default_ports_preserve_direct_api_browser_url(tmp_path):
    env = {"API_URL": "http://127.0.0.1:5055/custom"}
    run_native.apply_runtime_defaults(env, tmp_path / "repo")
    assert env["API_URL"] == "http://127.0.0.1:5055/custom"


@pytest.mark.parametrize(
    "key,value",
    [
        ("SURREAL_URL", "ws://127.0.0.1:18001/rpc"),
        ("INTERNAL_API_URL", "http://localhost:5056"),
    ],
)
def test_default_ports_reject_inconsistent_local_backends(tmp_path, key, value):
    with pytest.raises(ValueError, match="selected native ports"):
        run_native.apply_runtime_defaults({key: value}, tmp_path / "repo")


def test_selected_runtime_still_rejects_source_root_and_ancestors(tmp_path):
    for runtime in (tmp_path, tmp_path / "source"):
        with pytest.raises(ValueError, match="source root or ancestor"):
            run_native.apply_runtime_defaults(
                {"STUDY_WORKBENCH_RUNTIME_DIR": str(runtime)},
                tmp_path / "source",
                ports=ISOLATED_PORTS,
            )
    assert not (tmp_path / "source").exists()


def test_occupied_selected_port_never_starts_services(mocked_launcher):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    sock.bind.side_effect = OSError("synthetic")
    with pytest.raises(RuntimeError, match="occupied"):
        run_native.main()
    popen.assert_not_called()
    get.assert_not_called()
    killpg.assert_not_called()
    assert not Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]).exists()


def test_readiness_failure_stops_only_started_services(mocked_launcher, monkeypatch):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    get.side_effect = [Mock(status_code=200), Mock(status_code=401)]
    monkeypatch.setattr(run_native.time, "monotonic", Mock(side_effect=[0, 0, 121]))
    with pytest.raises(SystemExit, match="startup/health check failed"):
        run_native.main()
    assert popen.call_count == 2
    assert killpg.call_args_list == [
        call(proc.pid, sig)
        for sig in (signal.SIGTERM, signal.SIGKILL)
        for proc in reversed(procs[:2])
    ]
    assert all(
        invocation.kwargs["stdout"].closed for invocation in popen.call_args_list
    )


def test_production_frontend_receives_selected_port(mocked_launcher, monkeypatch):
    import shutil

    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    (run_native.ROOT / "frontend/.next/standalone").mkdir(parents=True)
    monkeypatch.setattr(shutil, "copytree", Mock())
    monkeypatch.setattr(
        sys, "argv", ["run_native", "--config", "/synthetic/config", *PORT_FLAGS]
    )
    run_native.main()
    frontend_command = popen.call_args_list[-1].args[0]
    assert frontend_command[:3] == ["npm", "run", "start"]
    assert frontend_command[-2:] == ["--port", "13001"]
    assert env["PORT"] == "13001"


@pytest.mark.parametrize("key", ["API_URL", "CORS_ORIGINS"])
@pytest.mark.parametrize(
    "host",
    [
        "127.1",
        "0x7f000001",
        "2130706433",
        "0177.0.0.1",
        "127.0.0.1.",
        "[::ffff:127.0.0.1]",
        "[::ffff:7f00:1]",
    ],
)
def test_isolated_ports_reject_browser_normalized_loopback_aliases(tmp_path, key, host):
    with pytest.raises(ValueError, match="selected native ports"):
        run_native.apply_runtime_defaults(
            {key: f"http://{host}:13000"},
            tmp_path / "repo",
            ports=ISOLATED_PORTS,
        )


@pytest.mark.parametrize("key", ["API_URL", "CORS_ORIGINS"])
@pytest.mark.parametrize(
    "value",
    [
        "http://%31%32%37.0.0.1:13000",
        "http://127.0.0.1:13000\\@public.example",
        "http:///127.0.0.1:13000",
        "http:127.0.0.1:13000",
        "http://synthetic-secret@public.example",
    ],
)
def test_isolated_browser_urls_reject_ambiguous_authority(tmp_path, key, value):
    with pytest.raises(ValueError, match="selected native ports") as error:
        run_native.apply_runtime_defaults(
            {key: value},
            tmp_path / "repo",
            ports=ISOLATED_PORTS,
        )
    assert "synthetic-secret" not in str(error.value)
    assert value not in str(error.value)


def test_isolated_public_urls_preserve_unambiguous_path_escapes_and_cors_wildcard(
    tmp_path,
):
    env = {"API_URL": "https://public.example/custom%20path", "CORS_ORIGINS": "*, "}
    run_native.apply_runtime_defaults(env, tmp_path / "repo", ports=ISOLATED_PORTS)
    assert env["API_URL"] == "https://public.example/custom%20path"
    assert env["CORS_ORIGINS"] == "*, "


@pytest.mark.parametrize("key", ["API_URL", "CORS_ORIGINS"])
@pytest.mark.parametrize("host", ["１２７.０.０.１", "ｌｏｃａｌｈｏｓｔ"])
def test_isolated_browser_urls_reject_unicode_authorities(tmp_path, key, host):
    with pytest.raises(ValueError, match="selected native ports"):
        run_native.apply_runtime_defaults(
            {key: f"http://{host}:13000"},
            tmp_path / "repo",
            ports=ISOLATED_PORTS,
        )


def test_isolated_public_urls_preserve_unicode_paths_and_ascii_punycode_hosts(tmp_path):
    value = "https://xn--bcher-kva.example/资料%20path"
    env = {"API_URL": value}
    run_native.apply_runtime_defaults(env, tmp_path / "repo", ports=ISOLATED_PORTS)
    assert env["API_URL"] == value


@pytest.mark.parametrize("key", ["API_URL", "CORS_ORIGINS"])
def test_isolated_browser_urls_reject_old_ports_on_reserved_localhost_subdomains(
    tmp_path, key
):
    with pytest.raises(ValueError, match="selected native ports"):
        run_native.apply_runtime_defaults(
            {key: "http://preview.localhost:13000"},
            tmp_path / "repo",
            ports=ISOLATED_PORTS,
        )
