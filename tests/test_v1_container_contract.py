"""Offline contract tests; never start Docker or inspect operator secrets."""

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def module(path):
    assert (ROOT / path).is_file(), f"Missing deployment contract: {path}"
    spec = importlib.util.spec_from_file_location(Path(path).stem, ROOT / path)
    assert spec is not None, f"Cannot create module specification: {path}"
    assert spec.loader is not None, f"Missing module loader: {path}"
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def manifest():
    assert (ROOT / "deploy/v1/compose.yaml").is_file()
    # JSON is a YAML 1.2 subset; stdlib parsing keeps this check dependency-free.
    return json.loads((ROOT / "deploy/v1/compose.yaml").read_text())


def test_actual_manifest_and_static_cli():
    checker = module("scripts/v1/container_check.py")
    assert checker.validate(manifest(), ROOT) == []
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/v1/container_check.py"), "--static"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "Static PASS" in result.stdout
    assert "NOT RUN" in result.stdout


@pytest.mark.parametrize(
    "mutation",
    [
        "extra_service",
        "api_port",
        "public_frontend",
        "backend_image",
        "backend_build",
        "root",
        "secret_value",
        "frontend_secret",
        "missing_volume",
        "missing_secret",
        "missing_health_dependency",
        "fake_ready",
        "host_network",
        "privileged",
        "db_version",
    ],
)
def test_rejects_insecure_real_manifest_mutations(mutation):
    checker = module("scripts/v1/container_check.py")
    data = copy.deepcopy(manifest())
    services = data["services"]
    if mutation == "extra_service":
        services["extra"] = {}
    elif mutation == "api_port":
        services["api"]["ports"] = ["5055:5055"]
    elif mutation == "public_frontend":
        services["frontend"]["ports"] = ["3000:3000"]
    elif mutation == "backend_image":
        services["worker"]["image"] = "wrong:latest"
    elif mutation == "backend_build":
        services["worker"]["build"]["target"] = "wrong"
    elif mutation == "root":
        services["worker"]["user"] = "0:0"
    elif mutation == "secret_value":
        services["api"]["environment"]["SURREAL_PASSWORD"] = "do-not-print-me"
    elif mutation == "frontend_secret":
        services["frontend"]["secrets"] = ["db_password"]
    elif mutation == "missing_volume":
        services["worker"]["volumes"] = []
    elif mutation == "missing_secret":
        del data["secrets"]["db_password"]
    elif mutation == "missing_health_dependency":
        services["api"]["depends_on"] = {}
    elif mutation == "fake_ready":
        services["api"]["healthcheck"]["test"] = [
            "CMD",
            "curl",
            "http://localhost:5055/ready",
        ]
    elif mutation == "host_network":
        services["api"]["network_mode"] = "host"
    elif mutation == "privileged":
        services["worker"]["privileged"] = True
    elif mutation == "db_version":
        services["db"]["image"] = "surrealdb/surrealdb:latest"
    errors = checker.validate(data, ROOT)
    assert errors
    assert "do-not-print-me" not in str(errors)


@pytest.fixture
def entry():
    return module("deploy/v1/entrypoint.py")


@pytest.fixture
def valid_env(tmp_path):
    env = {
        "SURREAL_URL": "ws://db:8000/rpc",
        "SURREAL_NAMESPACE": "open_notebook",
        "SURREAL_DATABASE": "open_notebook",
        "STUDY_WORKBENCH_DATA_DIR": "/app/data/personal",
        "OPEN_NOTEBOOK_DATA_DIR": "/app/data/upstream-data",
    }
    for name, value in [
        ("SURREAL_USER", "operator"),
        ("SURREAL_PASSWORD", "a-secure-test-password"),
        ("OPEN_NOTEBOOK_ENCRYPTION_KEY", "a-secure-test-encryption-key"),
        ("OPEN_NOTEBOOK_PASSWORD", "a-secure-test-access-password"),
    ]:
        path = tmp_path / name
        path.write_text(value + "\n")
        env[name + "_FILE"] = str(path)
    return env


@pytest.mark.parametrize("role", ["api", "worker", "db"])
def test_file_secrets_and_exec_command(entry, valid_env, role):
    command, env = entry.prepare(role, valid_env)
    assert env["SURREAL_PASSWORD"] == "a-secure-test-password"
    assert not any(key.endswith("_FILE") for key in env)
    assert not any("a-secure-test" in arg for arg in command)
    assert command[0].startswith("/")
    if role == "api":
        assert "api.main:app" in command
    if role == "worker":
        assert "--import-modules" in command and "commands" in command
    if role == "db":
        assert command == [
            "/usr/local/bin/surreal",
            "start",
            "--bind",
            "0.0.0.0:8000",
            "rocksdb:/app/data/db/database.db",
        ]


@pytest.mark.parametrize(
    "case",
    [
        "missing",
        "empty",
        "directory",
        "nonexistent",
        "conflict",
        "placeholder",
        "nul",
        "oversized",
        "bad_url",
        "bad_data",
        "bad_tasks",
        "runtime_download",
    ],
)
def test_entrypoint_fail_closed_without_secret_disclosure(
    entry, valid_env, tmp_path, case
):
    secret = Path(valid_env["SURREAL_PASSWORD_FILE"])
    if case == "missing":
        del valid_env["SURREAL_PASSWORD_FILE"]
    elif case == "empty":
        secret.write_text(" \n")
    elif case == "directory":
        valid_env["SURREAL_PASSWORD_FILE"] = str(tmp_path)
    elif case == "nonexistent":
        secret.unlink()
    elif case == "conflict":
        valid_env["SURREAL_PASSWORD"] = "do-not-print-me"
    elif case == "placeholder":
        secret.write_text("root")
    elif case == "nul":
        secret.write_bytes(b"secret\x00value")
    elif case == "oversized":
        secret.write_text("x" * 65537)
    elif case == "bad_url":
        valid_env["SURREAL_URL"] = "ws://external:8000/rpc"
    elif case == "bad_data":
        valid_env["OPEN_NOTEBOOK_DATA_DIR"] = "/tmp/shared"
    elif case == "bad_tasks":
        valid_env["OPEN_NOTEBOOK_WORKER_MAX_TASKS"] = "0"
    elif case == "runtime_download":
        valid_env["OPEN_NOTEBOOK_ENABLE_DOCLING"] = "true"
    with pytest.raises(ValueError) as exc:
        entry.prepare("worker", valid_env)
    assert "do-not-print-me" not in str(exc.value)
    assert "a-secure-test" not in str(exc.value)


def test_invalid_role_is_rejected(entry, valid_env):
    with pytest.raises(ValueError):
        entry.prepare("shell", valid_env)


def test_main_execs_without_shell(entry, valid_env, monkeypatch):
    captured = []
    monkeypatch.setattr(entry.os, "environ", valid_env)
    monkeypatch.setattr(entry.os, "execve", lambda *args: captured.append(args))
    assert entry.main(["api"]) == 0
    assert captured[0][0] == captured[0][1][0]
    assert captured[0][2]["SURREAL_USER"] == "operator"


def test_cli_failure_is_sanitized(entry):
    result = subprocess.run(
        [sys.executable, str(ROOT / "deploy/v1/entrypoint.py"), "api"],
        env={"SURREAL_PASSWORD": "do-not-print-me"},
        text=True,
        capture_output=True,
    )
    assert result.returncode == 2
    assert "do-not-print-me" not in result.stderr
    assert "Traceback" not in result.stderr


def test_missing_artifacts_fail_closed(tmp_path):
    checker = module("scripts/v1/container_check.py")
    assert checker.validate(manifest(), tmp_path)


@pytest.mark.parametrize(
    "case", ["environment", "depends_on", "healthcheck", "deploy", "volumes", "secrets"]
)
def test_malformed_structure_returns_redacted_errors(case):
    checker = module("scripts/v1/container_check.py")
    data = manifest()
    if case in {"volumes", "secrets"}:
        data[case] = None
    else:
        data["services"]["api"][case] = ["do-not-print-me"]
    errors = checker.validate(data, ROOT)
    assert errors
    assert "do-not-print-me" not in str(errors)


@pytest.mark.parametrize(
    "path,old,new",
    [
        (".dockerignore", "**/.runtime", "# removed runtime protection"),
        (".dockerignore", "**/node_modules", "!frontend/node_modules"),
        (
            "deploy/v1/Dockerfile.backend",
            "surrealdb/surrealdb:v2.3.10",
            "surrealdb/surrealdb:latest",
        ),
        ("deploy/v1/Dockerfile.backend", "COPY api/ ./api/", "COPY . /app"),
        ("deploy/v1/Dockerfile.backend", "uv sync --frozen", "uv sync"),
        ("deploy/v1/Dockerfile.frontend", "RUN npm ci", "RUN npm install"),
        (
            "deploy/v1/Dockerfile.frontend",
            "ENV INTERNAL_API_URL=http://api:5055 NEXT_TELEMETRY_DISABLED=1",
            "# missing build-time rewrite URL",
        ),
        ("deploy/v1/entrypoint.py", "import os", "# pip install package\nimport os"),
    ],
)
def test_build_artifact_mutations_are_rejected(tmp_path, path, old, new):
    checker = module("scripts/v1/container_check.py")
    for name in [
        ".dockerignore",
        "deploy/v1/Dockerfile.backend",
        "deploy/v1/Dockerfile.frontend",
        "deploy/v1/entrypoint.py",
        "deploy/v1/env.example",
        "docs/v1/DOCKER_MIGRATION.md",
    ]:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((ROOT / name).read_text())
    target = tmp_path / path
    assert old in target.read_text()
    target.write_text(target.read_text().replace(old, new))
    assert checker.validate(manifest(), tmp_path)


def test_unreadable_secret_file_is_sanitized(entry, valid_env, monkeypatch):
    def denied(*args, **kwargs):
        raise PermissionError("do-not-print-me")

    monkeypatch.setattr(entry.Path, "open", denied)
    with pytest.raises(ValueError) as exc:
        entry.prepare("api", valid_env)
    assert "do-not-print-me" not in str(exc.value)


def test_db_env_matches_pinned_cli_and_no_application_keys(entry, valid_env):
    _, env = entry.prepare("db", valid_env)
    assert env["SURREAL_PASS"] == "a-secure-test-password"
    assert not any(key.startswith("OPEN_NOTEBOOK_") for key in env)


def test_explicit_existing_db_username_is_not_a_default(entry, valid_env):
    # Existing root users are migratable; only an explicit file may select one.
    Path(valid_env["SURREAL_USER_FILE"]).write_text("root\n")
    _, env = entry.prepare("api", valid_env)
    assert env["SURREAL_USER"] == "root"


@pytest.mark.parametrize(
    "public_origin", ["http://127.0.0.1:8502", "https://workbench.example"]
)
@pytest.mark.parametrize("foreign", [False, True])
def test_portable_proxy_origin_with_real_security_middleware(
    monkeypatch, public_origin, foreign
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.auth import PasswordAuthMiddleware
    from api.personal_security import PersonalSecurityMiddleware

    # Model Compose's one explicit substitution, without reading operator env/files.
    frontend_origin = manifest()["services"]["frontend"]["environment"]["API_URL"]
    api_cors = manifest()["services"]["api"]["environment"].get("CORS_ORIGINS", "")
    monkeypatch.setenv("CORS_ORIGINS", api_cors.replace(frontend_origin, public_origin))
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "test-deployment-access")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD_FILE", raising=False)
    app = FastAPI()

    @app.post("/api/personal/imports/portable")
    async def upload():
        return {"accepted": True}

    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    # The streaming proxy forwards Origin/auth/content-type, NOT public Host.
    with TestClient(app, base_url="http://api:5055") as client:
        response = client.post(
            "/api/personal/imports/portable",
            headers={
                "Origin": "https://foreign.example" if foreign else public_origin,
                "Authorization": "Bearer test-deployment-access",
                "Content-Type": "multipart/form-data; boundary=test",
            },
            content=b"--test--\r\n",
        )
    assert response.status_code == (403 if foreign else 200)
    if foreign:
        assert response.json()["error"]["code"] == "CROSS_SITE_REQUEST"
    else:
        assert response.json() == {"accepted": True}


@pytest.mark.parametrize(
    "origin", [None, "*", "http://api:5055", "https://foreign.example"]
)
def test_api_cors_must_match_required_public_origin(origin):
    checker = module("scripts/v1/container_check.py")
    data = manifest()
    env = data["services"]["api"]["environment"]
    if origin is None:
        env.pop("CORS_ORIGINS", None)
    else:
        env["CORS_ORIGINS"] = origin
    assert checker.validate(data, ROOT)


def test_backend_runtime_keeps_version_metadata_without_broad_copy():
    source = (ROOT / "deploy/v1/Dockerfile.backend").read_text()
    runtime = source.split("FROM python-base AS backend\n", 1)[1]
    assert "COPY pyproject.toml ./pyproject.toml" in runtime
    assert "COPY . " not in runtime
