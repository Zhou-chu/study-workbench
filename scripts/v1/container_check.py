"""Offline, fail-closed audit of the checked-in V1 deployment contract.

Compose is deliberately stored in the JSON subset of YAML; no Docker, interpolation,
operator files, dotenv, package downloads or third-party parser is required.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SECRET_MAP = {
    "SURREAL_USER_FILE": "db_user",
    "SURREAL_PASSWORD_FILE": "db_password",
    "OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE": "encryption_key",
    "OPEN_NOTEBOOK_PASSWORD_FILE": "access_password",
}
IGNORE_PATTERNS = {
    "**/.runtime",
    "**/.env*",
    "**/node_modules",
    "**/.next",
    "**/.venv",
    "**/target",
    "**/build",
    "**/dist",
    "**/.git",
    "**/.aws",
    "**/.ssh",
    "**/credentials",
    "**/credentials.*",
    "**/*credentials*.json",
    "**/secrets",
    "**/browser-profile*",
    "**/browser_profile*",
    "**/chrome-profile*",
    "**/playwright-profile*",
    "**/storage_state*.json",
    "**/backups",
    "**/backup",
    "**/*.bak",
    "**/*.sqlite*",
    "**/*.db",
    "**/*.zip",
    "**/*.tar*",
    "**/*.pem",
    "**/*.key",
    "**/*.secret",
}


def validate(data, root=ROOT):
    """Return redacted contract errors, including malformed nested structure."""
    try:
        return _validate(data, root)
    except (TypeError, AttributeError, KeyError):
        return ["Deployment structure malformed"]


def _validate(data, root):
    """Inspect repository artifacts only, never operator configuration values."""
    errors = []

    def require(condition, message):
        if not condition:
            errors.append(message)

    if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
        return ["Compose must define services"]
    require(
        set(data) <= {"name", "services", "volumes", "secrets"},
        "Unsupported top-level deployment setting",
    )
    services = data["services"]
    require(
        set(services) == {"web", "bff", "api", "worker", "db"},
        "Exactly five named services required",
    )
    if not all(
        isinstance(services.get(name), dict)
        for name in ("web", "bff", "api", "worker", "db")
    ):
        return errors + ["Required service mappings missing"]
    api, worker, front, db = (services[name] for name in ("api", "worker", "web", "db"))
    require(
        api.get("image") == worker.get("image") == "study-workbench-backend:v1-local",
        "Backend image must be identical and local",
    )
    expected_build = {
        "context": "../..",
        "dockerfile": "deploy/v1/Dockerfile.backend",
        "target": "backend",
    }
    require(
        api.get("build") == worker.get("build") == expected_build,
        "Backend builds must be identical",
    )
    require(
        db.get("image") == "study-workbench-db:2.3.10-local",
        "DB must use pinned local wrapper image",
    )
    require(
        db.get("build") == {**expected_build, "target": "db"},
        "DB must use minimal wrapper target",
    )
    require(
        front.get("build")
        == {
            "context": "../..",
            "dockerfile": "deploy/v1/Dockerfile.web",
            "target": "web",
        },
        "Frontend build target required",
    )
    require(
        front.get("ports") == ["127.0.0.1:8502:8080"],
        "Frontend publication must be loopback-only",
    )
    require(
        front.get("image") == "study-workbench-web:v1-local",
        "Static Web image required",
    )
    bff = services["bff"]
    require(
        not front.get("environment"), "Static gateway has no runtime credentials/config"
    )
    require(
        bff.get("image") == "study-workbench-bff:v1-local"
        and bff.get("build")
        == {
            "context": "../..",
            "dockerfile": "deploy/v1/Dockerfile.bff",
            "target": "bff",
        },
        "Standalone BFF build required",
    )
    require(
        bff.get("environment")
        == {
            "NODE_ENV": "production",
            "PORT": "3000",
            "STUDY_WORKBENCH_BFF_LISTEN_HOST": "0.0.0.0",
            "STUDY_WORKBENCH_AUTH_MODE": "legacy_password",
            "STUDY_WORKBENCH_WEB_ORIGIN": "${PUBLIC_ORIGIN:?Set frontend origin without trailing slash}",
            "INTERNAL_API_URL": "http://api:5055",
            "STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH": "false",
        },
        "BFF exact production configuration required",
    )
    require(
        not bff.get("secrets") and not bff.get("volumes") and not bff.get("command"),
        "BFF receives no data, secrets or alternate command",
    )
    for name in ("web", "bff"):
        require(
            services[name].get("read_only") is True
            and services[name].get("tmpfs") == ["/tmp:rw,noexec,nosuid,size=64m"],
            name + ": read-only root and scoped tmpfs required",
        )
    require(
        front.get("depends_on") == {"bff": {"condition": "service_started"}},
        "Web orders after its one BFF",
    )
    require(
        not front.get("secrets") and not front.get("volumes"),
        "Frontend must not receive secrets or data",
    )
    require(
        data.get("volumes") == {"personal": {}, "upstream": {}, "database": {}},
        "Data volumes must be exactly personal, upstream and database with empty "
        "project-scoped definitions; custom volume configuration is unsupported",
    )
    secrets = data.get("secrets", {})
    require(
        isinstance(secrets, dict) and set(secrets) == set(SECRET_MAP.values()),
        "Required file secrets missing",
    )
    if isinstance(secrets, dict):
        for config in secrets.values():
            require(
                isinstance(config, dict)
                and set(config) == {"file"}
                and isinstance(config["file"], str)
                and re.fullmatch(r"\$\{[A-Z_]+:\?[^}]+\}", config["file"]) is not None,
                "Secret sources must be required external file variables",
            )
    for name, service in services.items():
        if not isinstance(service, dict):
            errors.append("Service must be a mapping")
            continue
        allowed_keys = {
            "image",
            "build",
            "user",
            "init",
            "restart",
            "environment",
            "secrets",
            "volumes",
            "depends_on",
            "security_opt",
            "cap_drop",
            "command",
            "healthcheck",
        }
        if name in {"web", "bff"}:
            allowed_keys |= {"read_only", "tmpfs"}
        if name == "web":
            allowed_keys.add("ports")
        require(set(service) <= allowed_keys, f"{name}: unsupported service setting")
        require(
            service.get("user")
            == (
                "node"
                if name == "bff"
                else "101:101"
                if name == "web"
                else "10001:10001"
            ),
            f"{name}: explicit non-root identity required",
        )
        require(
            not service.get("privileged")
            and not service.get("network_mode")
            and not service.get("cap_add"),
            f"{name}: privilege or host network forbidden",
        )
        require(
            not service.get("env_file") and not service.get("entrypoint"),
            f"{name}: environment or entrypoint override forbidden",
        )
        require(
            service.get("cap_drop") == ["ALL"]
            and service.get("security_opt") == ["no-new-privileges:true"],
            f"{name}: privilege restrictions required",
        )
        require(
            service.get("deploy", {}).get("replicas", 1) == 1,
            f"{name}: one instance required",
        )
        if name != "web":
            require(not service.get("ports"), f"{name}: host publication forbidden")
        if name not in {"web", "bff"}:
            require(not service.get("ports"), f"{name}: host publication forbidden")
            require(
                service.get("command") == [name],
                f"{name}: checked launch command required",
            )
            env = service.get("environment", {})
            expected_secrets = {
                key: value
                for key, value in SECRET_MAP.items()
                if name != "db" or value in {"db_user", "db_password"}
            }
            require(isinstance(env, dict), f"{name}: environment must be a mapping")
            if isinstance(env, dict):
                allowed = set(expected_secrets)
                if name != "db":
                    allowed |= {
                        "SURREAL_URL",
                        "SURREAL_NAMESPACE",
                        "SURREAL_DATABASE",
                        "STUDY_WORKBENCH_DATA_DIR",
                        "OPEN_NOTEBOOK_DATA_DIR",
                        "PYTHON_DOTENV_DISABLED",
                    }
                if name == "api":
                    allowed.add("CORS_ORIGINS")
                    require(
                        env.get("CORS_ORIGINS")
                        == "${PUBLIC_ORIGIN:?Set frontend origin without trailing slash}",
                        "api: CORS must allow only the required frontend public origin",
                    )
                require(
                    set(env) == allowed,
                    f"{name}: unexpected or missing environment keys",
                )
                for key, secret in expected_secrets.items():
                    require(
                        env.get(key) == "/run/secrets/" + secret,
                        f"{name}: file-secret mapping required",
                    )
            require(
                service.get("secrets") == list(expected_secrets.values()),
                f"{name}: secret grants must match role",
            )
    for name in ("api", "worker"):
        service = services[name]
        require(
            service.get("volumes")
            == ["personal:/app/data/personal", "upstream:/app/data/upstream-data"],
            f"{name}: shared data mounts required",
        )
        env = service.get("environment", {})
        if isinstance(env, dict):
            for key, value in {
                "SURREAL_URL": "ws://db:8000/rpc",
                "SURREAL_NAMESPACE": "open_notebook",
                "SURREAL_DATABASE": "open_notebook",
                "STUDY_WORKBENCH_DATA_DIR": "/app/data/personal",
                "OPEN_NOTEBOOK_DATA_DIR": "/app/data/upstream-data",
                "PYTHON_DOTENV_DISABLED": "1",
            }.items():
                require(
                    env.get(key) == value, f"{name}: invalid deployment environment"
                )
        require(
            service.get("depends_on", {}).get("db") == {"condition": "service_healthy"},
            f"{name}: DB health ordering required",
        )
    for name in ("bff", "worker"):
        require(
            services[name].get("depends_on", {}).get("api")
            == {"condition": "service_healthy"},
            f"{name}: API liveness ordering required",
        )
    require(
        not worker.get("healthcheck"), "Worker health must not be inferred from API"
    )
    require(
        db.get("volumes") == ["database:/app/data/db"],
        "DB needs its separate persistent mount",
    )
    expected_health = {
        "api": [
            "CMD",
            "/usr/local/bin/python",
            "-c",
            "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5055/health', timeout=2).close()",
        ],
        "db": [
            "CMD",
            "/usr/local/bin/surreal",
            "is-ready",
            "--endpoint",
            "http://127.0.0.1:8000",
        ],
    }
    for name, command in expected_health.items():
        health = services[name].get("healthcheck", {})
        require(
            health.get("test") == command
            and health.get("timeout") == "3s"
            and health.get("retries") == 6
            and health.get("interval") == "10s",
            f"{name}: bounded declared probe required (not app readiness)",
        )
    for filename in (
        "deploy/v1/entrypoint.py",
        "deploy/v1/env.example",
        "docs/v1/DOCKER_MIGRATION.md",
    ):
        require((root / filename).is_file(), f"Missing artifact: {filename}")
    try:
        ignores = {
            line.strip()
            for line in (root / ".dockerignore").read_text().splitlines()
            if line.strip() and not line.startswith("#")
        }
        require(
            IGNORE_PATTERNS <= ignores
            and {line for line in ignores if line.startswith("!")}
            == {
                "!apps/web/gateway/dist",
                "!apps/web/gateway/dist/**",
                "!apps/bff/dist",
                "!apps/bff/dist/**",
            },
            "Build context must exclude sensitive paths with only verified artifact roots re-included",
        )
        backend = (root / "deploy/v1/Dockerfile.backend").read_text()
        frontend = (root / "deploy/v1/Dockerfile.frontend").read_text()
        require(
            "FROM surrealdb/surrealdb:v2.3.10 AS surreal" in backend,
            "Pinned SurrealDB binary source required",
        )
        require(
            "uv sync --frozen --no-dev --no-editable" in backend
            and "COPY pyproject.toml uv.lock README.md ./" in backend,
            "Frozen backend lock install required",
        )
        require(
            "RUN npm ci" in frontend and "frontend/package-lock.json" in frontend,
            "Frozen frontend lock install required",
        )
        contract_copy = "COPY contracts/v1/openapi.json /app/contracts/v1/openapi.json"
        require(
            contract_copy in frontend
            and frontend.index(contract_copy) < frontend.index("RUN npm run build")
            and (root / "contracts/v1/openapi.json").is_file(),
            "Exact public OpenAPI build input must be copied before frontend build",
        )
        runtime_stage = frontend.split(" AS frontend\n", 1)[1]
        require(
            re.search(
                r"^ENV[^\n]*\bINTERNAL_API_URL=http://api:5055(?:\s|$)",
                runtime_stage,
                re.M,
            )
            is not None,
            "Runtime frontend backend URL required",
        )
        next_config = (root / "frontend/next.config.ts").read_text()
        route = (root / "frontend/src/app/api/[...path]/route.ts").read_text()
        require(
            not re.search(r"\brewrites\s*(?:\(|:)", next_config)
            and "export const runtime = 'nodejs'" in route
            and "dispatchApiRequest(req)" in route,
            "API forwarding must retain the Node App Route policy, not external rewrites",
        )
        for source in (backend, frontend):
            require(
                not re.search(r"^COPY\s+\.\s", source, re.M),
                "Wildcard root COPY forbidden",
            )
            require(
                not re.search(r":(?:latest|v1-latest)\b", source),
                "Floating latest bases forbidden",
            )
            require(
                not re.search(
                    r"^(?:ARG|ENV).*?(?:PASSWORD|ENCRYPTION|API_KEY|TOKEN=)",
                    source,
                    re.M,
                ),
                "Build-time secrets forbidden",
            )
        node_pin = "node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9"
        nginx_pin = "nginx:1.30.6-trixie@sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703"
        web_recipe = (root / "deploy/v1/Dockerfile.web").read_text()
        bff_recipe = (root / "deploy/v1/Dockerfile.bff").read_text()
        require(
            node_pin in web_recipe
            and node_pin in bff_recipe
            and nginx_pin in web_recipe,
            "Exact official Node/nginx pins required",
        )
        require(
            'ENTRYPOINT ["nginx"]' in web_recipe
            and "USER 101:101" in web_recipe
            and "verifyGateway" in web_recipe,
            "Unprivileged artifact-first gateway required",
        )
        require(
            'ENTRYPOINT ["node", "cli.js"]' in bff_recipe
            and "verifyArtifact" in bff_recipe
            and "node_modules" not in bff_recipe,
            "Standalone verified BFF closure required",
        )
        gateway = (root / "deploy/v1/web-gateway.conf").read_text()
        proxy = (root / "deploy/v1/bff-proxy.conf").read_text()
        require(
            all(
                value in gateway
                for value in (
                    "$request_uri",
                    "upstream bff_origin { server bff:3000; }",
                    "proxy_pass http://bff_origin$request_uri;",
                    "listen 8080;",
                    "pid /tmp/nginx.pid;",
                    "application/javascript mjs;",
                    "client_max_body_size 0;",
                )
            ),
            "Fixed raw-target non-root gateway required",
        )
        require(
            all(
                value in proxy
                for value in (
                    "proxy_buffering off;",
                    "proxy_request_buffering off;",
                    "proxy_cache off;",
                    "proxy_next_upstream off;",
                    "proxy_ignore_client_abort off;",
                )
            ),
            "Unbuffered unreplayed private proxy required",
        )
        require(
            "try_files $uri $uri/ /index.html" not in gateway
            and "$host" not in gateway
            and "$host" not in proxy,
            "Generic SPA fallback or browser Host trust forbidden",
        )
        require(
            (root / "deploy/v1/THIRD_PARTY_NOTICES.md").is_file(),
            "Accompanying third-party notices required",
        )
        entry = (root / "deploy/v1/entrypoint.py").read_text()
        require(
            not re.search(r"(?:pip install|uv sync|npm (?:ci|install)|apt-get)", entry),
            "Runtime package installation forbidden",
        )
    except (OSError, ValueError, IndexError):
        errors.append("Required build artifact missing or malformed")
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--static", action="store_true", required=True)
    parser.parse_args(argv)
    try:
        data = json.loads((ROOT / "deploy/v1/compose.yaml").read_text())
        errors = validate(data)
    except (OSError, ValueError, TypeError, AttributeError):
        errors = ["Deployment structure missing or malformed"]
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(
        "Static PASS. Docker builds/runtime, DNS, permissions, streaming and readiness: NOT RUN."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
