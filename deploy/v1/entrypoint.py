"""Fail-closed V1 launch boundary. No dotenv, shell, downloads or secret logging."""

import os
import sys
from pathlib import Path

SECRET_NAMES = (
    "SURREAL_USER",
    "SURREAL_PASSWORD",
    "OPEN_NOTEBOOK_ENCRYPTION_KEY",
    "OPEN_NOTEBOOK_PASSWORD",
)
PLACEHOLDERS = {
    "root",
    "password",
    "secret",
    "changeme",
    "change-me",
    "change-me-to-a-secret-string",
}


def prepare(role, source):
    """Validate a copied environment and return an absolute exec command."""
    if role not in {"api", "worker", "db"}:
        raise ValueError("role must be api, worker or db")
    env = dict(source)
    auth_mode = env.get("STUDY_WORKBENCH_AUTH_MODE", "legacy_password")
    if role == "api" and auth_mode not in {"legacy_password", "device_sessions"}:
        raise ValueError("STUDY_WORKBENCH_AUTH_MODE: invalid authentication mode")
    names = SECRET_NAMES[:2] if role == "db" else SECRET_NAMES
    for name in names:
        file_key = name + "_FILE"
        if name in env or not env.get(file_key):
            raise ValueError(f"{name}: require file-only configuration")
        try:
            path = Path(env[file_key])
            if not path.is_file():
                raise ValueError("not a regular file")
            with path.open("rb") as stream:
                raw = stream.read(65537)
            value = raw.decode("utf-8").rstrip("\r\n")
        except (OSError, UnicodeError, ValueError):
            raise ValueError(f"{name}: unreadable secret file") from None
        if (
            len(raw) > 65536
            or not value.strip()
            or "\x00" in value
            or "\n" in value
            or "\r" in value
            or (name != "SURREAL_USER" and value.strip().lower() in PLACEHOLDERS)
        ):
            raise ValueError(f"{name}: invalid secret file")
        if (
            role == "api"
            and auth_mode == "device_sessions"
            and name == "OPEN_NOTEBOOK_PASSWORD"
        ):
            # Device auth must reread this exclusive source on every operation.
            # Do not replace it with a startup-only plaintext environment value.
            continue
        env[name] = value
        del env[file_key]
    # Reject rather than silently installing opt-in packages at container startup.
    for name in ("OPEN_NOTEBOOK_ENABLE_DOCLING", "OPEN_NOTEBOOK_ENABLE_CRAWL4AI"):
        if env.get(name, "").lower() not in {"", "0", "false", "no"}:
            raise ValueError(f"{name}: runtime installation is disabled")
    if role == "db":
        env["SURREAL_PASS"] = env["SURREAL_PASSWORD"]
        # Do not pass unrelated application keys to the database process.
        for key in list(env):
            if key.endswith("_FILE") or key.startswith("OPEN_NOTEBOOK_"):
                del env[key]
        return [
            "/usr/local/bin/surreal",
            "start",
            "--bind",
            "0.0.0.0:8000",
            "rocksdb:/app/data/db/database.db",
        ], env
    # Resolve only the immutable application root, never the working directory.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from open_notebook.database.connection_url import validate_database_url
    from open_notebook.exceptions import ConfigurationError

    try:
        validate_database_url(
            env.get("SURREAL_URL", ""), env.get("SURREAL_INSECURE_ALLOW_URL", "")
        )
    except ConfigurationError as exc:
        raise ValueError(str(exc)) from None
    for name, expected in {
        "STUDY_WORKBENCH_DATA_DIR": "/app/data/personal",
        "OPEN_NOTEBOOK_DATA_DIR": "/app/data/upstream-data",
    }.items():
        if env.get(name) != expected:
            raise ValueError(f"{name}: invalid deployment location")
    for name in ("SURREAL_NAMESPACE", "SURREAL_DATABASE"):
        if not env.get(name, "").strip():
            raise ValueError(f"{name}: required")
    try:
        tasks = int(env.get("OPEN_NOTEBOOK_WORKER_MAX_TASKS", "5"))
        if not 1 <= tasks <= 32:
            raise ValueError()
    except ValueError:
        raise ValueError("OPEN_NOTEBOOK_WORKER_MAX_TASKS: must be 1..32") from None
    env["PYTHON_DOTENV_DISABLED"] = "1"
    if role == "api":
        command = [
            "/app/.venv/bin/uvicorn",
            "api.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            "5055",
        ]
    else:
        command = [
            "/app/.venv/bin/surreal-commands-worker",
            "--import-modules",
            "commands",
            "--max-tasks",
            str(tasks),
        ]
    return command, env


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    try:
        if len(args) != 1:
            raise ValueError("exactly one role required")
        command, env = prepare(args[0], os.environ)
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    os.execve(command[0], command, env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
