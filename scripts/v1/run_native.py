"""Run the unchanged four-tier Open Notebook stack in one native process tree.

Supply a private environment file whose credentials were explicitly authorized.
Nothing in this launcher creates credentials, opens a public listener, or logs in.
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import signal
import socket
import stat
import subprocess
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]


# Deliberately not a denylist: unknown provider credentials, *_FILE, proxy,
# interpreter injection and database auth switches must not enter from the host.
SAFE_INHERITED_ENV = frozenset({"PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM"})
PORTS = (18000, 5055, 13000)


def build_runtime_environment(
    config: Path, inherited_env: Mapping[str, str]
) -> dict[str, str]:
    """Only selected config may supply credentials; no ambient interpolation."""
    return {
        **{k: v for k, v in inherited_env.items() if k in SAFE_INHERITED_ENV},
        **{
            k: v
            for k, v in dotenv_values(config, interpolate=False).items()
            if v is not None
        },
        "PYTHON_DOTENV_DISABLED": "1",
        "LOGURU_DIAGNOSE": "NO",
        "SURREAL_UNAUTHENTICATED": "false",
    }


def is_loopback_host(host: str) -> bool:
    """Recognize numeric browser IPv4 aliases locally, without DNS resolution."""
    host = host.rstrip(".")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        try:
            address = ipaddress.IPv4Address(socket.inet_aton(host))
        except OSError:
            return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped.is_loopback
    return address.is_loopback


def validate_runtime_urls(env: Mapping[str, str], ports: tuple[int, int, int]):
    """A selected native stack must not silently route to a different local store."""
    database, api, frontend = ports
    isolated = ports != PORTS
    targets = [("SURREAL_URL", database), ("INTERNAL_API_URL", api)]
    if isolated:
        targets.extend([("API_URL", frontend), ("CORS_ORIGINS", frontend)])
    for key, port in targets:
        values = env[key].split(",") if key == "CORS_ORIGINS" else [env[key]]
        for value in values:
            try:
                url = urlsplit(value.strip())
                host = url.hostname or ""
                if isolated and key in ("API_URL", "CORS_ORIGINS"):
                    if key == "CORS_ORIGINS" and value.strip() in ("", "*"):
                        continue
                    # Browsers normalize escaped hosts/backslashes differently
                    # from urlsplit; accept only unambiguous HTTP authorities.
                    if (
                        "\\" in value
                        or "%" in url.netloc
                        or not url.netloc.isascii()
                        or url.scheme not in ("http", "https")
                        or not host
                        or url.username is not None
                        or url.password is not None
                    ):
                        raise ValueError
                if is_loopback_host(host) and url.port != port:
                    raise ValueError
                if isolated and key in ("SURREAL_URL", "INTERNAL_API_URL"):
                    expected = (
                        f"ws://127.0.0.1:{database}/rpc"
                        if key == "SURREAL_URL"
                        else f"http://127.0.0.1:{api}"
                    )
                    allowed = (
                        (expected,)
                        if key == "SURREAL_URL"
                        else (expected, expected + "/")
                    )
                    if value not in allowed:
                        raise ValueError
            except ValueError:
                # Never include parsed config values, userinfo or query secrets.
                raise ValueError(
                    "Runtime URLs must match the selected native ports"
                ) from None


def apply_runtime_defaults(
    env: dict[str, str],
    source_root: Path = ROOT,
    *,
    ports: tuple[int, int, int] = PORTS,
) -> Path:
    """Default only known noncredential options, before any storage mutation."""
    database, api, frontend = ports
    defaults = {
        "SURREAL_USER": "root",
        "SURREAL_URL": f"ws://127.0.0.1:{database}/rpc",
        "SURREAL_NAMESPACE": "study_workbench",
        "SURREAL_DATABASE": "study_workbench",
        "STUDY_WORKBENCH_DATA_DIR": str(source_root / ".runtime/data/personal"),
        "STUDY_WORKBENCH_RUNTIME_DIR": str(source_root / ".runtime/data"),
        "INTERNAL_API_URL": f"http://127.0.0.1:{api}",
        "API_URL": f"http://127.0.0.1:{frontend}",
        "CORS_ORIGINS": f"http://127.0.0.1:{frontend}",
    }
    for key, default in defaults.items():
        if not env.get(key, "").strip():
            env[key] = default
    validate_runtime_urls(env, ports)
    runtime = Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]).resolve()
    if source_root.resolve().is_relative_to(runtime):
        raise ValueError("Runtime directory must not be the source root or ancestor")
    env["STUDY_WORKBENCH_RUNTIME_DIR"] = str(runtime)
    if not env.get("OPEN_NOTEBOOK_DATA_DIR", "").strip():
        env["OPEN_NOTEBOOK_DATA_DIR"] = str(runtime / "upstream-data")
    return runtime


def validate_private_config(config: Path, source_root: Path = ROOT) -> Path:
    """Reject links and source-tree secrets before reading any configuration."""
    config = config.absolute()
    if any(part.is_symlink() for part in (config, *config.parents)):
        raise ValueError("Private runtime config must not use symlinks")
    resolved = config.resolve()
    if resolved.is_relative_to(source_root.resolve()):
        raise ValueError("Private runtime config must be outside the source tree")
    info = resolved.stat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise ValueError(
            "Private runtime config must be owner-owned, regular and mode 0600"
        )
    return resolved


def open_private_log(path: Path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
        ):
            raise ValueError("Private runtime log must be an owner-owned regular file")
        os.fchmod(fd, 0o600)
        return os.fdopen(fd, "a")
    except BaseException:
        os.close(fd)
        raise


def wait_for_service(name: str, proc, probe: Callable[[], bool], timeout: float = 120):
    deadline = time.monotonic() + timeout
    while True:
        if proc.poll() is not None:
            raise RuntimeError(f"{name} exited before readiness; inspect private logs")
        if probe():
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(f"{name} readiness timed out; inspect private logs")
        time.sleep(min(0.25, max(0, deadline - time.monotonic())))


def http_ready(url: str) -> bool:
    try:
        # Never send credentials to a probe or inherit a host proxy.
        return httpx.get(url, timeout=1, trust_env=False).status_code == 200
    except httpx.HTTPError:
        return False


def worker_startup_observed(log: Path, offset: int) -> bool:
    with log.open("rb") as handle:
        handle.seek(offset)
        return b"Starting LIVE query listener" in handle.read()


def require_free_ports(ports: tuple[int, int, int] = PORTS):
    for port in ports:
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                raise RuntimeError(
                    "Required loopback port is occupied; no services started"
                ) from None


def verify_loopback_listeners(ports: tuple[int, int, int] = PORTS):
    """Linux native runbook: reject wildcard/non-loopback listeners on our ports."""
    for filename, allowed in (
        ("tcp", "0100007F"),
        ("tcp6", "00000000000000000000000001000000"),
    ):
        for line in Path("/proc/net", filename).read_text().splitlines()[1:]:
            fields = line.split()
            address, port = fields[1].split(":")
            if fields[3] == "0A" and int(port, 16) in ports and address != allowed:
                raise RuntimeError(
                    "Runtime port has a non-loopback listener; stopping owned services"
                )


def stop_processes(processes):
    # A dead npm leader can still have live descendants in its dedicated session.
    for proc in reversed(processes):
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for proc in reversed(processes):
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True)
    p.add_argument("--frontend-dev", action="store_true")
    p.add_argument("--database-port", type=int, default=PORTS[0])
    p.add_argument("--api-port", type=int, default=PORTS[1])
    p.add_argument("--frontend-port", type=int, default=PORTS[2])
    args = p.parse_args()
    ports = (args.database_port, args.api_port, args.frontend_port)
    if len(set(ports)) != 3 or any(not 1 <= port <= 65535 for port in ports):
        p.error("Native ports must be distinct integers between 1 and 65535")
    database, api, frontend = ports
    os.umask(0o077)
    try:
        config = validate_private_config(Path(args.config))
    except (ValueError, OSError):
        raise SystemExit(
            "Private config must be an owner-owned mode-0600 regular file outside source, without symlinks"
        ) from None
    env = build_runtime_environment(config, os.environ)
    for key in (
        "OPEN_NOTEBOOK_PASSWORD",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY",
        "SURREAL_PASSWORD",
    ):
        if not env.get(key) or env[key].startswith(("change-me", "test-only")):
            raise SystemExit(
                "Configure authorized private runtime credentials before starting"
            )
    env["SURREAL_PASS"] = env["SURREAL_PASSWORD"]
    try:
        runtime = apply_runtime_defaults(env, ports=ports)
    except ValueError:
        raise SystemExit(
            "Runtime directory must not be the source root or ancestor; runtime URLs must match the selected native ports"
        ) from None
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    if runtime.stat().st_uid != os.getuid():
        raise SystemExit("Runtime directory must be owned by the current user")
    runtime.chmod(0o700)
    env["STUDY_WORKBENCH_PRIVATE_MODE"] = "1"
    env["PORT"] = str(frontend)
    env["HOSTNAME"] = "127.0.0.1"
    if not args.frontend_dev:
        import shutil

        standalone = ROOT / "frontend/.next/standalone"
        if not standalone.exists():
            raise SystemExit("Build frontend first: cd frontend && npm run build")
        shutil.copytree(
            ROOT / "frontend/.next/static",
            standalone / ".next/static",
            dirs_exist_ok=True,
        )
        if (ROOT / "frontend/public").exists():
            shutil.copytree(
                ROOT / "frontend/public", standalone / "public", dirs_exist_ok=True
            )
    commands = [
        (
            "database",
            [
                str(ROOT / ".runtime/bin/surreal"),
                "start",
                "--bind",
                f"127.0.0.1:{database}",
                "--log",
                "warn",
                "rocksdb:" + str(runtime / "surreal.db"),
            ],
            ROOT,
        ),
        (
            "api",
            [
                str(ROOT / ".venv/bin/python"),
                "-m",
                "uvicorn",
                "api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(api),
            ],
            ROOT,
        ),
        (
            "worker",
            [
                str(ROOT / ".venv/bin/surreal-commands-worker"),
                "--import-modules",
                "commands",
                "--max-tasks",
                "2",
            ],
            ROOT,
        ),
        (
            "frontend",
            [
                "npm",
                "run",
                "dev" if args.frontend_dev else "start",
                "--",
                "--hostname",
                "127.0.0.1",
                "--port",
                str(frontend),
            ],
            ROOT / "frontend",
        ),
    ]
    require_free_ports(ports)
    processes = []
    logs = []

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        for name, cmd, cwd in commands:
            log = runtime / (name + ".log")
            output = open_private_log(log)
            offset = log.stat().st_size
            logs.append(output)
            processes.append(
                subprocess.Popen(
                    cmd,
                    cwd=cwd,
                    env=env,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                    umask=0o077,
                )
            )
            urls = {
                "database": f"http://127.0.0.1:{database}/health",
                "api": f"http://127.0.0.1:{api}/health",
                "frontend": f"http://127.0.0.1:{frontend}/login",
            }
            probe = (
                (lambda: worker_startup_observed(log, offset))
                if name == "worker"
                else (lambda: http_ready(urls[name]))
            )
            wait_for_service(name, processes[-1], probe)
            if any(proc.poll() is not None for proc in processes):
                raise RuntimeError(
                    "A service exited during startup; inspect private logs"
                )
            verify_loopback_listeners(ports)
        print(
            f"Database, API and frontend HTTP checks passed on loopback; worker startup observed (job execution not yet verified). Frontend http://127.0.0.1:{frontend} is local to this process environment, not an external delivery URL.",
            flush=True,
        )
        while all(proc.poll() is None for proc in processes):
            time.sleep(1)
        raise SystemExit(
            "One service stopped. Inspect private runtime logs; automatic provider/Google retries are not performed."
        )
    except KeyboardInterrupt:
        pass
    except (RuntimeError, OSError):
        raise SystemExit(
            "Private runtime startup/health check failed; inspect owner-only logs. No credential values are printed."
        ) from None
    finally:
        stop_processes(processes)
        for output in logs:
            output.close()


if __name__ == "__main__":
    main()
