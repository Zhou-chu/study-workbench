"""C1 pure file gates. No runtime, image or network acceptance."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def checker():
    path = ROOT / "scripts/v1/check_spa_artifacts.py"
    assert path.is_file(), "Independent Web/BFF validator missing"
    spec = importlib.util.spec_from_file_location("spa_artifacts", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_canonical_and_safe_paths():
    check = checker()
    assert check.digest({"a": 1, "b": 2}) == check.digest({"b": 2, "a": 1})
    for path in (
        "../private",
        "/abs",
        "a//b",
        "a/./b",
        "a\\b",
        ".env",
        "secrets/token",
        "node_modules/x",
        "x.pem",
    ):
        try:
            check.safe_path(path)
        except ValueError:
            pass
        else:
            raise AssertionError("Unsafe path accepted")


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


import json
import os

import pytest


def synthetic(tmp_path, kind):
    check = checker()
    root = tmp_path / kind
    root.mkdir()
    contract = tmp_path / "openapi.json"
    contract.write_text('{"openapi":"synthetic"}')
    authored = [{"path": "source.js", "size": 1, "mode": "0644", "sha256": "a" * 64}]
    identity = {
        "release_slot": "synthetic-release-001",
        "source_commit": "b" * 40,
        "authored_digest": check.digest(authored),
        "contract_digest": __import__("hashlib")
        .sha256(contract.read_bytes())
        .hexdigest(),
        "ui_transport_protocol": 1,
        "supported_contracts": ["workspace-view-v1"],
    }
    (root / "artifact-identity.json").write_text(check.canonical(identity) + "\n")
    if kind == "web":
        (root / "assets").mkdir()
        (root / "assets/app-12345678.js").write_text(
            "const identity=" + json.dumps(identity)
        )
        (root / "index.html").write_text(
            '<script src="/_spa/releases/synthetic-release-001/assets/app-12345678.js"></script>'
        )
    else:
        (root / "package.json").write_text(
            check.canonical({"type": "module", "private": True}) + "\n"
        )
        (root / "cli.js").write_text("import './server.js';")
        (root / "server.js").write_text(
            "import {createServer} from 'node:http'; export {createServer};"
        )
    assets = check.inventory(root)
    manifest = {
        k: identity[k]
        for k in (
            "source_commit",
            "authored_digest",
            "contract_digest",
            "ui_transport_protocol",
            "supported_contracts",
        )
    }
    manifest.update(schema_version="spa-artifact-v1", asset_digest=check.digest(assets))
    receipt = {
        "schema_version": "spa-inventory-v1",
        "kind": kind,
        "release_slot": identity["release_slot"],
        "authored": authored,
        "assets": assets,
    }
    (root / "spa-artifact-manifest.json").write_text(check.canonical(manifest) + "\n")
    (root / "artifact-inventory.json").write_text(check.canonical(receipt) + "\n")
    return check, root, contract


@pytest.mark.parametrize("kind", ["web", "bff"])
@pytest.mark.parametrize(
    "mutation",
    [
        "extra",
        "missing",
        "changed",
        "secret",
        "link",
        "fifo",
        "wrong-contract",
        "wrong-source",
        "malformed",
        "duplicate",
        "mode",
        "traversal",
        "association",
    ],
)
def test_actual_payload_and_schema_fail_closed(tmp_path, kind, mutation):
    check, root, contract = synthetic(tmp_path, kind)
    check.verify(root, kind, contract, source=False)
    leaf = root / ("assets/app-12345678.js" if kind == "web" else "server.js")
    if mutation == "extra":
        (root / "extra.js").write_text("extra")
    elif mutation == "missing":
        leaf.unlink()
    elif mutation == "changed":
        leaf.write_text("changed")
    elif mutation == "secret":
        (root / "operator.secret").write_text("PRIVATE_SENTINEL")
    elif mutation == "link":
        leaf.unlink()
        leaf.symlink_to(contract)
    elif mutation == "fifo":
        leaf.unlink()
        os.mkfifo(leaf)
    elif mutation == "wrong-contract":
        contract.write_text("{}")
    elif mutation == "mode":
        leaf.chmod(0o755)
    elif mutation in {"malformed", "duplicate"}:
        path = root / "spa-artifact-manifest.json"
        if mutation == "duplicate":
            path.write_text(
                path.read_text().replace(
                    '{"', '{"schema_version":"spa-artifact-v1","', 1
                )
            )
        else:
            value = json.loads(path.read_text())
            value["extra"] = True
            path.write_text(check.canonical(value) + "\n")
    elif mutation == "traversal":
        path = root / "artifact-inventory.json"
        value = json.loads(path.read_text())
        value["assets"][0]["path"] = "../outside"
        path.write_text(check.canonical(value) + "\n")
    elif mutation == "association":
        path = root / "artifact-identity.json"
        value = json.loads(path.read_text())
        value["release_slot"] = "different-release-002"
        path.write_text(check.canonical(value) + "\n")
    with pytest.raises((ValueError, OSError)):
        check.verify(root, kind, contract, source=mutation == "wrong-source")


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
