"""Test isolation regressions use only synthetic configuration, never host secrets."""

import os
import runpy
from pathlib import Path


def test_default_conftest_and_application_import_do_not_load_dotenv(
    tmp_path, monkeypatch
):
    import dotenv

    root = Path(__file__).resolve().parents[1]
    fixture = tmp_path / "synthetic-repo"
    (fixture / "tests").mkdir(parents=True)
    poison = fixture / ".env"
    poison.write_text("OFFLINE_SYNTHETIC_POISON=must-not-load\n")
    copied = fixture / "tests/conftest.py"
    copied.write_text((root / "tests/conftest.py").read_text())
    monkeypatch.delenv("OFFLINE_SYNTHETIC_POISON", raising=False)
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "0")
    monkeypatch.setattr(dotenv, "find_dotenv", lambda *a, **kw: str(poison))
    # Restore conftest's intentional sys.path and auth changes after this probe.
    monkeypatch.syspath_prepend(str(root))
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic")
    monkeypatch.setenv("STUDY_WORKBENCH_PRIVATE_MODE", "1")
    runpy.run_path(str(copied))
    assert "OFFLINE_SYNTHETIC_POISON" not in os.environ
    # This is the loader used at api.main import time, even when already cached.
    assert dotenv.load_dotenv(poison) is False
    assert os.environ["PYTHON_DOTENV_DISABLED"] == "1"
    assert os.environ["OPEN_NOTEBOOK_PASSWORD"] == ""
    assert os.environ["STUDY_WORKBENCH_PRIVATE_MODE"] == "0"


def test_runner_environment_discards_credentials_and_live_opt_ins(tmp_path):
    from scripts.offline_pytest import build_environment

    inherited = dict.fromkeys(
        (
            "OPENAI_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "SURREAL_URL",
            "SURREAL_PASSWORD_FILE",
            "AUTH_TEST_SURREAL_URL",
            "WEB_DISCOVERY_TEST_DB",
            "STUDY_WORKBENCH_TEST_SURREAL",
            "EMBEDDING_DISPOSABLE_DB",
            "STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE",
            "PYTEST_ADDOPTS",
            "PYTHONPATH",
            "HTTPS_PROXY",
            "NODE_OPTIONS",
            "PYTHON_DOTENV_DISABLED",
        ),
        "synthetic-poison",
    )
    inherited["PATH"] = "/synthetic/bin"
    env = build_environment(tmp_path, inherited)
    assert env["PATH"] == "/synthetic/bin"
    assert env["PYTHON_DOTENV_DISABLED"] == "1"
    assert env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] == "1"
    assert not (set(inherited) - {"PATH", "PYTHON_DOTENV_DISABLED"}) & env.keys()
    for key in (
        "HOME",
        "OPEN_NOTEBOOK_DATA_DIR",
        "STUDY_WORKBENCH_DATA_DIR",
        "STUDY_WORKBENCH_RUNTIME_DIR",
        "NOTEBOOKLM_HOME",
        "NOTEBOOKLM_STORAGE_PATH",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_DATA_HOME",
        "TMPDIR",
    ):
        assert Path(env[key]).is_relative_to(tmp_path)


def test_runner_cache_rejects_missing_or_poison_data(tmp_path):
    import pytest

    from scripts.offline_pytest import CACHE_FILE, prepare_cache

    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    with pytest.raises(ValueError, match="Prepare it separately"):
        prepare_cache(source, target)
    (source / CACHE_FILE).write_bytes(b"synthetic-not-token-data")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        prepare_cache(source, target)
    assert not target.exists()


def test_network_tripwire_blocks_dns_and_inet_without_making_connections():
    import socket
    from types import SimpleNamespace

    import pytest

    from scripts.offline_pytest import network_guard

    for event in ("getaddrinfo", "gethostbyname", "gethostbyaddr", "getnameinfo"):
        with pytest.raises(socket.gaierror, match="Network disabled"):
            network_guard(f"socket.{event}", ())
    for family in (socket.AF_INET, socket.AF_INET6):
        for event in ("connect", "bind", "sendto"):
            with pytest.raises(OSError, match="Network disabled"):
                network_guard(f"socket.{event}", (SimpleNamespace(family=family),))
    network_guard("socket.connect", (SimpleNamespace(family=socket.AF_UNIX),))


def test_fresh_application_import_cannot_load_synthetic_dotenv(tmp_path):
    import subprocess
    import sys

    from scripts.offline_pytest import ROOT, build_environment

    poison = tmp_path / ".env"
    poison.write_text("OFFLINE_SYNTHETIC_POISON=must-not-load\n")
    env = build_environment(tmp_path / "run", {})
    env["TIKTOKEN_CACHE_DIR"] = os.environ["TIKTOKEN_CACHE_DIR"]
    env["PYTHON_DOTENV_DISABLED"] = "0"
    code = """
import os, runpy, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from scripts.offline_pytest import network_guard
sys.addaudithook(network_guard)
import dotenv.main
dotenv.main.find_dotenv = lambda *a, **kw: sys.argv[2]
runpy.run_path(str(Path(sys.argv[1]) / "tests/conftest.py"))
import api.main
assert "OFFLINE_SYNTHETIC_POISON" not in os.environ
assert os.environ["PYTHON_DOTENV_DISABLED"] == "1"
assert Path(api.main.__file__).resolve() == Path(sys.argv[1]) / "api/main.py"
"""
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(ROOT), str(poison)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_cache_is_copied_only_after_hash_verification(tmp_path, monkeypatch):
    import hashlib

    from scripts import offline_pytest

    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    payload = b"synthetic-cache-fixture"
    original = source / offline_pytest.CACHE_FILE
    original.write_bytes(payload)
    monkeypatch.setattr(
        offline_pytest, "CACHE_SHA256", hashlib.sha256(payload).hexdigest()
    )
    offline_pytest.prepare_cache(source, target)
    (target / offline_pytest.CACHE_FILE).write_bytes(b"changed-copy")
    assert original.read_bytes() == payload


def test_runner_child_installs_network_tripwire(tmp_path):
    import subprocess
    import sys

    from scripts.offline_pytest import ROOT, build_environment

    probe = tmp_path / "test_guard_probe.py"
    probe.write_text("""
import socket
import sys
from types import SimpleNamespace
import pytest

def test_installed_guard():
    # Emit audit events only; never perform DNS, connect or bind operations.
    with pytest.raises(socket.gaierror, match="Network disabled"):
        sys.audit("socket.getaddrinfo", "synthetic.invalid", 443, 0, 0, 0)
    with pytest.raises(OSError, match="Network disabled"):
        sys.audit("socket.connect", SimpleNamespace(family=socket.AF_INET), ("127.0.0.1", 1))
""")
    env = build_environment(tmp_path / "run", {})
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            str(ROOT / "scripts/offline_pytest.py"),
            "--_child",
            str(probe),
            "-q",
            "-p",
            "no:cacheprovider",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"Offline test source: {ROOT}" in result.stdout
    assert "1 passed" in result.stdout
