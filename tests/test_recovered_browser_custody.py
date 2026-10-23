"""Offline/synthetic child tests only; never launches application or browser."""

import subprocess
import sys
from pathlib import Path

import pytest

from scripts.v1.browser_check import browser_launch_options, validate_firefox_executable
from scripts.v1.local_check import build_fixture_environment

ROOT = Path(__file__).resolve().parents[1]


def test_firefox_explicit_and_environment(tmp_path):
    exe = tmp_path / "firefox"
    exe.write_text("synthetic executable, not launched")
    exe.chmod(0o700)
    options = browser_launch_options("firefox", tmp_path, exe)
    assert options["executable_path"] == str(exe)
    assert options["env"]["TMPDIR"] == str(tmp_path)
    assert "HTTP_PROXY" not in options["env"]
    assert "MOZ_DISABLE_CONTENT_SANDBOX" not in options["env"]
    with pytest.raises(ValueError):
        browser_launch_options("firefox", tmp_path, None)
    link = tmp_path / "link"
    link.symlink_to(exe)
    with pytest.raises(ValueError):
        validate_firefox_executable(link)
    assert (
        browser_launch_options("chromium", tmp_path, None)["chromium_sandbox"] is True
    )


def test_update_off_and_secret_strip(tmp_path):
    env = build_fixture_environment(
        tmp_path, {"API_KEY": "secret", "HTTP_PROXY": "proxy", "PATH": "/bin"}
    )
    assert env["OPEN_NOTEBOOK_DISABLE_UPDATE_CHECK"] == "1"
    assert "API_KEY" not in env and "HTTP_PROXY" not in env


def run_synthetic(code):
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_detached_child_drained_with_grace(tmp_path):
    receipt = tmp_path / "term"
    code = (
        f"""
import os, signal, subprocess, sys, time
from scripts.v1.browser_ownership import BrowserSubreaper, _empty, _subreaper
with BrowserSubreaper(grace=.1):
    p = subprocess.Popen([sys.executable, '-c', """
        + repr(f"""import os,signal,time
os.setsid()
def stop(*_):
 open({str(receipt)!r},'w').write('TERM')
 raise SystemExit
signal.signal(signal.SIGTERM,stop)
deadline=time.monotonic()+2
while time.monotonic()<deadline: time.sleep(.01)
""")
        + """])
    time.sleep(.15)
assert _empty()
assert _subreaper() == 0
"""
    )
    result = run_synthetic(code)
    assert result.returncode == 0, result.stderr
    assert receipt.read_text() == "TERM"


def test_preexisting_child_rejected_and_not_killed():
    result = run_synthetic("""
import subprocess,sys
from scripts.v1.browser_ownership import BrowserSubreaper
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(10)'])
try:
 try: BrowserSubreaper().__enter__()
 except RuntimeError: pass
 else: raise AssertionError('preexisting child accepted')
 assert p.poll() is None
finally:
 p.terminate();p.wait()
""")
    assert result.returncode == 0, result.stderr


def test_ignoring_child_escalated():
    result = run_synthetic("""
import subprocess,sys,time
from scripts.v1.browser_ownership import BrowserSubreaper,_empty
with BrowserSubreaper(grace=.1):
 p=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(10)'])
 time.sleep(.15)
assert _empty()
""")
    assert result.returncode == 0, result.stderr


def test_timeout_keeps_custody():
    result = run_synthetic("""
import subprocess,sys,time
from scripts.v1.browser_ownership import BrowserSubreaper,_subreaper
c=BrowserSubreaper(timeout=0)
c.__enter__()
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(10)'])
try:
 try: c.__exit__(None,None,None)
 except RuntimeError: pass
 else: raise AssertionError('timeout accepted')
 assert _subreaper()==1 and p.poll() is None
finally:
 p.terminate();p.wait();c.timeout=1;c.__exit__(None,None,None)
""")
    assert result.returncode == 0, result.stderr


def test_cleanup_failure_preserves_state_and_checks_other_boundaries(
    monkeypatch, tmp_path
):
    from types import SimpleNamespace

    from scripts.v1 import local_check

    events = []

    def failed_stop(_):
        events.append("stop")
        raise RuntimeError("synthetic stop uncertainty")

    monkeypatch.setattr(local_check, "stop_processes", failed_stop)
    monkeypatch.setattr(
        local_check, "require_free_ports", lambda _: events.append("ports")
    )
    custody = SimpleNamespace(__exit__=lambda *_: events.append("drain"))
    copies = SimpleNamespace(remove_after_drain=lambda: events.append("delete"))
    with pytest.raises(BaseExceptionGroup):
        local_check.finish_owned_run(
            [],
            custody,
            (1, 2, 3),
            copies,
            tmp_path,
            None,
            lambda: events.append("artifact"),
        )
    assert events == ["stop", "drain", "ports", "artifact"]


def test_cleanup_success_removes_only_owned_profile(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from scripts.v1 import local_check

    events = []
    target = tmp_path / "browser-temp"
    target.mkdir()
    identity = (target.stat().st_dev, target.stat().st_ino)
    foreign = tmp_path / "evidence"
    foreign.mkdir()
    monkeypatch.setattr(local_check, "stop_processes", lambda _: events.append("stop"))
    monkeypatch.setattr(
        local_check, "require_free_ports", lambda _: events.append("ports")
    )
    custody = SimpleNamespace(__exit__=lambda *_: events.append("drain"))
    copies = SimpleNamespace(remove_after_drain=lambda: events.append("copy-delete"))
    local_check.finish_owned_run(
        [],
        custody,
        (1, 2, 3),
        copies,
        tmp_path,
        identity,
        lambda: events.append("artifact"),
    )
    assert events == ["stop", "drain", "ports", "artifact", "copy-delete"]
    assert not target.exists() and foreign.is_dir()


def test_adopted_double_fork_and_foreign_sibling():
    # The sibling belongs to this test process, not the custody subprocess.
    foreign = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(5)"])
    try:
        result = run_synthetic("""
import os,subprocess,sys,time
from scripts.v1.browser_ownership import BrowserSubreaper,_empty
with BrowserSubreaper(grace=.05):
 p=subprocess.Popen([sys.executable,'-c', 'import os,time;pid=os.fork();os._exit(0) if pid else None;os.setsid();time.sleep(2)'])
 p.wait(timeout=2)
 time.sleep(.1)
assert _empty()
""")
        assert result.returncode == 0, result.stderr
        assert foreign.poll() is None
    finally:
        foreign.terminate()
        foreign.wait(timeout=3)


def test_profile_replacement_not_deleted(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from scripts.v1 import local_check

    target = tmp_path / "browser-temp"
    target.mkdir()
    identity = (target.stat().st_dev, target.stat().st_ino)
    target.rename(tmp_path / "original")
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    target.symlink_to(foreign)
    monkeypatch.setattr(local_check, "stop_processes", lambda _: None)
    monkeypatch.setattr(local_check, "require_free_ports", lambda _: None)
    with pytest.raises(RuntimeError, match="ownership"):
        local_check.finish_owned_run(
            [],
            None,
            (1, 2, 3),
            SimpleNamespace(remove_after_drain=lambda: None),
            tmp_path,
            identity,
            lambda: None,
        )
    assert foreign.is_dir() and target.is_symlink()


def test_multithreaded_host_rejected_without_changing_subreaper():
    code = """
import threading
from scripts.v1.browser_ownership import BrowserSubreaper, _subreaper
before = _subreaper()
stop = threading.Event()
worker = threading.Thread(target=lambda: stop.wait(5))
worker.start()
try:
    try:
        BrowserSubreaper().__enter__()
    except RuntimeError as error:
        assert 'single thread' in str(error)
    else:
        raise AssertionError('multithreaded custody accepted')
    assert _subreaper() == before
finally:
    stop.set()
    worker.join(timeout=2)
    assert not worker.is_alive()
"""
    result = run_synthetic(code)
    assert result.returncode == 0, result.stderr
