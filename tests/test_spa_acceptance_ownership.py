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


def test_mobile_control_cases_have_executable_compact_conditions():
    m = helper()
    cases = m.load_catalog(ROOT)["cases"]
    for operation in (
        "shell.open_mobile_navigation",
        "shell.close_mobile_navigation",
        "workspace.mobile_tabs",
    ):
        primary = next(
            c
            for c in cases
            if c["operation_ids"] == [operation] and c["layer"] == "browser"
        )
        assert primary["conditions"]["viewport"] == [390, 900]
        assert "--compact-en-US-light--browser" in primary["id"]


# Fix 1 regression contracts: these inspect the executable catalog consumed by
# evidence validation, not product reducers or a hash generated by the test.
def catalog_cases():
    return {case["id"]: case for case in helper().load_catalog()["cases"]}


@pytest.mark.parametrize(
    "case_id,viewport,zoom,device",
    [
        ("C2-I-coarse", [360, 800], 100, "actual-phone"),
        ("C2-I-coarse--390-portrait", [390, 844], 100, "actual-phone"),
        ("C2-I-coarse--360-portrait-dark", [360, 800], 100, "actual-phone"),
        ("C2-I-coarse--390-portrait-dark", [390, 844], 100, "actual-phone"),
        ("C2-I-soft-keyboard", [390, 844], 100, "actual-phone"),
        ("C2-I-soft-keyboard--landscape", [844, 390], 100, "actual-phone"),
        ("C2-I-split-tablet", [1024, 768], 100, "actual-tablet-split-view"),
        ("C2-I-split-tablet--compact", [512, 768], 100, "actual-tablet-split-view"),
        ("C2-I-zoom-125", [1280, 800], 125, "desktop"),
        ("C2-I-zoom-125--compact", [390, 720], 125, "desktop"),
        ("C2-I-zoom-200", [1280, 800], 200, "desktop"),
        ("C2-I-zoom-200--compact", [390, 720], 200, "desktop"),
    ],
)
def test_fix1_device_conditions_are_individually_observable(
    case_id, viewport, zoom, device
):
    cases = catalog_cases()
    assert case_id in cases, "Required actual condition has no locatable case"
    case = cases[case_id]
    assert case["conditions"]["viewport"] == viewport
    assert case["conditions"]["zoom"] == zoom
    assert case["conditions"]["device"] == device
    assert case["initial_status"] == "blocked"
    assert "viewport-metrics" in case["required_evidence_types"]
    actions = " ".join(case["actions"]).lower()
    assert "measure" in actions and "css" in actions
    if "zoom" in case_id:
        assert "both compact and wide" not in actions
        assert "actual browser zoom" in actions
    if "soft-keyboard" in case_id or "split-tablet" in case_id:
        assert "transition" in actions
        assert "viewport-transition-record" in case["required_evidence_types"]


@pytest.mark.parametrize("width", [360, 390, 768, 1024, 1280, 1440, 1920])
@pytest.mark.parametrize("locale", ["zh-CN", "en-US"])
@pytest.mark.parametrize("theme", ["light", "dark"])
def test_fix1_rendered_visual_gates_have_measurable_thresholds(width, locale, theme):
    case = catalog_cases()[f"C2-V-{width}-{locale}-{theme}"]
    assertions = " ".join(case["expected"]).lower()
    for criterion in [
        "44x44 css px",
        "body/button text contrast at least 4.5:1",
        "large text at least 3:1",
        "non-text boundaries at least 3:1",
    ]:
        assert criterion in assertions, f"Missing rendered criterion: {criterion}"
    assert "rendered-accessibility-measurements" in case["required_evidence_types"]
    assert "screenshot" in case["required_evidence_types"]
    assert "interaction-record" in case["required_evidence_types"]
    actions = " ".join(case["actions"]).lower()
    assert "rendered" in actions and "measure" in actions
    assert "source token" in " ".join(case["expected"]).lower()


@pytest.mark.parametrize(
    "case_id",
    [
        "C2-I-coarse",
        "C2-I-coarse--390-portrait",
        "C2-I-coarse--360-portrait-dark",
        "C2-I-coarse--390-portrait-dark",
    ],
)
def test_fix1_actual_touch_gates_require_size_and_rendered_contrast(case_id):
    cases = catalog_cases()
    assert case_id in cases
    case = cases[case_id]
    assertions = " ".join(case["expected"]).lower()
    for criterion in ["44x44 css px", "4.5:1", "3:1", "non-text boundaries"]:
        assert criterion in assertions
    assert "rendered-accessibility-measurements" in case["required_evidence_types"]
    assert "device-input-record" in case["required_evidence_types"]


# Literal operation/request expectations derived from the existing API and
# C-RESULTS; no product module is executed or classifier copied here.
B9C_WRITE_CASES = [
    ("settings.save", "PUT /settings", "submitted fields"),
    ("credentials.create", "POST /credentials", "private values cleared"),
    ("credentials.edit", "PUT /credentials/credential-a", "private values cleared"),
    (
        "credentials.test_connection",
        "POST /credentials/credential-a/test",
        "credential-a",
    ),
    (
        "credentials.discover_models",
        "POST /credentials/credential-a/discover",
        "discovery",
    ),
    (
        "credentials.register_selected",
        "POST /credentials/credential-a/register-models",
        "model list",
    ),
    ("credentials.delete_only", "DELETE /credentials/credential-a", "zero-link"),
    (
        "credentials.delete_with_models",
        "DELETE /credentials/credential-a",
        "linked-model",
    ),
    (
        "credentials.migrate_models_to_other_credential",
        "DELETE /credentials/credential-a?migrate_to=credential-b",
        "credential-b",
    ),
    (
        "credentials.migrate_from_env",
        "POST /credentials/migrate-from-env",
        "environment",
    ),
    ("models.test_registered", "POST /models/model-a/test", "model-a"),
    ("models.delete_registered", "DELETE /models/model-a", "default impact"),
    ("models.assign_chat", "PUT /models/defaults", "default_chat_model"),
    ("models.assign_embedding", "PUT /models/defaults", "default_embedding_model"),
    ("models.assign_tts", "PUT /models/defaults", "default_text_to_speech_model"),
    ("models.assign_stt", "PUT /models/defaults", "default_speech_to_text_model"),
    (
        "models.assign_transformation",
        "PUT /models/defaults",
        "default_transformation_model",
    ),
    ("models.assign_tools", "PUT /models/defaults", "default_tools_model"),
    ("models.assign_large_context", "PUT /models/defaults", "large_context_model"),
    ("models.clear_optional", "PUT /models/defaults", "field:null"),
    ("models.auto_assign", "POST /models/auto-assign", "missing required"),
    ("models.confirm_embedding_change", "PUT /models/defaults", "no rebuild"),
    (
        "models.confirm_change_then_open_rebuild",
        "PUT /models/defaults",
        "no navigation",
    ),
]


@pytest.mark.parametrize("operation,wire_request,intent", B9C_WRITE_CASES)
def test_fix1_b9c_ambiguous_errors_have_per_operation_counted_assertions(
    operation, wire_request, intent
):
    cases = catalog_cases()
    key = f"C2-R-B9c-{operation}--ambiguous-outcomes"
    assert key in cases, "Operation lacks explicit ambiguous outcome scenarios"
    case = cases[key]
    assert case["operation_ids"] == [operation]
    assert case["layer"] == "runtime" and case["initial_status"] == "not_run"
    for outcome in [
        "HTTP400",
        "HTTP404",
        "HTTP409",
        "HTTP422",
        "HTTP429",
        "HTTP500",
        "network-lost-ack",
    ]:
        actions = [s for s in case["actions"] if s.startswith(outcome + ":")]
        assertions = [s for s in case["expected"] if s.startswith(outcome + ":")]
        assert len(actions) == len(assertions) == 1
        assert wire_request in actions[0]
        assert "duplicate" in actions[0] and "retry" in actions[0]
        assert "count remains 1" in assertions[0]
        assert "original unknown" in assertions[0] and "no replay" in assertions[0]
    expected = " ".join(case["expected"]).lower()
    assert intent in expected
    assert "later edits" in expected and "metadata refresh" in expected
    assert "outcome-request-ledger" in case["required_evidence_types"]


@pytest.mark.parametrize("operation,wire_request,intent", B9C_WRITE_CASES)
def test_fix1_b9c_proven_unsent_is_not_http_retry_authority(
    operation, wire_request, intent
):
    cases = catalog_cases()
    key = f"C2-R-B9c-{operation}--proven-unsent"
    assert key in cases, "Operation lacks a proven-unsent contrast"
    case = cases[key]
    assert case["operation_ids"] == [operation]
    actions = " ".join(case["actions"])
    expected = " ".join(case["expected"]).lower()
    assert wire_request in actions and "RequestNotDispatchedError" in actions
    for criterion in [
        "count is 0",
        "fresh explicit confirmation",
        "count becomes 1",
        "old token",
        "later edits",
        "not inferred from http",
    ]:
        assert criterion in expected
    assert "outcome-request-ledger" in case["required_evidence_types"]
    assert case["initial_status"] == "not_run"


@pytest.mark.parametrize("variant", ["ambiguous-outcomes", "proven-unsent"])
def test_fix1_registration_fixture_uses_an_admitted_provider_id(variant):
    import re

    case = catalog_cases()[f"C2-R-B9c-credentials.register_selected--{variant}"]
    plan = " ".join(case["preconditions"])
    provider = re.search(r"provider:([a-z_-]+)", plan)
    assert provider is not None
    # Public provider names admitted by the existing UI, not a new fake enum.
    assert provider.group(1) in {"openai", "ollama"}
    assert "no real provider" in plan.lower()


def test_fix2_proven_unsent_migration_cannot_require_an_unknown_barrier():
    cases = catalog_cases()
    base = "C2-R-B9c-credentials.migrate_from_env"
    unsent = cases[base + "--proven-unsent"]
    assertions = " ".join(unsent["expected"]).lower()
    assert "remains unknown" not in assertions
    assert "partial-uncertainty barrier" not in assertions
    migration_result = unsent["expected"][-1].lower()
    for required in [
        "zero sends",
        "no migration effects",
        "no fabricated migration counts",
        "original not-sent identity",
        "history",
        "only the independently confirmed fresh attempt",
        "matching migration result",
    ]:
        assert required in migration_result
    ambiguous = cases[base + "--ambiguous-outcomes"]
    assert all("original unknown" in result for result in ambiguous["expected"])
    assert all(
        "partial-uncertainty barrier" in result for result in ambiguous["expected"]
    )
