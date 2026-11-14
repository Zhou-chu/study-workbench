import ast
import importlib.util
import os
import stat
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "apps/web/scripts/model-setup-journey-review.py"


@pytest.fixture
def review():
    tree = ast.parse(SCRIPT.read_text())
    assert any(
        isinstance(node, ast.FunctionDef) and node.name == "main" for node in tree.body
    ), "QA script must be import-safe before exercising it"
    spec = importlib.util.spec_from_file_location("model_setup_review", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "run", ["../escape", "/absolute", "a/b", "a\\b", ".", "..", "", "a" * 65]
)
def test_invalid_run_never_creates_files(review, tmp_path, run):
    with pytest.raises(ValueError):
        with review.review_workspace(tmp_path, run):
            pytest.fail("invalid run admitted")
    assert list(tmp_path.iterdir()) == []


def test_private_scratch_separate_from_retained_reports(review, tmp_path, monkeypatch):
    monkeypatch.setenv("TMPDIR", str(tmp_path / "foreign"))
    before = dict(os.environ)
    with review.review_workspace(tmp_path, "matrix-1") as (out, scratch):
        assert out.name == "matrix-1"
        assert out != scratch and not scratch.is_relative_to(out)
        assert scratch.is_relative_to(tmp_path)
        assert stat.S_IMODE(scratch.stat().st_mode) == 0o700
        assert stat.S_IMODE(out.stat().st_mode) == 0o700
        (out / "report.json").write_text("retain")
        (scratch / "private.txt").write_text("remove")
        assert dict(os.environ) == before
    assert not scratch.exists()
    assert (out / "report.json").read_text() == "retain"
    assert not (tmp_path / "foreign").exists()


@pytest.mark.parametrize("kind", ["directory", "file", "symlink"])
def test_existing_report_is_never_reused(review, tmp_path, kind):
    with review.review_workspace(tmp_path, "first") as (out, _):
        parent = out.parent
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    marker = foreign / "keep"
    marker.write_text("untouched")
    destination = parent / "again"
    if kind == "directory":
        destination.mkdir()
    elif kind == "file":
        destination.write_text("existing")
    else:
        destination.symlink_to(foreign, target_is_directory=True)
    with pytest.raises((ValueError, FileExistsError)):
        with review.review_workspace(tmp_path, "again"):
            pytest.fail("preexisting output admitted")
    assert marker.read_text() == "untouched"
    assert destination.exists()


def test_symlink_parent_is_rejected_without_touching_target(review, tmp_path):
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (tmp_path / ".superpowers").symlink_to(foreign, target_is_directory=True)
    with pytest.raises(ValueError):
        with review.review_workspace(tmp_path, "matrix"):
            pytest.fail("symlink parent admitted")
    assert list(foreign.iterdir()) == []


def test_failure_cleans_only_owned_scratch(review, tmp_path):
    with pytest.raises(RuntimeError, match="fixture"):
        with review.review_workspace(tmp_path, "failed") as (out, scratch):
            (out / "evidence.txt").write_text("keep")
            external = tmp_path / "external"
            external.mkdir()
            (external / "keep").write_text("safe")
            (scratch / "link").symlink_to(external, target_is_directory=True)
            raise RuntimeError("fixture")
    assert not scratch.exists()
    assert (out / "evidence.txt").read_text() == "keep"
    assert (external / "keep").read_text() == "safe"


def test_world_writable_root_rejected_without_chmod(review, tmp_path):
    tmp_path.chmod(0o777)
    with pytest.raises(ValueError):
        with review.review_workspace(tmp_path, "matrix"):
            pytest.fail("untrusted root admitted")
    assert stat.S_IMODE(tmp_path.stat().st_mode) == 0o777


def test_environment_uses_scratch_without_mutating_parent(
    review, tmp_path, monkeypatch
):
    monkeypatch.setenv("TMPDIR", "untrusted-temp")
    with review.review_workspace(tmp_path, "env") as (_, scratch):
        env = review.review_environment(scratch)
        assert env["TMPDIR"] == str(scratch / "tmp")
        assert env["XDG_CACHE_HOME"] == str(scratch / "cache")
        assert os.environ["TMPDIR"] == "untrusted-temp"
        assert Path(env["TMPDIR"]).is_dir()


@pytest.mark.parametrize("failure", [False, True])
def test_main_waits_for_child_before_scratch_cleanup(
    review, tmp_path, monkeypatch, failure
):
    monkeypatch.setattr(review, "ROOT", tmp_path)
    monkeypatch.setenv("QA_RUN", "owned-child")
    original_env = dict(os.environ)
    launches = []

    class Child:
        done = False
        terminated = False

        def wait(self):
            assert scratch.exists()
            if failure and not self.terminated:
                raise KeyboardInterrupt()
            self.done = True
            return 7

        def poll(self):
            return 7 if self.done else None

        def terminate(self):
            self.terminated = True

    child = Child()

    def launch(argv, **kwargs):
        nonlocal scratch
        scratch = Path(argv[-1])
        out = Path(argv[-2])
        assert kwargs["env"]["TMPDIR"] == str(scratch / "tmp")
        assert kwargs["cwd"] == tmp_path
        (out / "report.json").write_text("evidence")
        launches.append(out)
        return child

    scratch = None
    monkeypatch.setattr(review.subprocess, "Popen", launch)
    if failure:
        with pytest.raises(KeyboardInterrupt):
            review.main()
        assert child.terminated
    else:
        assert review.main() == 7
    assert child.done and not scratch.exists()
    assert (launches[0] / "report.json").read_text() == "evidence"
    assert dict(os.environ) == original_env


@pytest.mark.parametrize("timeout", [False, True])
def test_preview_stop_confirms_exit(review, monkeypatch, timeout):
    from unittest.mock import Mock

    server = Mock(pid=12345)
    server.poll.return_value = None
    server.wait.side_effect = (
        [review.subprocess.TimeoutExpired("owned", 15), 0] if timeout else [0]
    )
    kill = Mock()
    monkeypatch.setattr(review.os, "killpg", kill)
    review.stop_preview(server)
    assert kill.call_args_list[0].args == (12345, review.signal.SIGTERM)
    assert server.wait.call_args_list[0].kwargs == {"timeout": 15}
    if timeout:
        assert kill.call_args_list[1].args == (12345, review.signal.SIGKILL)
        assert server.wait.call_args_list[1].kwargs == {}


def test_child_checks_paths_and_environment_before_review(
    review, tmp_path, monkeypatch
):
    monkeypatch.setattr(review, "ROOT", tmp_path)
    calls = []
    monkeypatch.setattr(review, "run_review", lambda *args: calls.append(args))
    with review.review_workspace(tmp_path, "child") as (out, scratch):
        env = review.review_environment(scratch)
        with pytest.raises(ValueError, match="environment"):
            review.child_main(out, scratch)
        monkeypatch.setenv("TMPDIR", env["TMPDIR"])
        monkeypatch.setenv("XDG_CACHE_HOME", env["XDG_CACHE_HOME"])
        review.child_main(out, scratch)
        assert calls == [(out, scratch)]
        with pytest.raises(ValueError):
            review.child_main(out, out)
        with pytest.raises(ValueError):
            review.child_main(tmp_path, scratch)


@pytest.mark.parametrize(
    "scenario,credentials,models",
    [
        ("empty", 0, 0),
        ("encryption_blocker", 0, 0),
        ("saved_unregistered", 1, 0),
        ("multiple_pending", 2, 0),
        ("dangling_model", 0, 1),
        ("embedding_only", 1, 1),
        ("environment_model", 0, 1),
        ("registered_not_default", 1, 1),
        ("old_default", 3, 2),
    ],
)
def test_synthetic_state_fixture_shapes(review, scenario, credentials, models):
    state = review.state_for(scenario)
    assert len(state["credentials"]) == credentials
    assert len(state["models"]) == models
    assert "default_chat_model" in state["defaults"]
    assert all("api_key" not in value for value in state["credentials"])


@pytest.mark.parametrize("mask", [0o000, 0o022, 0o077])
def test_private_modes_do_not_depend_on_umask(review, tmp_path, mask):
    previous = os.umask(mask)
    try:
        with review.review_workspace(tmp_path, "permissions") as (out, scratch):
            env = review.review_environment(scratch)
            for path in (
                out,
                scratch,
                Path(env["TMPDIR"]),
                Path(env["XDG_CACHE_HOME"]),
            ):
                assert stat.S_IMODE(path.stat().st_mode) == 0o700
    finally:
        os.umask(previous)


def test_import_does_not_mutate_environment_or_start_processes(tmp_path, monkeypatch):
    import subprocess
    from unittest.mock import Mock

    monkeypatch.setenv("QA_RUN", str(tmp_path / "do-not-create"))
    launch = Mock(side_effect=AssertionError("import must not spawn"))
    monkeypatch.setattr(subprocess, "Popen", launch)
    before = dict(os.environ)
    spec = importlib.util.spec_from_file_location("import_safe_review", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert dict(os.environ) == before
    assert not list(tmp_path.iterdir())
    launch.assert_not_called()


def test_environment_excludes_ambient_secrets_and_injection(
    review, tmp_path, monkeypatch
):
    forbidden = (
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NODE_OPTIONS",
        "GIT_DIR",
        "GIT_CONFIG_COUNT",
        "LD_PRELOAD",
        "PYTHONPATH",
        "QA_UNKNOWN",
    )
    for key in forbidden:
        monkeypatch.setenv(key, "synthetic-untrusted-value")
    monkeypatch.setenv("QA_WIDTHS", "390,1440")
    monkeypatch.setenv("QA_PORT", "18864")
    monkeypatch.setenv("QA_BASELINE", "1")
    original = dict(os.environ)
    with review.review_workspace(tmp_path, "clean-env") as (_, scratch):
        env = review.review_environment(scratch)
        assert not set(forbidden).intersection(env)
        assert env["QA_WIDTHS"] == "390,1440"
        assert env["QA_PORT"] == "18864"
        assert env["QA_BASELINE"] == "1"
        assert env["HOME"] == str(scratch / "home")
        assert Path(env["HOME"]).is_dir()
        assert env["LANG"] == "C.UTF-8"
        assert dict(os.environ) == original


@pytest.mark.parametrize("name", ["tmp", "cache"])
@pytest.mark.parametrize("kind", ["symlink", "file", "writable"])
def test_child_rejects_replaced_scratch_children_before_review(
    review, tmp_path, monkeypatch, name, kind
):
    monkeypatch.setattr(review, "ROOT", tmp_path)
    calls = []
    monkeypatch.setattr(review, "run_review", lambda *args: calls.append(args))
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    marker = foreign / "keep"
    marker.write_text("untouched")
    with review.review_workspace(tmp_path, "child-custody") as (out, scratch):
        env = review.review_environment(scratch)
        monkeypatch.setenv("TMPDIR", env["TMPDIR"])
        monkeypatch.setenv("XDG_CACHE_HOME", env["XDG_CACHE_HOME"])
        target = scratch / name
        if kind == "writable":
            target.chmod(0o777)
        else:
            target.rmdir()
            if kind == "symlink":
                target.symlink_to(foreign, target_is_directory=True)
            else:
                target.write_text("not a directory")
        with pytest.raises(ValueError, match="QA directory"):
            review.child_main(out, scratch)
        assert calls == []
        assert marker.read_text() == "untouched"
    assert marker.read_text() == "untouched"
