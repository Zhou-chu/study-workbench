"""Isolated default tests; Python network tripwire, NOT an OS sandbox/firewall."""

import argparse
import hashlib
import os
import socket
import subprocess
import sys
import tempfile
from collections.abc import Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE_FILE = "fb374d419588a4632f3f557e76b4b70aebbca790"
CACHE_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"


def network_guard(event: str, args: tuple) -> None:
    """Block Python DNS and IPv4/IPv6 connect/bind/sendto; allow Unix sockets."""
    if event in {
        "socket.getaddrinfo",
        "socket.gethostbyname",
        "socket.gethostbyaddr",
        "socket.getnameinfo",
    }:
        raise socket.gaierror("Network disabled for offline tests (DNS)")
    if (
        event in {"socket.connect", "socket.bind", "socket.sendto"}
        and args
        and getattr(args[0], "family", None) in {socket.AF_INET, socket.AF_INET6}
    ):
        raise OSError("Network disabled for offline tests (INET)")


def build_environment(run: Path, inherited: Mapping[str, str]) -> dict[str, str]:
    """Allowlist process basics, not credentials, pytest options or live opt-ins."""
    env = {
        key: value
        for key, value in inherited.items()
        if key in {"PATH", "LANG", "LC_ALL", "LC_CTYPE", "SYSTEMROOT"}
    }
    for key, relative in {
        "HOME": "home",
        "XDG_CONFIG_HOME": "home/config",
        "XDG_CACHE_HOME": "cache",
        "XDG_DATA_HOME": "home/data",
        "XDG_RUNTIME_DIR": "runtime",
        "TMPDIR": "tmp",
        "OPEN_NOTEBOOK_DATA_DIR": "application",
        "STUDY_WORKBENCH_DATA_DIR": "personal",
        "STUDY_WORKBENCH_RUNTIME_DIR": "runtime",
        "NOTEBOOKLM_HOME": "notebooklm",
        "TIKTOKEN_CACHE_DIR": "tiktoken-cache",
    }.items():
        directory = run / relative
        directory.mkdir(parents=True, exist_ok=True)
        env[key] = str(directory)
    env.update(
        NOTEBOOKLM_STORAGE_PATH=str(run / "notebooklm/storage_state.json"),
        PYTHON_DOTENV_DISABLED="1",
        PYTEST_DISABLE_PLUGIN_AUTOLOAD="1",
        LOGURU_DIAGNOSE="NO",
        TZ="UTC",
    )
    return env


def prepare_cache(source: Path, destination: Path) -> None:
    """Verify the existing o200k_base cache; never download or modify its source."""
    cached = source / CACHE_FILE
    try:
        contents = cached.read_bytes()
    except OSError as exc:
        raise ValueError(
            f"Missing readable o200k_base cache at {cached}. Prepare it separately "
            "in an authorized environment, then pass --tiktoken-cache DIRECTORY. "
            "This runner never downloads dependencies or token data."
        ) from exc
    if hashlib.sha256(contents).hexdigest() != CACHE_SHA256:
        raise ValueError(f"o200k_base cache SHA-256 mismatch: {cached}")
    destination.mkdir(parents=True, exist_ok=True)
    (destination / CACHE_FILE).write_bytes(contents)


def child_main(arguments: list[str]) -> int:
    sys.addaudithook(network_guard)
    # -I ignores ambient PYTHONPATH/user site; candidate wins over editable installs.
    sys.path.insert(0, str(ROOT))
    import pytest

    import open_notebook

    if Path(open_notebook.__file__).resolve().parent != ROOT / "open_notebook":
        raise RuntimeError("Tests resolved a different source checkout")
    print(f"Offline test source: {ROOT}", flush=True)
    return pytest.main(["-p", "pytest_asyncio.plugin", "-p", "pytest_cov", *arguments])


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tiktoken-cache",
        type=Path,
        required=True,
        help="existing verified cache directory",
    )
    options, pytest_args = parser.parse_known_args(arguments)
    if pytest_args[:1] == ["--"]:
        pytest_args = pytest_args[1:]
    with tempfile.TemporaryDirectory(prefix="open-notebook-offline-") as temporary:
        run = Path(temporary)
        env = build_environment(run, os.environ)
        try:
            prepare_cache(
                options.tiktoken_cache.resolve(), Path(env["TIKTOKEN_CACHE_DIR"])
            )
        except ValueError as exc:
            parser.error(str(exc))
        return subprocess.run(
            [
                sys.executable,
                "-I",
                str(Path(__file__).resolve()),
                "--_child",
                *(pytest_args or ["tests/"]),
                "-o",
                f"cache_dir={run / 'pytest-cache'}",
                "--basetemp",
                str(run / "pytest-tmp"),
            ],
            cwd=ROOT,
            env=env,
            check=False,
        ).returncode


# multiprocessing spawn re-imports this file; keep its Python socket tripwire.
if __name__ == "__mp_main__":
    sys.addaudithook(network_guard)

if __name__ == "__main__":
    if sys.argv[1:2] == ["--_child"]:
        raise SystemExit(child_main(sys.argv[2:]))
    raise SystemExit(main())
