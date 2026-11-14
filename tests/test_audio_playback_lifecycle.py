"""Owned profile lifecycle only; no actual browser, DB, or HTTP."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def audio(monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / "scripts/v1"))
    monkeypatch.setitem(
        sys.modules,
        "playwright.sync_api",
        SimpleNamespace(expect=None, sync_playwright=None),
    )
    spec = importlib.util.spec_from_file_location(
        "audio_review", root / "scripts/v1/audio_playback_check.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Python 3.11 accepts no delete= keyword. Exercise that API contract even
    # when this focused suite is running under prepared Python 3.12.
    original_temporary_directory = module.tempfile.TemporaryDirectory

    def python311_temporary_directory(
        suffix=None, prefix=None, dir=None, ignore_cleanup_errors=False
    ):
        return original_temporary_directory(
            suffix=suffix,
            prefix=prefix,
            dir=dir,
            ignore_cleanup_errors=ignore_cleanup_errors,
        )

    monkeypatch.setattr(
        module.tempfile, "TemporaryDirectory", python311_temporary_directory
    )
    return module


def test_owned_context_available(audio):
    assert callable(getattr(audio, "owned_audio_context", None))


@pytest.mark.parametrize(
    "failure",
    [None, "launch", "context", "body", "context_close", "browser_close", "stop"],
)
def test_owned_lifecycle_order_and_disk_cleanup(audio, tmp_path, monkeypatch, failure):
    events = []
    profiles = []

    def event(name):
        events.append(name)
        if profiles:
            assert profiles[0].exists()
        if failure == name:
            raise RuntimeError(name)

    class Context:
        def close(self):
            event("context_close")

    class Browser:
        def new_context(self, **kwargs):
            event("context")
            return Context()

        def close(self):
            event("browser_close")

    class Driver:
        def __init__(self):
            self.firefox = self

        def launch(self, **kwargs):
            profile = Path(kwargs["env"]["HOME"])
            profiles.append(profile)
            assert profile.stat().st_mode & 0o777 == 0o700
            assert "OPENAI_API_KEY" not in kwargs["env"]
            (profile / "proof").write_text("owned")
            (profile / "foreign-link").symlink_to(foreign, target_is_directory=True)
            event("launch")
            return Browser()

        def stop(self):
            event("stop")

    driver = Driver()

    def factory():
        return SimpleNamespace(start=lambda: driver)

    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-never-use")
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (foreign / "keep").write_text("untouched")

    def run():
        with audio.owned_audio_context(
            {"PATH": "/usr/bin", "OPENAI_API_KEY": "fake"},
            playwright_factory=factory,
            scratch_parent=tmp_path,
        ):
            event("body")

    if failure:
        with pytest.raises(BaseExceptionGroup) as exc:
            run()
        assert failure in str(exc.value.exceptions)
    else:
        run()
    assert events[-1] == "stop"
    if failure == "stop":
        assert profiles[0].exists()
    else:
        assert not profiles[0].exists()
    assert (foreign / "keep").read_text() == "untouched"
    if "context_close" in events:
        assert (
            events.index("context_close")
            < events.index("browser_close")
            < events.index("stop")
        )


def test_start_failure_retains_profile_and_original_error(audio, tmp_path):
    failure = RuntimeError("driver start failed")

    def start():
        raise failure

    with pytest.raises(ExceptionGroup) as exc:
        with audio.owned_audio_context(
            {},
            playwright_factory=lambda: SimpleNamespace(start=start),
            scratch_parent=tmp_path,
        ):
            pytest.fail("must not yield")
    assert exc.value.exceptions == (failure,)
    profiles = list(tmp_path.iterdir())
    assert len(profiles) == 1 and profiles[0].is_dir()
    assert "retained" in failure.__notes__[0]


@pytest.mark.parametrize("body_error", [RuntimeError, KeyboardInterrupt, SystemExit])
def test_body_and_all_close_errors_are_preserved(audio, tmp_path, body_error):
    failures = [
        RuntimeError(label) for label in ("body", "context", "browser", "driver")
    ]

    failures[0] = body_error("body")

    def fail(index):
        raise failures[index]

    context = SimpleNamespace(close=lambda: fail(1))
    browser = SimpleNamespace(new_context=lambda **kw: context, close=lambda: fail(2))
    driver = SimpleNamespace(
        firefox=SimpleNamespace(launch=lambda **kw: browser), stop=lambda: fail(3)
    )
    with pytest.raises(BaseExceptionGroup) as exc:
        with audio.owned_audio_context(
            {},
            playwright_factory=lambda: SimpleNamespace(start=lambda: driver),
            scratch_parent=tmp_path,
        ):
            raise failures[0]
    assert exc.value.exceptions == tuple(failures)
    assert len(list(tmp_path.iterdir())) == 1


@pytest.mark.parametrize("replacement", ["directory", "symlink"])
def test_cleanup_refuses_replaced_owned_path(audio, tmp_path, replacement):
    original = tmp_path / "owned"
    original.mkdir()
    info = original.lstat()
    identity = (info.st_dev, info.st_ino)
    saved = tmp_path / "saved-owned"
    original.rename(saved)
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (foreign / "keep").write_text("foreign")
    if replacement == "directory":
        original.mkdir()
        (original / "keep").write_text("replacement")
    else:
        original.symlink_to(foreign, target_is_directory=True)
    with pytest.raises(RuntimeError, match="identity changed"):
        audio.cleanup_owned_profile(original, identity)
    assert original.exists() and saved.exists()
    assert (foreign / "keep").read_text() == "foreign"
