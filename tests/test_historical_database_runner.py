"""Runner contract: only reviewed synthetic database tests and environment."""

from scripts import historical_database_pytest as runner


def test_environment_discards_live_inputs(tmp_path):
    env = runner.build_test_environment(
        tmp_path,
        {
            "SURREAL_URL": "ws://private",
            "OPENAI_API_KEY": "secret",
            "SURREAL_PASSWORD": "ambient-client",
            "SURREAL_PASS": "ambient-server",
            "AUTH_TEST_SURREAL_URL": "ws://private",
            "PATH": "/usr/bin",
        },
        "ws://127.0.0.1:12345/rpc",
    )
    assert (
        env["SURREAL_URL"] == env["AUTH_TEST_SURREAL_URL"] == "ws://127.0.0.1:12345/rpc"
    )
    assert "OPENAI_API_KEY" not in env
    assert env["SURREAL_USER"] == "synthetic"
    assert env["SURREAL_PASSWORD"] not in {
        "synthetic",
        "ambient-client",
        "ambient-server",
    }
    assert len(env["SURREAL_PASSWORD"]) >= 32
    assert "SURREAL_PASS" not in env
    assert env["PYTHON_DOTENV_DISABLED"] == "1"
    assert env["STUDY_WORKBENCH_TEST_SURREAL"] == "1"
    assert env["WEB_DISCOVERY_TEST_DB"] == "1"
    assert env["SURREAL_NAMESPACE"].startswith("historical_")


def test_selection_is_bounded():
    assert len(runner.TESTS) == 5
    assert all(path.startswith("tests/test_") for path in runner.TESTS)
    assert (
        "::test_real_surreal_sqlite_and_originals_restore_into_fresh_environment"
        in runner.TESTS[3]
    )


def test_invalid_binary_never_starts(monkeypatch, tmp_path):
    from unittest.mock import Mock

    import pytest

    binary = tmp_path / "surreal"
    binary.write_bytes(b"not the official executable")
    binary.chmod(0o700)
    monkeypatch.setattr(
        runner.sys,
        "argv",
        ["runner", "--surreal-binary", str(binary), "--tiktoken-cache", str(tmp_path)],
    )
    start = Mock()
    monkeypatch.setattr(runner.lifecycle, "start_owned", start)
    with pytest.raises(SystemExit) as result:
        runner.main()
    assert result.value.code == 2
    start.assert_not_called()


def test_network_guard_rejects_dns_before_any_connect():
    import pytest

    with pytest.raises(OSError):
        runner.network_guard(
            12345, "socket.getaddrinfo", ("provider.example", 443, 0, 0, 0)
        )
    runner.network_guard(12345, "socket.getaddrinfo", ("127.0.0.1", 12345, 0, 0, 0))
    with pytest.raises(OSError):
        runner.network_guard(12345, "socket.gethostbyname", ("provider.example",))


def test_network_guard_rejects_other_loopback_ports():
    import socket
    from unittest.mock import Mock

    import pytest

    sock = Mock(family=socket.AF_INET)
    runner.network_guard(12345, "socket.connect", (sock, ("127.0.0.1", 12345)))
    with pytest.raises(OSError):
        runner.network_guard(12345, "socket.connect", (sock, ("127.0.0.1", 8000)))


def test_temporary_root_ignores_ambient_path(monkeypatch, tmp_path):
    from unittest.mock import Mock

    import pytest

    binary = tmp_path / "surreal"
    binary.write_bytes(b"public synthetic stand-in")
    binary.chmod(0o700)
    monkeypatch.setattr(
        runner.hashlib, "sha256", lambda _: Mock(hexdigest=lambda: runner.SHA256)
    )
    monkeypatch.setenv("TMPDIR", "/private-do-not-use")
    monkeypatch.setattr(
        runner.sys,
        "argv",
        ["runner", "--surreal-binary", str(binary), "--tiktoken-cache", str(tmp_path)],
    )
    temporary = Mock(side_effect=RuntimeError("stop before temp allocation"))
    monkeypatch.setattr(runner.tempfile, "TemporaryDirectory", temporary)
    with pytest.raises(RuntimeError, match="stop before temp allocation"):
        runner.main()
    temporary.assert_called_once_with(prefix="historical-db-", dir="/tmp")


def test_sigterm_during_readiness_cleans_owned_database(monkeypatch, tmp_path):
    _termination_harness(monkeypatch, tmp_path, "readiness")


def test_sigterm_while_waiting_cleans_test_child_and_database(monkeypatch, tmp_path):
    _termination_harness(monkeypatch, tmp_path, "pytest")


def test_normal_test_exit_uses_owned_cleanup(monkeypatch, tmp_path):
    _termination_harness(monkeypatch, tmp_path, "success")


def _termination_harness(monkeypatch, tmp_path, phase):
    import signal
    from unittest.mock import Mock

    import pytest

    binary = tmp_path / "surreal"
    binary.write_bytes(b"synthetic binary")
    binary.chmod(0o700)
    monkeypatch.setattr(
        runner.hashlib, "sha256", lambda _: Mock(hexdigest=lambda: runner.SHA256)
    )
    monkeypatch.setattr(
        runner.sys,
        "argv",
        ["runner", "--surreal-binary", str(binary), "--tiktoken-cache", str(tmp_path)],
    )
    monkeypatch.setattr(runner, "prepare_cache", Mock())
    reservation = Mock()
    reservation.__enter__ = Mock(return_value=reservation)
    reservation.__exit__ = Mock(return_value=False)
    reservation.getsockname.return_value = ("127.0.0.1", 12345)
    monkeypatch.setattr(runner.socket, "socket", Mock(return_value=reservation))
    previous = signal.getsignal(signal.SIGTERM)
    database = Mock(closed=False)
    child = Mock(closed=False)
    created: list[Mock] = []
    launches = []

    def start(*args, **kwargs):
        assert callable(signal.getsignal(signal.SIGTERM))
        assert signal.getsignal(signal.SIGTERM) is not previous
        launches.append((args[0], kwargs))
        proc = database if not created else child
        created.append(proc)
        return proc

    def terminate(*args, **kwargs):
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        handler(signal.SIGTERM, None)
        pytest.fail("SIGTERM handler did not unwind")

    def cleanup(processes):
        assert processes == created
        assert signal.getsignal(signal.SIGTERM) == signal.SIG_IGN
        for process in processes:
            process.closed = True

    monkeypatch.setattr(runner.lifecycle, "start_owned", start)
    monkeypatch.setattr(
        runner.lifecycle, "require_owned_listener", Mock(return_value=True)
    )
    monkeypatch.setattr(
        runner.lifecycle,
        "wait_for_service",
        terminate if phase == "readiness" else Mock(),
    )
    if phase == "success":
        child.poll.return_value = 0
    else:
        child.poll.side_effect = terminate
    stop = Mock(side_effect=cleanup)
    monkeypatch.setattr(runner.lifecycle, "stop_processes", stop)
    if phase == "success":
        assert runner.main() == 0
    else:
        with pytest.raises(SystemExit) as result:
            runner.main()
        assert result.value.code == 128 + signal.SIGTERM
    assert signal.getsignal(signal.SIGTERM) is previous
    assert created == ([database] if phase == "readiness" else [database, child])
    assert all(proc.closed for proc in created)
    stop.assert_called_once()
    return launches


def test_sigterm_during_spawn_defers_until_owned_registration(monkeypatch):
    import signal
    from unittest.mock import Mock

    import pytest

    process = Mock(closed=True)
    previous = signal.getsignal(signal.SIGTERM)

    def start(*args, **kwargs):
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        handler(signal.SIGTERM, None)
        return process

    monkeypatch.setattr(runner.lifecycle, "start_owned", start)
    stop = Mock()
    monkeypatch.setattr(runner.lifecycle, "stop_processes", stop)
    with pytest.raises(SystemExit) as result:
        with runner.owned_processes() as processes:
            runner.start_registered(processes, ["public-synthetic-child"])
    assert result.value.code == 128 + signal.SIGTERM
    stop.assert_called_once_with([process])
    assert signal.getsignal(signal.SIGTERM) is previous


def test_cleanup_failure_still_restores_original_handler(monkeypatch):
    import signal
    from unittest.mock import Mock

    import pytest

    previous = signal.getsignal(signal.SIGTERM)
    monkeypatch.setattr(
        runner.lifecycle,
        "stop_processes",
        Mock(side_effect=RuntimeError("identity changed")),
    )
    with pytest.raises(RuntimeError, match="identity changed"):
        with runner.owned_processes():
            pass
    assert signal.getsignal(signal.SIGTERM) is previous


def test_each_run_has_private_matching_password_without_command_line_leak(
    monkeypatch, tmp_path, capsys
):
    from pathlib import Path

    monkeypatch.setenv("SURREAL_PASSWORD", "ambient-client")
    monkeypatch.setenv("SURREAL_PASS", "ambient-server")
    monkeypatch.setenv("TMPDIR", "/private-do-not-use")
    passwords = []
    for _ in range(2):
        database, child = _termination_harness(monkeypatch, tmp_path, "success")
        database_args, database_options = database
        child_args, child_options = child
        env = child_options["env"]
        password = env["SURREAL_PASSWORD"]
        passwords.append(password)
        assert password not in {"synthetic", "ambient-client", "ambient-server"}
        assert len(password) >= 32
        assert database_options["env"] == {
            "PATH": "/usr/bin:/bin",
            "HOME": str(database_options["cwd"]),
            "SURREAL_PASS": password,
        }
        assert "--pass" not in database_args
        assert "--password" not in database_args
        assert password not in " ".join(database_args + child_args)
        assert database_args[-1] == "memory"
        assert database_args[database_args.index("--bind") + 1] == "127.0.0.1:12345"
        run = Path(database_options["cwd"])
        assert Path(env["TMPDIR"]) == run / "tmp"
        assert Path(env["HOME"]) == run / "home"
        assert not run.exists()  # Owned temporary directory removed after cleanup.
        assert "SURREAL_PASS" not in env
    assert passwords[0] != passwords[1]
    output = capsys.readouterr()
    assert all(password not in output.out + output.err for password in passwords)


def test_direct_child_rejects_foreign_tmp_before_hooks(monkeypatch, tmp_path):
    import pytest

    marker = tmp_path / "keep"
    marker.write_text("foreign")
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    monkeypatch.setattr(
        runner.sys, "addaudithook", lambda *a: pytest.fail("hook before custody")
    )
    with pytest.raises(ValueError, match="temporary"):
        runner.child_main(12345)
    assert marker.read_text() == "foreign"


def test_child_temporary_custody_matrix(monkeypatch):
    import tempfile
    from pathlib import Path

    import pytest

    assert hasattr(runner, "validate_child_temporary")
    with tempfile.TemporaryDirectory(prefix="historical-db-", dir="/tmp") as root:
        root = Path(root)
        scratch = root / "tmp"
        scratch.mkdir(mode=0o700)
        monkeypatch.setenv("TMPDIR", str(scratch))
        assert runner.validate_child_temporary() == scratch
        scratch.chmod(0o777)
        with pytest.raises(ValueError):
            runner.validate_child_temporary()
        scratch.chmod(0o700)
        root.chmod(0o755)
        with pytest.raises(ValueError):
            runner.validate_child_temporary()
        root.chmod(0o700)
        scratch.rmdir()
        other = root / "foreign"
        other.mkdir()
        marker = other / "keep"
        marker.write_text("foreign")
        scratch.symlink_to(other, target_is_directory=True)
        with pytest.raises(ValueError):
            runner.validate_child_temporary()
        assert marker.read_text() == "foreign"
        scratch.unlink()
        monkeypatch.setenv("TMPDIR", str(root / "nested" / "tmp"))
        with pytest.raises(ValueError):
            runner.validate_child_temporary()
        monkeypatch.delenv("TMPDIR")
        with pytest.raises(ValueError):
            runner.validate_child_temporary()


def test_real_allocator_and_normal_child_environment_under_permissive_umask(
    monkeypatch,
):
    import os
    import tempfile
    from pathlib import Path

    old = os.umask(0)
    try:
        with tempfile.TemporaryDirectory(
            prefix="historical-db-", dir="/tmp"
        ) as directory:
            root = Path(directory)
            env = runner.build_test_environment(root, {}, "ws://127.0.0.1:12345/rpc")
            monkeypatch.setenv("TMPDIR", env["TMPDIR"])
            assert root.stat().st_mode & 0o777 == 0o700
            assert runner.validate_child_temporary() == root / "tmp"
    finally:
        os.umask(old)
    assert not root.exists()
