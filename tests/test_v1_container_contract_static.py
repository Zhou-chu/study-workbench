"""Inspect tracked deployment source and authored Docker/Compose declarations."""

import pytest
from container_contract_fixtures import ROOT, manifest, module


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


def test_compose_never_supplies_plaintext_exception():
    for role in ("api", "worker"):
        env = manifest()["services"][role]["environment"]
        assert (
            env["SURREAL_URL"] == "${SURREAL_URL:?Explicit database endpoint required}"
        )
        assert env["SURREAL_INSECURE_ALLOW_URL"] == "${SURREAL_INSECURE_ALLOW_URL:-}"
