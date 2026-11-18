"""SPA artifact verification over disposable data; no runtime or network."""

import json
import os

import pytest
from spa_artifact_check_support import checker


def test_web_source_verifier_binds_shared_locale_only(tmp_path, monkeypatch):
    check = checker()
    source = "frontend/src/lib/locales/en-US/index.ts"
    wrapper = "apps/web/src/i18n/locales/index.ts"
    files = (source, wrapper, "frontend/src/app/unrelated.ts", "apps/bff/src/cli.ts")
    for name in files:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("// fixture source")

    def catalog(*args):
        assert args[:3] == ("ls-files", "-z", "--")
        return "\0".join(
            name
            for name in files
            if any(name == root or name.startswith(root + "/") for root in args[3:])
        )

    monkeypatch.setattr(check, "ROOT", tmp_path)
    monkeypatch.setattr(check, "git", catalog)
    web = check.source_inventory("web")
    bff = check.source_inventory("bff")
    assert [row["path"] for row in web] == [wrapper, source]
    assert [row["path"] for row in bff] == ["apps/bff/src/cli.ts"]
    (tmp_path / source).write_text("// changed canonical locale")
    assert check.digest(check.source_inventory("web")) != check.digest(web)
    assert check.source_inventory("bff") == bff


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


def test_independent_bff_parser_never_evaluates_module_source(tmp_path):
    check, root, contract = synthetic(tmp_path, "bff")

    def refresh():
        receipt = check.load_json(root / "artifact-inventory.json")
        receipt["assets"] = check.inventory(root)
        manifest = check.load_json(root / "spa-artifact-manifest.json")
        manifest["asset_digest"] = check.digest(receipt["assets"])
        (root / "artifact-inventory.json").write_text(check.canonical(receipt) + "\n")
        (root / "spa-artifact-manifest.json").write_text(
            check.canonical(manifest) + "\n"
        )

    (root / "server.js").write_text(
        "import {AsyncLocalStorage} from 'node:async_hooks'; const routes=[['POST','/import'],['GET','/x']]; throw Error('must-not-execute');"
    )
    refresh()
    check.verify(root, "bff", contract, source=False)
    for code in [
        "export {x} from 'next';",
        "import 'node:child_process';",
        "const x = import /* comment */ ('next');",
    ]:
        (root / "server.js").write_text(code)
        refresh()
        with pytest.raises(ValueError):
            check.verify(root, "bff", contract, source=False)


@pytest.mark.parametrize(
    "code",
    [
        "const later = import // ordinary line comment\n('next');",
        "const later = import /* first */ // second\r\n /* third */ ('react');",
        "const later = import // line\u2028('next');",
        "const later = import // line\u2029('next');",
        "const later = import \ufeff /* space */ ('next');",
        "const later = `template ${import // line\n('next')}`;",
        "const later = require // line\n('next');",
        "const later = require /* comment */ ('next');",
        "const load = r\\u0065quire; load('next');",
        "const load = \\u{72}equire; load('next');",
        "const later = require?.('next');",
        "const later = (require)('next');",
        "const later = module.require // line\n('next');",
        "const later = eval // line\n('1');",
        "const later = (0,eval)('1');",
        "const later = e\\u0076al /* comment */ ('1');",
        "const later = Function // line\n('return 1')();",
        "const later = new Function /* comment */ ('return 1');",
        "const later = globalThis['Function']('return 1');",
        "const later = createRequire // line\n(import.meta.url)('next');",
        "importScripts // line\n('next');",
    ],
)
def test_fix1_loader_variants_fail_closed_without_evaluation(tmp_path, code):
    check, root, contract = synthetic(tmp_path, "bff")
    (root / "server.js").write_text(code)
    receipt = check.load_json(root / "artifact-inventory.json")
    receipt["assets"] = check.inventory(root)
    manifest = check.load_json(root / "spa-artifact-manifest.json")
    manifest["asset_digest"] = check.digest(receipt["assets"])
    (root / "artifact-inventory.json").write_text(check.canonical(receipt) + "\n")
    (root / "spa-artifact-manifest.json").write_text(check.canonical(manifest) + "\n")
    with pytest.raises(ValueError, match="dependency|loader"):
        check.verify(root, "bff", contract, source=False)
