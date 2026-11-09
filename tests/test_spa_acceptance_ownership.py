"""C2 tooling tests only. Temporary synthetic files never become acceptance evidence."""

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def helper():
    path = ROOT / "scripts/v1/spa_acceptance.py"
    assert path.is_file(), "Inert C2 ownership/evidence helper is missing"
    spec = importlib.util.spec_from_file_location("spa_acceptance", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_import_is_inert(monkeypatch):
    import socket
    import subprocess

    def forbidden(*args, **kwargs):
        pytest.fail("Import must not launch, connect, inspect environment or signal")

    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(os, "kill", forbidden)
    monkeypatch.setattr(os, "getenv", forbidden)
    helper()


@pytest.fixture
def synthetic(tmp_path, monkeypatch):
    m = helper()
    source = tmp_path / "source"
    source.mkdir()
    (source / "docs/v1").mkdir(parents=True)
    (source / "docs/v1/SPA_BROWSER_CASES.json").write_bytes(
        (ROOT / "docs/v1/SPA_BROWSER_CASES.json").read_bytes()
    )
    inputs = {}
    for name in ("web", "bff", "gateway"):
        inputs[name] = tmp_path / name
        inputs[name].mkdir()
    fixture = source / "contracts/v1/fixtures/workspace-view-v1.json"
    fixture.parent.mkdir(parents=True)
    fixture.write_text('{"synthetic":true}\n')
    contract = source / "contracts/v1/openapi.json"
    contract.write_text('{"openapi":"3.1.0"}\n')
    identity = {
        "source": {
            "path": str(source),
            "commit": "a" * 40,
            "tree": "b" * 40,
            "device": source.stat().st_dev,
            "inode": source.stat().st_ino,
            "owner": os.getuid(),
        },
        "fixture": {
            "path": str(fixture),
            "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
        },
        "contract": {
            "path": str(contract),
            "sha256": hashlib.sha256(contract.read_bytes()).hexdigest(),
        },
        "web": {
            "root": str(inputs["web"]),
            "slot": "web-synthetic-0001",
            "manifest": {"source_commit": "a" * 40, "asset_digest": "c" * 64},
            "metadata": {"fixture": "c" * 64},
        },
        "bff": {
            "root": str(inputs["bff"]),
            "slot": "bff-synthetic-0001",
            "manifest": {"source_commit": "a" * 40, "asset_digest": "d" * 64},
            "metadata": {"fixture": "d" * 64},
        },
        "gateway": {
            "root": str(inputs["gateway"]),
            "window": {
                "schema_version": "spa-client-window-v1",
                "current": "web-synthetic-0001",
                "retained": ["web-synthetic-0001"],
            },
            "sha256": "e" * 64,
        },
    }
    monkeypatch.setattr(m, "APPROVED_SOURCE_ROOT", source)
    monkeypatch.setattr(m, "APPROVED_RUN_PARENT", tmp_path, raising=False)
    monkeypatch.setattr(m, "PROTECTED_ROOTS", (source, *inputs.values()))
    monkeypatch.setattr(m, "verify_inputs", lambda **kwargs: copy.deepcopy(identity))
    return m, tmp_path, source, fixture, inputs, identity


def prepared(synthetic):
    m, tmp, source, fixture, inputs, _ = synthetic
    result = m.prepare(tmp / "run", str(fixture), source_root=source, **inputs)
    return m, Path(result["manifest"])


def rewrite(path, value):
    path.write_text(json.dumps(value) + "\n")
    path.chmod(0o600)


def test_prepare_inspect_close_never_start_or_delete(synthetic, monkeypatch):
    import shutil
    import socket
    import subprocess

    m = synthetic[0]

    def forbidden(*args, **kwargs):
        pytest.fail("inert lifecycle attempted launch/probe/signal/delete")

    for target, key in [
        (socket, "socket"),
        (subprocess, "Popen"),
        (os, "kill"),
        (os, "killpg"),
        (shutil, "rmtree"),
        (os, "unlink"),
    ]:
        monkeypatch.setattr(target, key, forbidden)
    m, path = prepared(synthetic)
    run = m.inspect(path)
    assert run["runtime_started"] is False and run["phase"] == "prepared"
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    assert m.stop(path)["phase"] == "closed"
    assert m.inspect(path)["phase"] == "closed"
    assert m.stop(path)["phase"] == "closed"
    assert path.exists() and path.parent.exists()


@pytest.mark.parametrize(
    "kind",
    ["existing", "source", "ancestor", "relative", "dotdot", "symlink", "artifact"],
)
def test_unsafe_run_roots_are_rejected(synthetic, kind):
    m, tmp, source, fixture, inputs, _ = synthetic
    paths = {
        "existing": tmp / "exists",
        "source": source / "new",
        "ancestor": tmp,
        "relative": Path("relative"),
        "dotdot": tmp / "foo/../new",
        "symlink": tmp / "link/new",
        "artifact": inputs["web"] / "new",
    }
    (tmp / "exists").mkdir()
    (tmp / "link").symlink_to(tmp, target_is_directory=True)
    with pytest.raises((ValueError, OSError)):
        m.prepare(paths[kind], str(fixture), source_root=source, **inputs)


@pytest.mark.parametrize(
    "change",
    ["runtime_started", "pid", "processes", "phase", "owner", "inode", "unknown"],
)
def test_stop_refuses_claims_and_stale_ownership_without_signals_or_deletion(
    synthetic, monkeypatch, change
):
    import shutil

    m, path = prepared(synthetic)
    run = json.loads(path.read_text())
    if change in {"owner", "inode"}:
        run["root"][change] += 1
    elif change == "runtime_started":
        run[change] = True
    elif change == "phase":
        run[change] = "running"
    else:
        run[change] = [
            {"pid": 99999, "pgrp": 99999, "session": 99999, "start_ticks": 1}
        ]
    rewrite(path, run)
    before = path.read_bytes()

    def forbidden(*args, **kwargs):
        pytest.fail("saved PID/unknown claims must never confer cleanup authority")

    monkeypatch.setattr(os, "kill", forbidden)
    monkeypatch.setattr(os, "killpg", forbidden)
    monkeypatch.setattr(shutil, "rmtree", forbidden)
    monkeypatch.setattr(os, "unlink", forbidden)
    with pytest.raises((ValueError, OSError)):
        m.stop(path)
    assert path.read_bytes() == before and path.parent.exists()


@pytest.mark.parametrize(
    "change",
    [
        "mode",
        "hardlink",
        "symlink",
        "extra",
        "duplicate-key",
        "fixture",
        "artifact",
        "source",
    ],
)
def test_inspect_rejects_drift(synthetic, change):
    m, path = prepared(synthetic)
    if change == "mode":
        path.chmod(0o644)
    elif change == "hardlink":
        os.link(path, path.parent / "linked")
    elif change == "symlink":
        moved = path.with_name("old.json")
        path.rename(moved)
        path.symlink_to(moved)
    elif change == "duplicate-key":
        path.write_text(
            path.read_text().replace('"phase":', '"phase":"closed","phase":')
        )
    elif change == "extra":
        value = json.loads(path.read_text())
        value["secret"] = "not allowed"
        rewrite(path, value)
    else:
        key = {"artifact": "web", "fixture": "fixture", "source": "source"}[change]
        synthetic[5][key][
            "sha256" if key == "fixture" else "commit" if key == "source" else "slot"
        ] = "changed"
    with pytest.raises((ValueError, OSError)):
        m.inspect(path)


def test_prepare_requires_explicit_fixture(synthetic):
    m, tmp, source, _, inputs, _ = synthetic
    with pytest.raises(ValueError, match="fixture"):
        m.prepare(tmp / "run", "", source_root=source, **inputs)
    assert not (tmp / "run").exists()


def test_minimal_environment_ignores_poison(monkeypatch):
    m = helper()
    for name in [
        "OPENAI_API_KEY",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "HTTP_PROXY",
        "GIT_CONFIG",
        "HOME",
    ]:
        monkeypatch.setenv(name, "PRIVATE_SENTINEL")
    env = m.verifier_environment()
    assert "PRIVATE_SENTINEL" not in json.dumps(env)
    assert env["PYTHON_DOTENV_DISABLED"] == "1"
    assert env["GIT_CONFIG_GLOBAL"] == "/dev/null"
    assert env["HOME"] == "/nonexistent"


def test_source_context_rejects_caller_helper_before_subprocess(tmp_path, monkeypatch):
    import subprocess

    m = helper()
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: pytest.fail("unapproved code must not execute"),
    )
    with pytest.raises(ValueError, match="approved"):
        m.verify_source(tmp_path)


def test_fixture_allowlist_and_hash_are_enforced(tmp_path):
    m = helper()
    with pytest.raises(ValueError):
        m.validate_fixture(tmp_path, "elsewhere.json")
    with pytest.raises(ValueError):
        m.validate_fixture(ROOT, str(ROOT / "contracts/v1/openapi.json"))
    assert (
        m.validate_fixture(ROOT, "contracts/v1/fixtures/workspace-view-v1.json")[
            "sha256"
        ]
        == "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423"
    )


def test_catalog_exact_inventory_and_honest_cases():
    m = helper()
    catalog = m.load_catalog(ROOT)
    assert (
        catalog["operation_fingerprint"]
        == "b9fe7af28a5e85aaf628afa49b142b451aa4f985bc5de36c2e2796d3946936f6"
    )
    operations = m.operation_inventory(ROOT)
    assert len(operations) == 446
    assert sum(owner == "B8" for owner in operations.values()) == 172
    assert sum(owner == "B9" for owner in operations.values()) == 129
    for operation, owner in operations.items():
        matches = [
            c
            for c in catalog["cases"]
            if c["id"].startswith(f"C2-{owner}-{operation}--")
        ]
        assert matches and any(c["operation_ids"] == [operation] for c in matches)
        assert all(
            c["preconditions"] and c["actions"] and c["expected"] for c in matches
        )
    ids = [c["id"] for c in catalog["cases"]]
    assert len(ids) == len(set(ids))
    assert all(
        c["initial_status"] in {"not_run", "blocked"} and c["mandatory"]
        for c in catalog["cases"]
    )
    for width in [360, 390, 768, 1024, 1280, 1440, 1920]:
        for locale in ["zh-CN", "en-US"]:
            for theme in ["light", "dark"]:
                assert f"C2-V-{width}-{locale}-{theme}" in ids
    assert "C2-P-provider-live" in ids
    assert "C2-R11-old-tab-window" in ids


def test_summary_cannot_omit_failed_blocked_or_unrun_cases(synthetic, monkeypatch):
    m, path = prepared(synthetic)
    catalog = m.load_catalog(ROOT)
    monkeypatch.setattr(m, "load_catalog", lambda root: catalog)
    result = m.summarize_cases(path, [])
    assert result["complete"] is False
    assert len(result["cases"]) == len(catalog["cases"])
    assert all(c["status"] in {"not_run", "blocked"} for c in result["cases"])
    cid = catalog["cases"][0]["id"]
    result = m.summarize_cases(path, [{"id": cid, "status": "failed", "evidence": []}])
    assert result["cases"][0]["status"] == "failed" and not result["complete"]


@pytest.mark.parametrize(
    "kind", ["duplicate", "unknown", "status", "caller-complete", "passed-empty"]
)
def test_summary_rejects_forged_or_ambiguous_records(synthetic, monkeypatch, kind):
    m, path = prepared(synthetic)
    catalog = m.load_catalog(ROOT)
    monkeypatch.setattr(m, "load_catalog", lambda root: catalog)
    row = {"id": catalog["cases"][0]["id"], "status": "not_run", "evidence": []}
    rows = [row]
    if kind == "duplicate":
        rows.append(row.copy())
    if kind == "unknown":
        row["id"] = "not-in-catalog"
    if kind == "status":
        row["status"] = "success"
    if kind == "caller-complete":
        row["complete"] = True
    if kind == "passed-empty":
        row["status"] = "passed"
    with pytest.raises(ValueError):
        m.summarize_cases(path, rows)


def test_evidence_rejects_unsafe_and_foreign_files(synthetic):
    m, path = prepared(synthetic)
    run = m.inspect(path)
    case = {
        "id": "test",
        "layer": "browser",
        "conditions": {
            "viewport": [1280, 800],
            "locale": "en-US",
            "theme": "light",
            "input": "keyboard",
            "device": "desktop",
            "zoom": 100,
        },
        "required_evidence_types": ["screenshot"],
    }
    root = path.parent
    evidence = {
        "version": "spa-case-evidence-v1",
        "run_id": run["run_id"],
        "case_id": "test",
        "layer": "browser",
        "identities": m.evidence_identities(run),
        "conditions": case["conditions"],
        "evidence_type": "screenshot",
        "outcome": "passed",
        "files": [
            {
                "relative_path": "shot.txt",
                "size": 9,
                "sha256": hashlib.sha256(b"synthetic").hexdigest(),
            }
        ],
    }
    shot = root / "shot.txt"
    shot.write_bytes(b"synthetic")
    shot.chmod(0o600)
    assert m.validate_evidence(evidence, run, case) == "passed"
    for field, value in [
        ("run_id", "foreign"),
        ("layer", "unit"),
        ("case_id", "wrong"),
        ("outcome", "success"),
        ("evidence_type", "unit"),
    ]:
        changed = copy.deepcopy(evidence)
        changed[field] = value
        with pytest.raises(ValueError):
            m.validate_evidence(changed, run, case)
    for relative in ["../shot.txt", str(shot), "a/../shot.txt", ".env", "a\\shot.txt"]:
        changed = copy.deepcopy(evidence)
        changed["files"][0]["relative_path"] = relative
        with pytest.raises(ValueError):
            m.validate_evidence(changed, run, case)
    changed = copy.deepcopy(evidence)
    changed["identities"]["web_slot"] = "foreign"
    with pytest.raises(ValueError):
        m.validate_evidence(changed, run, case)
    shot.write_text("changed")
    with pytest.raises(ValueError):
        m.validate_evidence(evidence, run, case)


def test_unapproved_parent_cannot_be_a_data_or_profile_root(synthetic):
    m, tmp, source, fixture, inputs, _ = synthetic
    data = tmp / "unapproved-data"
    data.mkdir()
    with pytest.raises(ValueError, match="parent"):
        m.prepare(data / "new-run", str(fixture), source_root=source, **inputs)
    assert not (data / "new-run").exists()


@pytest.mark.parametrize(
    "change",
    [
        "wrong-shape",
        "fractional-zoom",
        "unknown-locale",
        "missing-required-kind",
        "no-cases",
        "drop-provider",
        "drop-visual",
    ],
)
def test_catalog_rejects_malformed_conditions_and_missing_external_gates(
    tmp_path, change
):
    m = helper()
    catalog = json.loads((ROOT / "docs/v1/SPA_BROWSER_CASES.json").read_text())
    # Keep the reviewed fingerprint: these are catalog payload/schema failures.
    if change == "wrong-shape":
        catalog["cases"][0]["conditions"]["viewport"] = "1280"
    if change == "fractional-zoom":
        catalog["cases"][0]["conditions"]["zoom"] = 1.5
    if change == "unknown-locale":
        catalog["cases"][0]["conditions"]["locale"] = "invented"
    if change == "missing-required-kind":
        catalog["cases"][0]["required_evidence_types"] = ["arbitrary"]
    if change == "no-cases":
        catalog["cases"] = []
    if change == "drop-provider":
        catalog["cases"] = [
            c for c in catalog["cases"] if c["id"] != "C2-P-provider-live"
        ]
    if change == "drop-visual":
        catalog["cases"] = [
            c for c in catalog["cases"] if c["id"] != "C2-V-390-zh-CN-dark"
        ]
    for name in [
        "docs/v1/SPA_BROWSER_CASES.json",
        "apps/web/src/app/route-coverage.ts",
    ]:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((ROOT / name).read_bytes())
    (tmp_path / "docs/v1/SPA_BROWSER_CASES.json").write_text(json.dumps(catalog))
    with pytest.raises(ValueError):
        m.load_catalog(tmp_path)


def test_evidence_schema_does_not_allow_claimed_producer_truth(synthetic, monkeypatch):
    m, path = prepared(synthetic)
    catalog = m.load_catalog(ROOT)
    monkeypatch.setattr(m, "load_catalog", lambda root: catalog)
    run = m.inspect(path)
    c = catalog["cases"][0]
    result = {"id": c["id"], "status": "passed", "evidence": []}
    for number, kind in enumerate(c["required_evidence_types"]):
        payload = path.parent / f"observation-{number}.txt"
        payload.write_bytes(b"caller-authored synthetic claim")
        payload.chmod(0o600)
        record = {
            "version": "spa-case-evidence-v1",
            "run_id": run["run_id"],
            "case_id": c["id"],
            "layer": c["layer"],
            "identities": m.evidence_identities(run),
            "conditions": c["conditions"],
            "evidence_type": kind,
            "outcome": "passed",
            "files": [
                {
                    "relative_path": payload.name,
                    "size": payload.stat().st_size,
                    "sha256": hashlib.sha256(payload.read_bytes()).hexdigest(),
                }
            ],
        }
        evidence = path.parent / f"record-{number}.json"
        rewrite(evidence, record)
        result["evidence"].append(evidence.name)
    with pytest.raises(ValueError, match="Never-started"):
        m.summarize_cases(path, [result])


@pytest.mark.parametrize(
    "kind",
    [
        "symlink",
        "hardlink",
        "fifo",
        "foreign-owner",
        "wrong-size",
        "wrong-hash",
        "duplicate",
        "wrong-condition",
    ],
)
def test_evidence_file_custody(synthetic, monkeypatch, kind):
    m, path = prepared(synthetic)
    run = m.inspect(path)
    c = {
        "id": "fixture",
        "layer": "browser",
        "required_evidence_types": ["interaction-record"],
        "conditions": {},
    }
    payload = path.parent / "payload.txt"
    payload.write_bytes(b"fixture")
    payload.chmod(0o600)
    record = {
        "version": "spa-case-evidence-v1",
        "run_id": run["run_id"],
        "case_id": "fixture",
        "layer": "browser",
        "identities": m.evidence_identities(run),
        "conditions": {},
        "evidence_type": "interaction-record",
        "outcome": "failed",
        "files": [
            {
                "relative_path": "payload.txt",
                "size": 7,
                "sha256": hashlib.sha256(b"fixture").hexdigest(),
            }
        ],
    }
    if kind == "symlink":
        payload.rename(path.parent / "original.txt")
        payload.symlink_to(path.parent / "original.txt")
    if kind == "hardlink":
        os.link(payload, path.parent / "linked.txt")
    if kind == "fifo":
        payload.unlink()
        os.mkfifo(payload, 0o600)
    if kind == "foreign-owner":
        monkeypatch.setattr(m.os, "getuid", lambda: -1)
    if kind == "wrong-size":
        record["files"][0]["size"] = 8
    if kind == "wrong-hash":
        record["files"][0]["sha256"] = "0" * 64
    if kind == "duplicate":
        record["files"].append(record["files"][0].copy())
    if kind == "wrong-condition":
        record["conditions"] = {"zoom": 200}
    with pytest.raises((ValueError, OSError)):
        m.validate_evidence(record, run, c)


def test_incomplete_private_publication_is_retained_and_blocks_close(
    synthetic, monkeypatch
):
    m, tmp, source, fixture, inputs, _ = synthetic

    def fail(*args, **kwargs):
        raise OSError("synthetic publication failure")

    monkeypatch.setattr(m.os, "replace", fail)
    with pytest.raises(OSError):
        m.prepare(tmp / "run", str(fixture), source_root=source, **inputs)
    assert (tmp / "run").exists() and list((tmp / "run").iterdir())
    with pytest.raises((ValueError, OSError)):
        m.stop(tmp / "run/manifest.json")


@pytest.mark.parametrize(
    "identity_key",
    [
        "source_commit",
        "api_commit",
        "web_digest",
        "bff_digest",
        "web_slot",
        "bff_slot",
        "contract_digest",
        "fixture_digest",
        "gateway_digest",
        "catalog_digest",
    ],
)
def test_every_evidence_identity_is_frozen(synthetic, identity_key):
    m, path = prepared(synthetic)
    run = m.inspect(path)
    case = {
        "id": "fixture",
        "layer": "runtime",
        "conditions": {},
        "required_evidence_types": ["request-ledger"],
    }
    file = path.parent / "ledger.txt"
    file.write_bytes(b"synthetic")
    file.chmod(0o600)
    value = {
        "version": "spa-case-evidence-v1",
        "run_id": run["run_id"],
        "case_id": "fixture",
        "layer": "runtime",
        "conditions": {},
        "identities": m.evidence_identities(run),
        "evidence_type": "request-ledger",
        "outcome": "failed",
        "files": [
            {
                "relative_path": file.name,
                "size": 9,
                "sha256": hashlib.sha256(b"synthetic").hexdigest(),
            }
        ],
    }
    value["identities"][identity_key] = "foreign"
    with pytest.raises(ValueError, match="identity mismatch"):
        m.validate_evidence(value, run, case)


def test_conflicting_producer_outcome_cannot_be_summarized(synthetic, monkeypatch):
    m, path = prepared(synthetic)
    catalog = m.load_catalog(ROOT)
    monkeypatch.setattr(m, "load_catalog", lambda root: catalog)
    run = m.inspect(path)
    case = catalog["cases"][0]
    payload = path.parent / "ledger.txt"
    payload.write_bytes(b"synthetic")
    payload.chmod(0o600)
    value = {
        "version": "spa-case-evidence-v1",
        "run_id": run["run_id"],
        "case_id": case["id"],
        "layer": case["layer"],
        "conditions": case["conditions"],
        "identities": m.evidence_identities(run),
        "evidence_type": case["required_evidence_types"][0],
        "outcome": "failed",
        "files": [
            {
                "relative_path": payload.name,
                "size": 9,
                "sha256": hashlib.sha256(b"synthetic").hexdigest(),
            }
        ],
    }
    rewrite(path.parent / "evidence.json", value)
    with pytest.raises(ValueError, match="Conflicting"):
        m.summarize_cases(
            path,
            [{"id": case["id"], "status": "blocked", "evidence": ["evidence.json"]}],
        )


def test_fixture_rejects_changed_allowlisted_bytes(tmp_path):
    m = helper()
    p = tmp_path / m.FIXTURE
    p.parent.mkdir(parents=True)
    p.write_bytes((ROOT / m.FIXTURE).read_bytes() + b" ")
    with pytest.raises(ValueError, match="fixture identity"):
        m.validate_fixture(tmp_path, m.FIXTURE)


def test_unavailable_or_modified_approved_source_cannot_run_node(tmp_path, monkeypatch):
    import subprocess

    m = helper()
    monkeypatch.setattr(m, "ROOT", tmp_path)
    monkeypatch.setattr(m, "APPROVED_SOURCE_ROOT", tmp_path)
    for name in m.REVIEWED_HELPERS:
        file = tmp_path / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes((ROOT / name).read_bytes())
    changed = tmp_path / next(iter(m.REVIEWED_HELPERS))
    changed.write_bytes(changed.read_bytes() + b"\n// modified\n")
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **k: pytest.fail(
            "changed helper must be rejected before any subprocess"
        ),
    )
    with pytest.raises(ValueError, match="Reviewed verifier changed"):
        m.verify_source(tmp_path)
