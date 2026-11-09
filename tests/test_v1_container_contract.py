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
    assert manifest()["volumes"] == {"personal": {}, "upstream": {}, "database": {}}
    assert checker.validate(manifest(), ROOT) == []
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/v1/container_check.py"), "--static"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "Static PASS" in result.stdout
    assert "NOT RUN" in result.stdout


VOLUME_CONTRACT_ERROR = (
    "Data volumes must be exactly personal, upstream and database with empty "
    "project-scoped definitions; custom volume configuration is unsupported"
)


@pytest.mark.parametrize("name", ["personal", "upstream", "database"])
@pytest.mark.parametrize(
    "definition",
    [
        pytest.param({"external": True}, id="external"),
        pytest.param({"external": False}, id="explicit-nonexternal"),
        pytest.param({"name": "do-not-print-me"}, id="explicit-name"),
        pytest.param({"driver": "local"}, id="explicit-driver"),
        pytest.param(
            {
                "driver": "local",
                "driver_opts": {
                    "type": "none",
                    "o": "bind",
                    "device": "/do-not-print-me",
                },
            },
            id="host-bind",
        ),
        pytest.param(
            {
                "driver": "local",
                "driver_opts": {
                    "type": "nfs",
                    "o": "addr=do-not-print-me,rw",
                    "device": ":/data",
                },
            },
            id="nfs",
        ),
        pytest.param({"driver_opts": {}}, id="empty-driver-options"),
        pytest.param({"labels": {"purpose": "do-not-print-me"}}, id="labels"),
        pytest.param({"unknown": "do-not-print-me"}, id="unknown-option"),
        pytest.param(None, id="null"),
        pytest.param([], id="empty-list"),
        pytest.param(["do-not-print-me"], id="list"),
        pytest.param("do-not-print-me", id="string"),
        pytest.param(True, id="boolean"),
        pytest.param(0, id="number"),
    ],
)
def test_volume_definitions_reject_customization_and_malformed_shapes(name, definition):
    checker = module("scripts/v1/container_check.py")
    data = manifest()
    data["volumes"][name] = definition
    errors = checker.validate(data, ROOT)
    assert errors == [VOLUME_CONTRACT_ERROR]
    assert "do-not-print-me" not in str(errors)


@pytest.mark.parametrize(
    "volumes",
    [
        pytest.param(None, id="null"),
        pytest.param([], id="empty-list"),
        pytest.param(["personal", "upstream", "database"], id="names-list"),
        pytest.param("do-not-print-me", id="string"),
        pytest.param(True, id="boolean"),
        pytest.param(42, id="number"),
        pytest.param({}, id="empty-map"),
        pytest.param({"personal": {}, "upstream": {}}, id="missing-volume"),
        pytest.param(
            {"personal": {}, "upstream": {}, "database": {}, "do-not-print-me": {}},
            id="extra-volume",
        ),
    ],
)
def test_volume_mapping_rejects_wrong_names_and_malformed_shapes(volumes):
    checker = module("scripts/v1/container_check.py")
    data = manifest()
    data["volumes"] = volumes
    errors = checker.validate(data, ROOT)
    assert errors == [VOLUME_CONTRACT_ERROR]
    assert "do-not-print-me" not in str(errors)


def test_volume_mapping_is_required():
    checker = module("scripts/v1/container_check.py")
    data = manifest()
    del data["volumes"]
    assert checker.validate(data, ROOT) == [VOLUME_CONTRACT_ERROR]


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
        services["web"]["ports"] = ["3000:3000"]
    elif mutation == "backend_image":
        services["worker"]["image"] = "wrong:latest"
    elif mutation == "backend_build":
        services["worker"]["build"]["target"] = "wrong"
    elif mutation == "root":
        services["worker"]["user"] = "0:0"
    elif mutation == "secret_value":
        services["api"]["environment"]["SURREAL_PASSWORD"] = "do-not-print-me"
    elif mutation == "frontend_secret":
        services["web"]["secrets"] = ["db_password"]
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
@pytest.mark.parametrize("auth_mode", [None, "legacy_password", "device_sessions"])
def test_file_secrets_and_exec_command(entry, valid_env, role, auth_mode):
    if auth_mode is not None:
        valid_env["STUDY_WORKBENCH_AUTH_MODE"] = auth_mode
    original = dict(valid_env)
    command, env = entry.prepare(role, valid_env)
    assert valid_env == original
    assert env["SURREAL_PASSWORD"] == "a-secure-test-password"
    if role == "api" and auth_mode == "device_sessions":
        assert (
            env["OPEN_NOTEBOOK_PASSWORD_FILE"]
            == original["OPEN_NOTEBOOK_PASSWORD_FILE"]
        )
        assert "OPEN_NOTEBOOK_PASSWORD" not in env
        assert {key for key in env if key.endswith("_FILE")} == {
            "OPEN_NOTEBOOK_PASSWORD_FILE"
        }
    else:
        assert not any(key.endswith("_FILE") for key in env)
        if role != "db":
            assert env["OPEN_NOTEBOOK_PASSWORD"] == "a-secure-test-access-password"
    if role != "db":
        assert env["OPEN_NOTEBOOK_ENCRYPTION_KEY"] == "a-secure-test-encryption-key"
        assert env["PYTHON_DOTENV_DISABLED"] == "1"
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


@pytest.mark.parametrize("auth_mode", ["", "unknown", " DEVICE_SESSIONS "])
def test_api_rejects_explicit_invalid_auth_mode(entry, valid_env, auth_mode):
    valid_env["STUDY_WORKBENCH_AUTH_MODE"] = auth_mode
    with pytest.raises(ValueError, match="STUDY_WORKBENCH_AUTH_MODE") as exc:
        entry.prepare("api", valid_env)
    assert "a-secure-test" not in str(exc.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["replace", "remove", "empty", "invalid_utf8"])
async def test_device_api_provider_observes_password_file_changes(
    entry, valid_env, tmp_path, change
):
    from api.device_session_credentials import StrictPasswordProvider
    from api.device_session_models import AuthError

    valid_env["STUDY_WORKBENCH_AUTH_MODE"] = "device_sessions"
    _, env = entry.prepare("api", valid_env)
    provider = StrictPasswordProvider.from_environment(env)
    original = "a-secure-test-access-password"
    assert await provider.read() == original
    secret = Path(valid_env["OPEN_NOTEBOOK_PASSWORD_FILE"])
    if change == "replace":
        replacement = tmp_path / "replacement-password"
        replacement.write_text("changed-test-access-password\n")
        replacement.replace(secret)
        assert await provider.read() == "changed-test-access-password"
    else:
        if change == "remove":
            secret.unlink()
        elif change == "empty":
            secret.write_text(" \n")
        else:
            secret.write_bytes(b"\xff")
        with pytest.raises(AuthError) as exc:
            await provider.read()
        assert exc.value.code == "AUTH_UNAVAILABLE"
        assert original not in str(exc.value)
    secret.write_text(original + "\n")
    assert await provider.read() == original


@pytest.mark.parametrize("password", ["", "do-not-print-me"])
def test_device_api_rejects_plaintext_password_even_with_file(
    entry, valid_env, password
):
    valid_env["STUDY_WORKBENCH_AUTH_MODE"] = "device_sessions"
    valid_env["OPEN_NOTEBOOK_PASSWORD"] = password
    with pytest.raises(ValueError, match="require file-only configuration") as exc:
        entry.prepare("api", valid_env)
    assert "do-not-print-me" not in str(exc.value)


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
        "invalid_utf8",
        "oversized",
        "bad_url",
        "bad_data",
        "bad_tasks",
        "runtime_download",
    ],
)
@pytest.mark.parametrize(
    "role,auth_mode,secret_name",
    [
        ("worker", None, "SURREAL_PASSWORD"),
        ("api", "device_sessions", "OPEN_NOTEBOOK_PASSWORD"),
    ],
)
def test_entrypoint_fail_closed_without_secret_disclosure(
    entry, valid_env, tmp_path, case, role, auth_mode, secret_name
):
    if auth_mode is not None:
        valid_env["STUDY_WORKBENCH_AUTH_MODE"] = auth_mode
    file_key = secret_name + "_FILE"
    secret = Path(valid_env[file_key])
    if case == "missing":
        del valid_env[file_key]
    elif case == "empty":
        secret.write_text(" \n")
    elif case == "directory":
        valid_env[file_key] = str(tmp_path)
    elif case == "nonexistent":
        secret.unlink()
    elif case == "conflict":
        valid_env[secret_name] = "do-not-print-me"
    elif case == "placeholder":
        secret.write_text("root")
    elif case == "nul":
        secret.write_bytes(b"secret\x00value")
    elif case == "invalid_utf8":
        secret.write_bytes(b"\xff")
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
        entry.prepare(role, valid_env)
    assert "do-not-print-me" not in str(exc.value)
    assert "a-secure-test" not in str(exc.value)


def test_invalid_role_is_rejected(entry, valid_env):
    with pytest.raises(ValueError):
        entry.prepare("shell", valid_env)


@pytest.mark.parametrize("auth_mode", ["legacy_password", "device_sessions"])
def test_main_execs_without_shell(entry, valid_env, monkeypatch, auth_mode):
    valid_env["STUDY_WORKBENCH_AUTH_MODE"] = auth_mode
    captured = []
    monkeypatch.setattr(entry.os, "environ", valid_env)
    monkeypatch.setattr(entry.os, "execve", lambda *args: captured.append(args))
    assert entry.main(["api"]) == 0
    assert captured[0][0] == captured[0][1][0]
    assert captured[0][2]["SURREAL_USER"] == "operator"
    if auth_mode == "device_sessions":
        assert "OPEN_NOTEBOOK_PASSWORD" not in captured[0][2]
        assert (
            captured[0][2]["OPEN_NOTEBOOK_PASSWORD_FILE"]
            == valid_env["OPEN_NOTEBOOK_PASSWORD_FILE"]
        )


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
        (".dockerignore", "**/*.secret", "# removed secret protection"),
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
            "INTERNAL_API_URL=http://api:5055",
            "INTERNAL_API_URL=http://wrong:5055",
        ),
        (
            "deploy/v1/Dockerfile.frontend",
            "COPY contracts/v1/openapi.json /app/contracts/v1/openapi.json",
            "# missing public build contract",
        ),
        (
            "frontend/next.config.ts",
            'output: "standalone",',
            'output: "standalone", rewrites: async () => [],',
        ),
        (
            "frontend/src/app/api/[...path]/route.ts",
            "export const runtime = 'nodejs'",
            "export const runtime = 'edge'",
        ),
        ("deploy/v1/entrypoint.py", "import os", "# pip install package\nimport os"),
    ],
)
def test_build_artifact_mutations_are_rejected(tmp_path, path, old, new):
    checker = module("scripts/v1/container_check.py")
    for name in [
        ".dockerignore",
        "deploy/v1/Dockerfile.backend",
        "deploy/v1/Dockerfile.web",
        "deploy/v1/Dockerfile.bff",
        "deploy/v1/web-gateway.conf",
        "deploy/v1/bff-proxy.conf",
        "deploy/v1/THIRD_PARTY_NOTICES.md",
        "deploy/v1/Dockerfile.frontend",
        "deploy/v1/entrypoint.py",
        "deploy/v1/env.example",
        "docs/v1/DOCKER_MIGRATION.md",
        "frontend/next.config.ts",
        "frontend/src/app/api/[...path]/route.ts",
        "contracts/v1/openapi.json",
    ]:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((ROOT / name).read_text())
    assert checker.validate(manifest(), tmp_path) == []
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
    frontend_origin = manifest()["services"]["bff"]["environment"][
        "STUDY_WORKBENCH_WEB_ORIGIN"
    ]
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


def test_secret_suffix_is_required_at_root_and_nested_build_context_paths():
    checker = module("scripts/v1/container_check.py")
    # Docker's ** matches zero or more directories: operator.secret and
    # frontend/nested/operator.secret must both be excluded from the context.
    assert "**/*.secret" in checker.IGNORE_PATTERNS
    assert "**/*.secret" in (ROOT / ".dockerignore").read_text().splitlines()


@pytest.mark.parametrize("filename", ["Dockerfile", "deploy/v1/Dockerfile.frontend"])
def test_frontend_builders_copy_exact_public_contract(filename):
    builder = (ROOT / filename).read_text().split("RUN npm run build", 1)[0]
    assert "COPY contracts/v1/openapi.json /app/contracts/v1/openapi.json" in builder
    assert "COPY contracts/ " not in builder
    assert "COPY . " not in builder
