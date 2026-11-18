"""Read-only targets for SPA image, CLI and gateway source contracts."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_five_services_and_non_root_gateway():
    import json

    services = json.loads((ROOT / "deploy/v1/compose.yaml").read_text())["services"]
    assert set(services) == {"web", "bff", "api", "worker", "db"}
    assert services["web"]["ports"] == ["127.0.0.1:8502:8080"]
    for name, service in services.items():
        if name != "web":
            assert not service.get("ports")
    for name in ("web", "bff"):
        assert services[name]["read_only"] is True
        assert services[name]["cap_drop"] == ["ALL"]
    assert (
        services["bff"]["environment"]["STUDY_WORKBENCH_BFF_LISTEN_HOST"] == "0.0.0.0"
    )


def test_gateway_preserves_raw_gate_and_never_generic_spa_fallback():
    path = ROOT / "deploy/v1/web-gateway.conf"
    assert path.is_file(), "Fail-closed gateway configuration missing"
    config = path.read_text() + (ROOT / "deploy/v1/bff-proxy.conf").read_text()
    for directive in (
        "$request_uri",
        "proxy_pass http://bff_origin$request_uri;",
        "proxy_buffering off;",
        "proxy_request_buffering off;",
        "proxy_next_upstream off;",
        "proxy_cache off;",
        "listen 8080;",
        "pid /tmp/nginx.pid;",
        "return 404",
        "no-store",
    ):
        assert directive in config
    assert "try_files $uri $uri/ /index.html" not in config
    assert "$host" not in config
    assert "immutable" in config


def test_gateway_leaves_parser_bad_requests_native():
    """Source-policy guard, not nginx execution: empty-URI 400 cannot redirect."""
    config = (ROOT / "deploy/v1/web-gateway.conf").read_text()
    directives = re.findall(r"(?m)^\s*error_page\s+([^;]+);", config)
    for directive in directives:
        statuses = {word for word in directive.split() if word.isdecimal()}
        assert "400" not in statuses, "Parser 400 must not enter an error-page redirect"


def test_gateway_keeps_parsed_bad_targets_on_the_not_found_path():
    """Keep the existing plain 404 policy after separating parser-level 400."""
    config = (ROOT / "deploy/v1/web-gateway.conf").read_text()
    gate = re.search(r"if\s*\(\$bad_target\)\s*\{\s*return\s+(\d+)\s*;\s*}", config)
    assert gate is not None, "Raw-target rejection must remain configured"
    assert gate.group(1) == "404", "Parsed bad targets retain the plain 404 handler"


def test_image_recipes_pin_official_bases_and_keep_standalone_payload():
    node = "node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9"
    nginx = "nginx:1.30.6-trixie@sha256:42c68eab6f7e22611786a9fe1d1c019e275c50185bd54b8f75dc2b9184322703"
    web = ROOT / "deploy/v1/Dockerfile.web"
    bff = ROOT / "deploy/v1/Dockerfile.bff"
    assert web.is_file() and bff.is_file(), "Separate image recipes missing"
    assert node in web.read_text() and node in bff.read_text()
    assert nginx in web.read_text()
    assert 'ENTRYPOINT ["nginx"]' in web.read_text()
    assert "node_modules" not in bff.read_text()
    assert "verifyArtifact" in bff.read_text() and "verifyGateway" in web.read_text()


def test_gateway_supports_real_pdf_modules_and_streamed_large_uploads():
    config = (ROOT / "deploy/v1/web-gateway.conf").read_text()
    assert "application/javascript mjs;" in config
    assert "client_max_body_size 0;" in config
    assert "upstream bff_origin { server bff:3000; }" in config
    assert "proxy_pass http://bff_origin$request_uri;" in config


def test_local_cli_verification_checks_actual_source_and_web_recipe_contract():
    for app in ("web", "bff"):
        cli = (ROOT / f"apps/{app}/scripts/build-manifest.mjs").read_text()
        assert "source:true" in cli
    assert (
        "contracts/v1/openapi.json" in (ROOT / "deploy/v1/Dockerfile.web").read_text()
    )
