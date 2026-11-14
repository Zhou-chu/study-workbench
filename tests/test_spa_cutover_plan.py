"""Pure C3 contract tests. Fabricated observations never establish acceptance."""

import json
import os

import pytest

from scripts.v1 import spa_cutover_plan as planner


def test_reader_returns_json_without_following_record_locators(tmp_path):
    path = tmp_path / "input.json"
    path.write_text('{"record":{"id":"not-a-path","sha256":"' + "a" * 64 + '"}}')
    assert planner.load_input(path) == {
        "record": {"id": "not-a-path", "sha256": "a" * 64}
    }


@pytest.mark.parametrize(
    "payload",
    [
        b'{"outer":{"same":1,"same":2}}',
        b'{"value":NaN}',
        b'{"value":Infinity}',
        b"\xef\xbb\xbf{}",
        b'{"value":"\xff"}',
        b'{"value":' + b"[" * 17 + b"0" + b"]" * 17 + b"}",
        b" " * (1024 * 1024) + b"{}",
        b'{"value":"' + b"x" * 513 + b'"}',
    ],
)
def test_reader_rejects_malformed_or_unbounded_bytes(tmp_path, payload):
    path = tmp_path / "input.json"
    path.write_bytes(payload)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_reader_accepts_exact_raw_byte_limit(tmp_path):
    path = tmp_path / "input.json"
    path.write_bytes(b"{}" + b" " * (1024 * 1024 - 2))
    assert planner.load_input(path) == {}


def test_reader_rejects_symlink_file_and_ancestor(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    target = real / "input.json"
    target.write_text("{}")
    file_link = tmp_path / "file-link"
    file_link.symlink_to(target)
    directory_link = tmp_path / "directory-link"
    directory_link.symlink_to(real, target_is_directory=True)
    for path in (file_link, directory_link / "input.json"):
        with pytest.raises(ValueError, match="Invalid input"):
            planner.load_input(path)


def test_reader_rejects_fifo_without_blocking(tmp_path):
    path = tmp_path / "pipe"
    os.mkfifo(path)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_reader_rejects_directory_and_missing_path(tmp_path):
    for path in (tmp_path, tmp_path / "missing-private-name"):
        with pytest.raises(ValueError) as error:
            planner.load_input(path)
        assert str(error.value) == "Invalid input"


def test_reader_rejects_traversal_without_resolving_it(tmp_path):
    target = tmp_path / "input.json"
    target.write_text("{}")
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(str(tmp_path) + "/../" + tmp_path.name + "/input.json")


def test_reader_checks_depth_inside_json_not_quoted_punctuation(tmp_path):
    path = tmp_path / "input.json"
    value = {"text": "[" * 30 + '"' + "}" * 30}
    path.write_text(json.dumps(value))
    assert planner.load_input(path) == value


def test_reader_reads_one_regular_descriptor_once(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    reads = []
    original_read = os.read

    def counted(fd, size):
        reads.append((fd, size))
        return original_read(fd, size)

    monkeypatch.setattr(planner.s.os, "read", counted)
    assert planner.load_input(path) == {}
    assert len({fd for fd, _ in reads}) == 1
    assert sum(size for _, size in reads) <= 1024 * 1024 + 1


def test_reader_does_not_open_an_input_for_write(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    original_open = os.open
    calls = []

    def checked(path, flags, *args, **kwargs):
        calls.append(flags)
        assert flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC) == 0
        return original_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(planner.s.os, "open", checked)
    assert planner.load_input(path) == {}
    assert calls


def test_reader_requires_safe_nofollow_support(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    monkeypatch.delattr(planner.s.os, "O_NOFOLLOW")
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


# Expectations below use independent JSON/hash construction, never planner helpers.
import copy
import hashlib


def canon(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


def digest(value):
    return hashlib.sha256(canon(value)).hexdigest()


H = "a" * 64
C = "b" * 40
TREE = "c" * 40
MARKER = b"UNIT_FIXTURE_NO_OBSERVATION"
RECORD = {"bytes": len(MARKER), "sha256": hashlib.sha256(MARKER).hexdigest()}
CHECK_IDS = (
    "artifact_association",
    "served_identity",
    "auth_runtime",
    "ingress_topology",
    "cookie_upload",
    "forward_owners",
    "reverse_owners",
    "schema_content",
    "backup_snapshot",
    "isolated_restore",
    "operation_custody",
    "user_work",
    "catalog_acceptance",
    "rollback_drill",
    "post_entry_acceptance",
)
CATALOG = {
    "version": "spa-browser-cases-v1",
    "file_sha256": "a437fef4a01b2aa195836858aeb455714da3c47192adc556ee2e9a6676b8b9df",
    "operation_fingerprint": "b9fe7af28a5e85aaf628afa49b142b451aa4f985bc5de36c2e2796d3946936f6",
    "case_membership_sha256": "ab0a55bd912efef1901e259005189a25f3d51e7ea83afd257e6e64319473e7b4",
    "case_count": 615,
    "required_evidence_slots": 1470,
}
OUTPUT_KEYS = {
    "candidate",
    "current",
    "backups_verified",
    "auth_mode",
    "compatibility",
    "blockers",
    "ordered_actions",
    "rollback_actions",
}


def verification(kind, record_id):
    return {
        "kind": kind,
        "source_commit": C,
        "source_tree": TREE,
        "helper_sha256": H,
        "contract_digest": H,
        "record": {"id": record_id, **RECORD},
        "status": "passed",
    }


def component(kind):
    identity = {
        "release_slot": "unit-fixture-" + kind + "-0001",
        "source_commit": C,
        "authored_digest": H,
        "contract_digest": H,
        "ui_transport_protocol": 1,
        "supported_contracts": ["workspace-view-v1"],
    }
    manifest = {
        "schema_version": "spa-artifact-v1",
        **{key: value for key, value in identity.items() if key != "release_slot"},
        "asset_digest": H,
    }
    return {
        "manifest": manifest,
        "identity": identity,
        "inventory_header": {
            "schema_version": "spa-inventory-v1",
            "kind": kind,
            "release_slot": identity["release_slot"],
        },
        "metadata": {
            "spa-artifact-manifest.json": {
                "bytes": len(canon(manifest)) + 1,
                "sha256": hashlib.sha256(canon(manifest) + b"\n").hexdigest(),
            },
            "artifact-inventory.json": dict(RECORD),
            "artifact-identity.json": {
                "bytes": len(canon(identity)) + 1,
                "sha256": hashlib.sha256(canon(identity) + b"\n").hexdigest(),
            },
        },
        "verification": verification("spa-" + kind + "-source-contract", kind),
    }


def envelopes(scope="synthetic"):
    web, bff = component("web"), component("bff")
    candidate = {
        "schema_version": "spa-cutover-candidate-v1",
        "scope": scope,
        "release_id": "UNIT_CANDIDATE_NO_OBSERVATION",
        "source": {"commit": C, "tree": TREE},
        "auth_mode": "legacy_password",
        "components": {
            "kind": "spa",
            "web": web,
            "bff": bff,
            "gateway": {
                "window": {
                    "schema_version": "spa-client-window-v1",
                    "current": "unit-fixture-web-0001",
                    "retained": ["unit-fixture-web-0001"],
                },
                "window_file": dict(RECORD),
                "stage": {"file_count": 1, "sha256": H},
                "retained": [
                    {key: value for key, value in web.items() if key != "verification"}
                ],
                "verification": verification("spa-gateway-files", "gateway"),
            },
        },
        "backend": {
            "api_commit": C,
            "worker_commit": C,
            "source_tree": TREE,
            "recipe_sha256": H,
            "migration_inventory_sha256": H,
            "data_contract_sha256": H,
        },
        "data_boundary": {
            "topology_id": "unit-topology",
            "storage_id": "unit-storage",
            "lock_id": "unit-lock",
        },
    }
    current = {
        **copy.deepcopy(candidate),
        "schema_version": "spa-cutover-current-v1",
        "release_id": "UNIT_CURRENT_NO_OBSERVATION",
        "components": {
            "kind": "legacy-next",
            "verification": verification("legacy-next-source-artifact", "legacy"),
            "artifact": {
                "manifest_sha256": H,
                "build_id": "unit-old-build",
                "source_sha256": H,
                "artifact_sha256": H,
                "generated_sha256": H,
                "claim": "source-artifact-association-not-reproducibility",
            },
        },
    }
    window = candidate["components"]["gateway"]["window"]
    candidate["components"]["gateway"]["window_file"] = {
        "bytes": len(canon(window)) + 1,
        "sha256": hashlib.sha256(canon(window) + b"\n").hexdigest(),
    }
    return candidate, current


def unavailable_checks():
    return {
        key: {
            "state": "unavailable",
            "status": "not_run",
            "proof_ids": [],
            "result": None,
        }
        for key in CHECK_IDS
    }


def preparation_inputs():
    candidate, current = envelopes("source-only")
    profile: dict = {
        "kind": "c2-source-preparation-v1",
        "source_commit": C,
        "source_tree": TREE,
        "helper_sha256": "505c29848b90241a0bda8ddc83331c0550c44303d00e3efd07b09b425de42e27",
        "catalog": CATALOG,
        "summary": None,
        "evidence": [],
        "run": {
            "version": "spa-acceptance-run-v1",
            "run_id": "unit-preparation",
            "source_commit": C,
            "api_commit": C,
            "environment": "synthetic-preparation-only",
            "auth_mode": "legacy_password",
            "runtime_started": False,
            "phase": "prepared",
            "fixture_digest": "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423",
            "contract_digest": H,
            "web_digest": H,
            "bff_digest": H,
            "web_slot": "unit-fixture-web-0001",
            "bff_slot": "unit-fixture-bff-0001",
            "gateway_digest": H,
        },
    }
    acceptance = {
        "schema_version": "spa-cutover-acceptance-v1",
        "scope": "source-only",
        "candidate_sha256": digest(candidate),
        "current_sha256": digest(current),
        "as_of": "2026-11-09T12:00:00+00:00",
        "policy": "spa-cutover-staged-policy-v1",
        "phase": "forward-entry",
        "transition": {
            "id": "unit-rollout",
            "forward_entry_proof_id": None,
            "reverse_entry_proof_id": None,
        },
        "profile": profile,
        "checks": unavailable_checks(),
        "limitations": ["UNIT_FIXTURE_NO_OBSERVATION"],
    }
    return {"candidate": candidate, "current": current, "acceptance": acceptance}


def rebind(inputs):
    inputs["acceptance"]["candidate_sha256"] = digest(inputs["candidate"])
    inputs["acceptance"]["current_sha256"] = digest(inputs["current"])
    return inputs


def assert_blocked(plan, code):
    assert set(plan) == OUTPUT_KEYS
    assert code in plan["blockers"]
    assert plan["ordered_actions"] == plan["rollback_actions"] == []


def test_empty_or_unknown_schema_never_emits_actions():
    assert_blocked(
        planner.make_cutover_plan(candidate={}, current={}, acceptance={}),
        "INPUT_SCHEMA_INVALID",
    )


def test_preparation_profile_stays_partial_with_independent_due_blockers():
    inputs = preparation_inputs()
    before = copy.deepcopy(inputs)
    plan = planner.make_cutover_plan(**inputs)
    for code in (
        "ACCEPTANCE_SCOPE_NOT_EXECUTED",
        "ACCEPTANCE_INCOMPLETE",
        "BACKUP_NOT_VERIFIED",
        "RESTORE_NOT_VERIFIED",
        "OLD_CLIENT_WINDOW_UNPROVEN",
        "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",
        "USER_WORK_PRESERVATION_UNVERIFIED",
    ):
        assert_blocked(plan, code)
    assert "INPUT_SCHEMA_INVALID" not in plan["blockers"]
    assert plan["candidate"]["full_catalog_complete"] is False
    assert plan["candidate"]["evidence_basis"] == "partial-only"
    assert inputs == before


@pytest.mark.parametrize(
    "field,value,code",
    [
        (
            "auth_mode",
            "device_sessions",
            "AUTH_MODE_CHANGE_REQUIRES_SEPARATE_ACTIVATION",
        ),
        ("auth_mode", None, "AUTH_MODE_UNVERIFIED"),
        ("scope", "production", "EVIDENCE_SCOPE_MISMATCH"),
    ],
)
def test_independent_envelope_failure_is_reported_for_partial_inputs(
    field, value, code
):
    inputs = preparation_inputs()
    inputs["candidate"][field] = value
    assert_blocked(planner.make_cutover_plan(**rebind(inputs)), code)


@pytest.mark.parametrize(
    "corrupt",
    [
        lambda x: x["candidate"].update(authorized=True),
        lambda x: x["candidate"]["components"]["web"]["manifest"].update(
            ui_transport_protocol=True
        ),
        lambda x: x["candidate"]["components"]["web"]["verification"].update(
            status="ready"
        ),
        lambda x: x["acceptance"].update(required_checks=[]),
        lambda x: x["acceptance"]["checks"].update(invented={}),
        lambda x: x["acceptance"]["profile"].update(kind="c3-complete-structural-v1"),
    ],
)
def test_schema_rejects_unknown_fields_enums_and_bool_as_integer(corrupt):
    inputs = preparation_inputs()
    corrupt(inputs)
    assert_blocked(planner.make_cutover_plan(**rebind(inputs)), "INPUT_SCHEMA_INVALID")


def test_unknown_current_remains_unknown_in_safe_output():
    inputs = preparation_inputs()
    inputs["current"].update(
        source=None, auth_mode=None, components={"kind": "unknown"}
    )
    plan = planner.make_cutover_plan(**rebind(inputs))
    assert_blocked(plan, "CURRENT_ARTIFACT_UNVERIFIED")
    assert plan["current"]["source"] is None
    assert plan["backups_verified"] is False
    assert plan["compatibility"] == "unavailable"


# Staged UNIT fixtures: every marker is fabricated, never a real receipt.
from pathlib import Path


def ident(envelope):
    return digest(
        {
            key: envelope[key]
            for key in ("source", "auth_mode", "components", "backend", "data_boundary")
        }
    )


def staged_inputs(phase="forward-entry", complete=False):
    inputs = preparation_inputs()
    candidate, current = envelopes()
    inputs.update(candidate=candidate, current=current)
    acceptance = inputs["acceptance"]
    acceptance.update(scope="synthetic", phase=phase)
    rebind(inputs)
    pair = {key: acceptance[key] for key in ("candidate_sha256", "current_sha256")}
    identity = {"candidate": ident(candidate), "current": ident(current)}
    identity["pair"] = digest(identity)
    proofs = []
    checks = {}
    observed = "2026-11-09T10:00:00+00:00"

    def proof(
        name,
        family,
        subject="pair",
        stage="before-forward",
        predecessors=None,
        record=None,
        transition="unit-rollout",
        at=observed,
    ):
        item = {
            "id": name,
            "family": family,
            "producer": {"kind": "synthetic-unit-fixture", "version": "unit-v1"},
            "role": "primary",
            "record": record or {"id": "record-" + name, **RECORD},
            "scope": "unit-fixture",
            "phase": stage,
            "subject": subject,
            "identity_sha256": identity[subject],
            "pair": dict(pair),
            "observed_at": at,
            "transition_id": transition,
            "predecessor_ids": predecessors or [],
            "claim_sha256": H,
        }
        proofs.append(item)
        return name

    def check(key, result, ids):
        checks[key] = {
            "state": "observed",
            "status": "passed",
            "proof_ids": list(dict.fromkeys(ids)),
            "result": result,
        }

    cp = []
    for kind in ("web", "bff"):
        cp.append(
            proof(
                "artifact-" + kind,
                "artifact-verifier",
                "candidate",
                "source-verification",
                record=candidate["components"][kind]["verification"]["record"],
                transition=None,
            )
        )
    cp.append(
        proof(
            "artifact-gateway",
            "artifact-verifier",
            "candidate",
            "source-verification",
            record=candidate["components"]["gateway"]["verification"]["record"],
            transition=None,
        )
    )
    old = proof(
        "artifact-current",
        "legacy-build-association",
        "current",
        "source-verification",
        record=current["components"]["verification"]["record"],
        transition=None,
    )
    check(
        "artifact_association",
        {
            "candidate": {
                "kind": "spa",
                "identity_sha256": identity["candidate"],
                "proof_ids": cp,
            },
            "current": {
                "kind": "legacy-next",
                "identity_sha256": identity["current"],
                "proof_ids": [old],
            },
            "rollback": {
                "kind": "legacy-next",
                "identity_sha256": identity["current"],
                "proof_ids": [old],
            },
        },
        cp + [old],
    )

    # An independent isolated rehearsal with both real logical directional windows.
    sf_owner = proof(
        "rehearsal-forward-owner",
        "owner-window-observation",
        "current",
        "rehearsal",
        transition="unit-rehearsal",
    )
    sf_entry = proof(
        "rehearsal-forward-entry",
        "entry-observation",
        "candidate",
        "rehearsal",
        [sf_owner],
        transition="unit-rehearsal",
    )
    sr_owner = proof(
        "rehearsal-reverse-owner",
        "owner-window-observation",
        "candidate",
        "rehearsal",
        [sf_entry],
        transition="unit-rehearsal",
    )
    sr_entry = proof(
        "rehearsal-reverse-entry",
        "entry-observation",
        "current",
        "rehearsal",
        [sr_owner],
        transition="unit-rehearsal",
    )
    rehearsal = proof(
        "rehearsal",
        "rollback-rehearsal",
        stage="rehearsal",
        predecessors=[sf_entry, sr_entry],
        transition="unit-rehearsal",
    )
    check(
        "rollback_drill",
        {
            "observation_scope": "synthetic",
            "candidate_identity_sha256": identity["candidate"],
            "current_identity_sha256": identity["current"],
            "forward_entry_proof_id": sf_entry,
            "reverse_entry_proof_id": sr_entry,
            "forward_owner_proof_id": sf_owner,
            "reverse_owner_proof_id": sr_owner,
            "fixture_epoch_id": "unit-fixture-epoch",
            "before_reverse_content_sha256": H,
            "after_reverse_content_sha256": H,
            "content_classes": ["note", "edit", "upload"],
            "outcome": "preserved",
            "schema_action": "no-downgrade",
            "data_action": "retain-current",
            "proof_id": rehearsal,
        },
        [rehearsal, sf_entry, sr_entry, sf_owner, sr_owner],
    )

    forward_owner = proof(
        "forward-owner", "owner-window-observation", "current", "before-forward"
    )
    check(
        "forward_owners",
        {
            "direction": "old-to-new",
            "window_id": "forward-window",
            "cutoff_id": "forward-cutoff",
            "owner_inventory_sha256": H,
            "owners": [],
            "unseen_count": 0,
            "unowned_count": 0,
        },
        [forward_owner],
    )
    future_reverse = phase in ("forward-entry", "forward-verification")
    if future_reverse:
        checks["reverse_owners"] = {
            "state": "obligation",
            "status": "not_run",
            "proof_ids": [],
            "result": {"obligation": "reverse_owners"},
        }
    forward_event = None
    reverse_event = None
    if phase != "forward-entry":
        forward_event = proof(
            "actual-forward-entry",
            "entry-observation",
            "candidate",
            "after-forward",
            [forward_owner],
            at="2026-11-09T10:01:00+00:00",
        )
    if not future_reverse:
        reverse_owner = proof(
            "reverse-owner",
            "owner-window-observation",
            "candidate",
            "before-reverse",
            [forward_event],
            at="2026-11-09T10:02:00+00:00",
        )
        check(
            "reverse_owners",
            {
                "direction": "new-to-old",
                "window_id": "reverse-window",
                "cutoff_id": "reverse-cutoff",
                "owner_inventory_sha256": H,
                "owners": [],
                "unseen_count": 0,
                "unowned_count": 0,
            },
            [reverse_owner],
        )
    if phase in ("reverse-verification", "finalize"):
        reverse_event = proof(
            "actual-reverse-entry",
            "entry-observation",
            "current",
            "after-reverse",
            [reverse_owner, forward_event],
            at="2026-11-09T10:03:00+00:00",
        )
    acceptance["transition"].update(
        forward_entry_proof_id=forward_event, reverse_entry_proof_id=reverse_event
    )

    stage = {
        "forward-entry": "before-forward",
        "forward-verification": "after-forward",
        "reverse-entry": "before-reverse",
        "reverse-verification": "after-reverse",
        "finalize": "after-reverse",
    }[phase]
    current_window = (
        "forward" if phase in ("forward-entry", "forward-verification") else "reverse"
    )
    current_event = reverse_event or forward_event
    at = "2026-11-09T10:04:00+00:00"
    subjects = (
        ["current", "candidate"]
        if phase in ("forward-entry", "reverse-entry")
        else ["candidate" if phase == "forward-verification" else "current"]
    )
    runtime_rows, auth_rows, ingress_rows, transport_rows = [], [], [], []
    runtime_ids, auth_ids, ingress_ids, transport_ids = [], [], [], []
    for subject in subjects:
        env = inputs[subject]
        kind = env["components"]["kind"]
        observation_phase = (
            "rehearsal"
            if (phase == "forward-entry" and subject == "candidate")
            or (phase == "reverse-entry" and subject == "current")
            else ("baseline" if phase == "forward-entry" else stage)
        )
        pred = (
            [current_event]
            if current_event and observation_phase != "rehearsal"
            else []
        )
        transition = (
            "unit-rehearsal" if observation_phase == "rehearsal" else "unit-rollout"
        )
        runtime = proof(
            "runtime-" + subject,
            "runtime-association",
            subject,
            observation_phase,
            pred,
            transition=transition,
            at=at,
        )
        capability = proof(
            "capability-" + subject,
            "api-capability-observation",
            subject,
            observation_phase,
            pred,
            transition=transition,
            at=at,
        )
        ingress = proof(
            "ingress-" + subject,
            "ingress-observation",
            subject,
            observation_phase,
            pred,
            transition=transition,
            at=at,
        )
        transport = proof(
            "transport-" + subject,
            "transport-observation",
            subject,
            observation_phase,
            pred,
            transition=transition,
            at=at,
        )
        services = (
            ["web", "bff", "api", "worker", "db"]
            if kind == "spa"
            else ["legacy-next", "api", "worker", "db"]
        )
        rows = []
        for service in services:
            rows.append(
                {
                    "service": service,
                    "execution": "native",
                    "execution_identity_sha256": H,
                    "source_commit": None if service == "db" else C,
                    "source_tree": None if service == "db" else TREE,
                    "artifact_sha256": None
                    if service in ("api", "worker", "db")
                    else H,
                    "config_id": "unit-config-" + service,
                }
            )
        runtime_rows.append(
            {
                "subject": subject,
                "identity_sha256": identity[subject],
                "gateway_digest": H if kind == "spa" else None,
                "origin_id": "unit-origin",
                "components": rows,
                "proof_ids": [runtime],
            }
        )
        runtime_ids.append(runtime)
        if kind == "spa":
            auth_rows.append(
                {
                    "kind": "spa",
                    "subject": subject,
                    "auth_mode": "legacy_password",
                    "config": {
                        "ui_transport_protocol": 1,
                        "web_session_protocol": None,
                        "client_contracts": ["workspace-view-v1"],
                    },
                    "api": {
                        "api_commit": C,
                        "worker_commit": C,
                        "supported_contracts": ["workspace-view-v1"],
                    },
                    "proof_ids": [capability, runtime],
                }
            )
        else:
            auth_rows.append(
                {
                    "kind": "legacy-next",
                    "subject": subject,
                    "auth_mode": "legacy_password",
                    "legacy_runtime_identity_sha256": identity[subject],
                    "api_commit": C,
                    "worker_commit": C,
                    "proof_ids": [capability, runtime],
                }
            )
        auth_ids.extend([capability, runtime])
        ingress_rows.append(
            {
                "subject": subject,
                "origin_id": "unit-origin",
                "protection_id": "unit-protection",
                "service_kinds": services,
                "bff_instances": 1 if kind == "spa" else 0,
                "boundary": dict(env["data_boundary"]),
                "backend_reachability": "internal-only",
                "writer_owner_ids": ["api", "worker"],
                "proof_ids": [ingress],
            }
        )
        ingress_ids.append(ingress)
        artifact_proof = cp[0] if kind == "spa" else old
        component_hash = (
            digest(env["components"]["web"]["identity"])
            if kind == "spa"
            else digest(env["components"]["artifact"])
        )
        transport_rows.append(
            {
                "subject": subject,
                "identity_sha256": identity[subject],
                "patches": [
                    {
                        "requirement_id": requirement,
                        "patch_id": "unit-" + requirement,
                        "source_commit": "8ab9e7d0bcc9f5d0052635e10a0cf2fce7fc9020"
                        if requirement == "private-ingress-cookie"
                        else "d" * 40,
                        "component_identity_sha256": component_hash,
                        "proof_id": artifact_proof,
                    }
                    for requirement in (
                        "private-ingress-cookie",
                        "upload-compatibility",
                    )
                ],
                "flows": [
                    {
                        "client": "spa" if kind == "spa" else "legacy-next",
                        "flow": flow,
                        "outcome": "passed",
                        "proof_id": transport,
                    }
                    for flow in ("login", "config", "json", "upload", "sse", "download")
                ],
            }
        )
        transport_ids.extend([transport, artifact_proof])
    check("served_identity", {"observations": runtime_rows}, runtime_ids)
    check(
        "auth_runtime",
        {"observations": auth_rows, "mode_transition": "unchanged"},
        auth_ids,
    )
    check("ingress_topology", {"observations": ingress_rows}, ingress_ids)
    check("cookie_upload", {"observations": transport_rows}, transport_ids)

    baseline_subject = (
        "current"
        if phase in ("forward-entry", "reverse-verification", "finalize")
        else "candidate"
    )
    live = proof(
        "schema",
        "schema-content-observation",
        baseline_subject,
        stage,
        [current_event] if current_event else [],
        at=at,
    )
    check(
        "schema_content",
        {
            "baseline": {
                "schema_sha256": H,
                "data_contract_sha256": H,
                "storage_id": "unit-storage",
            },
            "target": {"migration_inventory_sha256": H, "data_contract_sha256": H},
            "rollback_identity_sha256": identity["current"],
            "migration_relation": "identical",
            "readability_basis": "source-matched-rehearsal"
            if phase == "forward-entry"
            else "current-state-observed",
            "candidate_era_content": "synthetic-preserved",
            "schema_action": "no-downgrade",
            "data_action": "retain-current",
            "cutoff_id": current_window + "-cutoff",
            "proof_ids": [live, rehearsal],
        },
        [live, rehearsal],
    )
    backup = proof("backup", "backup-manifest", "current", "before-forward")
    check(
        "backup_snapshot",
        {
            "snapshot_id": "unit-snapshot",
            "cutoff_id": "forward-cutoff",
            "hold_id": "forward-hold",
            "storage_id": "unit-storage",
            "backend_identity_sha256": digest(current["backend"]),
            "schema_sha256": H,
            "inventory_sha256": H,
            "categories": [
                "db",
                "personal-content",
                "checkpoints",
                "uploads",
                "podcasts",
                "runtime-config",
                "authorized-secret-custody",
            ],
            "consistency": "all-writers-quiescent",
            "snapshot_role": "pre-forward-insurance",
            "data_bytes": 2**35,
            "proof_id": backup,
        },
        [backup],
    )
    restore = proof(
        "restore", "isolated-restore-observation", "current", "before-forward", [backup]
    )
    check(
        "isolated_restore",
        {
            "snapshot_id": "unit-snapshot",
            "cutoff_id": "forward-cutoff",
            "source_storage_id": "unit-storage",
            "target_storage_id": "isolated-storage",
            "backend_identity_sha256": digest(current["backend"]),
            "schema_sha256": H,
            "inventory_sha256": H,
            "integrity": "verified",
            "readability": "verified",
            "originals": "verified",
            "restored_bytes": 2**35,
            "proof_id": restore,
        },
        [restore],
    )
    custody = proof(
        "custody",
        "operation-custody-observation",
        baseline_subject,
        stage,
        [current_event] if current_event else [],
        at=at,
    )
    check(
        "operation_custody",
        {
            "cutoff_id": current_window + "-cutoff",
            "hold_id": current_window + "-hold",
            "inventory_sha256": H,
            "admission": "held",
            "continuity": "quiescent",
            "entries": [],
            "pending_count": 0,
            "unknown_count": 0,
            "unowned_count": 0,
            "proof_id": custody,
        },
        [custody],
    )
    work = proof(
        "work",
        "user-work-observation",
        baseline_subject,
        stage,
        [current_event] if current_event else [],
        at=at,
    )
    owner = forward_owner if future_reverse else reverse_owner
    check(
        "user_work",
        {
            "window_id": current_window + "-window",
            "cutoff_id": current_window + "-cutoff",
            "inventory_sha256": H,
            "items": [],
            "unsaved_count": 0,
            "discarded_count": 0,
            "update_action": "explicit-owner-action",
            "proof_id": work,
        },
        [work, owner],
    )

    if phase in ("forward-entry", "reverse-entry"):
        checks["post_entry_acceptance"] = {
            "state": "obligation",
            "status": "not_run",
            "proof_ids": [],
            "result": {"obligation": "post_entry_acceptance"},
        }
    else:
        target = "candidate" if phase == "forward-verification" else "current"
        flow_proofs = [
            proof("post-" + flow, family, target, stage, [current_event], at=at)
            for flow, family in (
                ("login", "api-capability-observation"),
                ("upload", "transport-observation"),
                ("question-answer", "case-observation"),
                ("citation", "case-observation"),
                ("note", "case-observation"),
                ("export", "case-observation"),
                ("access-protection", "ingress-observation"),
            )
        ]
        check(
            "post_entry_acceptance",
            {
                "subject": target,
                "entry_proof_id": current_event,
                "served_identity_sha256": identity[target],
                "origin_id": "unit-origin",
                "protection_id": "unit-protection",
                "flows": [
                    {"id": flow, "outcome": "passed", "proof_id": pid}
                    for flow, pid in zip(
                        (
                            "login",
                            "upload",
                            "question-answer",
                            "citation",
                            "note",
                            "export",
                            "access-protection",
                        ),
                        flow_proofs,
                    )
                ],
            },
            [current_event, "runtime-" + target, *flow_proofs],
        )

    catalog_proof = proof(
        "catalog",
        "case-observation",
        "candidate",
        "rehearsal",
        transition="unit-rehearsal",
    )
    user_proof = proof(
        "user-decision", "user-decision", "candidate", "user-review", transition=None
    )
    catalog_result = {
        "variant": "complete" if complete else "pre-entry",
        "catalog_file_sha256": CATALOG["file_sha256"],
        "membership_sha256": CATALOG["case_membership_sha256"],
        "required_case_count": 615 if complete else 614,
        "required_evidence_count": 1470 if complete else 1467,
        "full_catalog_complete": complete,
        "proof_ids": [catalog_proof, user_proof],
    }
    if complete:
        catalog_result["proof_ids"] += [
            forward_owner,
            reverse_owner,
            forward_event,
            reverse_event,
            "runtime-current",
        ]
    else:
        catalog_result.update(
            temporal_case_id="C2-R11-old-tab-window", temporal_case_status="blocked"
        )
    check("catalog_acceptance", catalog_result, catalog_result["proof_ids"])
    membership = sorted(
        [
            {
                key: row[key]
                for key in (
                    "id",
                    "operation_ids",
                    "layer",
                    "mandatory",
                    "conditions",
                    "required_evidence_types",
                )
            }
            for row in json.loads(
                (
                    Path(__file__).resolve().parents[1]
                    / "docs/v1/SPA_BROWSER_CASES.json"
                ).read_text()
            )["cases"]
        ],
        key=lambda row: row["id"],
    )
    contexts = []
    for context_id, family, subject, ctx_phase, pred in [
        ("c00", "case-observation", "candidate", "rehearsal", [catalog_proof]),
        ("c01", "user-decision", "candidate", "user-review", [user_proof]),
    ] + (
        [
            (
                "c02",
                "owner-window-observation",
                "pair",
                "after-reverse",
                [forward_owner, reverse_owner, forward_event, reverse_event],
            ),
            (
                "c03",
                "runtime-association",
                "current",
                "after-reverse",
                ["runtime-current", forward_event, reverse_event],
            ),
        ]
        if complete
        else []
    ):
        contexts.append(
            {
                "id": context_id,
                "family": family,
                "producer": {"kind": "synthetic-unit-fixture", "version": "unit-v1"},
                "scope": "unit-fixture",
                "phase": ctx_phase,
                "subject": subject,
                "identity_sha256": identity[subject],
                "pair": dict(pair),
                "observed_at": at,
                "transition_id": None
                if ctx_phase == "user-review"
                else ("unit-rehearsal" if ctx_phase == "rehearsal" else "unit-rollout"),
                "predecessor_ids": pred,
            }
        )
    case_rows: list[dict] = []
    evidence: list[dict] = []
    for row in membership:
        deferred = row["id"] == "C2-R11-old-tab-window" and not complete
        references = []
        if not deferred:
            for kind in sorted(row["required_evidence_types"]):
                evidence_id = "e" + str(len(evidence)).zfill(4)
                context = (
                    "c01"
                    if row["layer"] == "user"
                    else (
                        "c03"
                        if row["layer"] == "production" and kind == "old-tab-identity"
                        else "c02"
                        if row["layer"] == "production"
                        else "c00"
                    )
                )
                evidence.append(
                    {
                        "id": evidence_id,
                        "case_id": row["id"],
                        "layer": row["layer"],
                        "conditions_sha256": digest(row["conditions"]),
                        "evidence_type": kind,
                        "outcome": "passed",
                        "record": dict(RECORD),
                        "context_id": context,
                    }
                )
                references.append(evidence_id)
        case_rows.append(
            {
                "id": row["id"],
                "status": "blocked" if deferred else "passed",
                "evidence": references,
            }
        )
    acceptance["checks"] = checks
    acceptance["profile"] = {
        "kind": "c3-staged-structural-v1",
        "binding": {
            "source_commit": C,
            "source_tree": TREE,
            "api_commit": C,
            "worker_commit": C,
            "web_digest": H,
            "bff_digest": H,
            "web_slot": "unit-fixture-web-0001",
            "bff_slot": "unit-fixture-bff-0001",
            "contract_digest": H,
            "fixture_digest": "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423",
            "gateway_digest": H,
            "window_file_sha256": candidate["components"]["gateway"]["window_file"][
                "sha256"
            ],
            "scope": "synthetic",
            **pair,
        },
        "catalog": dict(CATALOG),
        "catalog_membership": membership,
        "cases": case_rows,
        "evidence": evidence,
        "provenance": {
            "normalization": {"id": "unit-normalization", **RECORD},
            "proofs": proofs,
            "case_contexts": contexts,
        },
    }
    seal_claims(inputs)
    return inputs


def seal_claims(inputs):
    acceptance = inputs["acceptance"]
    proofs = acceptance["profile"]["provenance"]["proofs"]
    contexts = acceptance["profile"]["provenance"]["case_contexts"]
    for proof in proofs:
        uses = {
            "checks": sorted(
                [
                    {"check_id": key, "result": value["result"]}
                    for key, value in acceptance["checks"].items()
                    if proof["id"] in value["proof_ids"]
                ],
                key=lambda item: item["check_id"],
            ),
            "transition_roles": sorted(
                key
                for key in ("forward_entry_proof_id", "reverse_entry_proof_id")
                if acceptance["transition"][key] == proof["id"]
            ),
            "case_context_ids": sorted(
                item["id"]
                for item in contexts
                if proof["id"] in item["predecessor_ids"]
            ),
            "successor_proof_ids": sorted(
                item["id"] for item in proofs if proof["id"] in item["predecessor_ids"]
            ),
        }
        proof["claim_sha256"] = digest(
            {
                "proof": {
                    key: value for key, value in proof.items() if key != "claim_sha256"
                },
                "uses": uses,
            }
        )
    return inputs


@pytest.mark.parametrize(
    "phase,complete",
    [
        ("forward-entry", False),
        ("forward-verification", False),
        ("reverse-entry", False),
        ("reverse-verification", False),
        ("finalize", True),
    ],
)
def test_all_five_staged_paths_disclose_unit_basis_and_never_claim_execution(
    phase, complete
):
    inputs = staged_inputs(phase, complete)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"] == []
    assert set(result) == OUTPUT_KEYS
    assert result["backups_verified"] is True
    assert result["compatibility"] == "compatible"
    assert result["candidate"]["phase"] == phase
    assert result["candidate"]["evidence_basis"] == "unit-fixture"
    assert result["candidate"]["full_catalog_complete"] is complete
    assert result["ordered_actions"] and result["rollback_actions"]


@pytest.mark.parametrize("check_id", CHECK_IDS)
def test_missing_due_check_empties_both_arrays(check_id):
    inputs = staged_inputs("finalize", True)
    inputs["acceptance"]["checks"][check_id] = unavailable_checks()[check_id]
    seal_claims(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"]
    assert result["ordered_actions"] == result["rollback_actions"] == []


def test_entry_does_not_require_future_reverse_or_post_entry_passes():
    result = planner.make_cutover_plan(**staged_inputs())
    assert "ROLLBACK_CLIENT_WINDOW_UNPROVEN" not in result["blockers"]
    assert result["blockers"] == []
    procedure = " ".join(result["ordered_actions"] + result["rollback_actions"]).lower()
    for required in (
        "authorization",
        "post-entry",
        "old next",
        "save",
        "reconcile",
        "exit",
        "defer",
    ):
        assert required in procedure


def test_finalize_cannot_use_the_pre_entry_temporal_exception():
    assert_blocked(
        planner.make_cutover_plan(**staged_inputs("finalize", False)),
        "ACCEPTANCE_INCOMPLETE",
    )


def test_shared_claim_hash_is_recomputed_from_all_gate_uses():
    inputs = staged_inputs()
    inputs["acceptance"]["checks"]["cookie_upload"]["result"]["observations"][0][
        "patches"
    ][0]["patch_id"] = "tampered"
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_IDENTITY_MISMATCH")


import subprocess
import sys


def native_inputs():
    inputs = preparation_inputs()
    inputs["acceptance"]["profile"] = {
        "kind": "c2-native-partial-v1",
        "observation_scope": "synthetic-native-partial",
        "producer": {
            "version": "spa-native-runtime-receipt-v1",
            "helper_sha256": "03113671e88abcf17a1050b763b9bb2c9b1a573f18d5cc106054c634820b2576",
            "receipt": {
                "id": "retained-native-receipt",
                "bytes": 9176,
                "sha256": "8b126ddb6bb6fd5f610361f10c0de489b97e914ccdb6fc8fa67e0fd9b556600d",
            },
            "report": {
                "id": "retained-native-report",
                "bytes": 10352,
                "sha256": "15f08e338a84e9b964c6e423530d3bd995f51fd3265982bbf868e1a091771395",
            },
            "index": {
                "id": "retained-native-index",
                "bytes": 2671,
                "sha256": "c0c09439847ac4db5fde8655ddc49a5bf13a352c2ff336ae5a1e3860c054ffcd",
            },
            "results": {
                "id": "retained-native-results",
                "bytes": 13698,
                "sha256": "f99fee5edbfb7d8a7722f0b76975f0b072398ba494fcc38641d8045668188b57",
            },
        },
        "source": {
            "commit": "8e0d3af2b9c7623f1671c17246f6bf8eb345d920",
            "tree": "cb18fead5d07a894893494171d4fddafcf81d7a2",
            "api_commit": "8e0d3af2b9c7623f1671c17246f6bf8eb345d920",
            "worker_commit": "8e0d3af2b9c7623f1671c17246f6bf8eb345d920",
        },
        "artifacts": {
            "web_slot": "c2-native-reviewfix1-8e0d3af-web-20261109",
            "bff_slot": "c2-native-reviewfix1-8e0d3af-bff-20261109",
            "web_digest": "afbba6e5fa6972b766aa83723b398b7066eb1a2fbdc6a2b53caa116b4dee77cd",
            "bff_digest": "24acb9a81c3836bb5b5608f303ff0916ea8ece1c3e94a5d38b8d69de8273e7d9",
            "contract_digest": "7457772928802237c1e2e59ba1841352dd4ccce5124c5259ce5eca09c161b0f1",
            "fixture_digest": "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423",
            "gateway_digest": "b87fb62a5e3bd9667f015139291b64a5f7896bafa51f8a18e2dc1d3c83ce933e",
            "window_file_sha256": "83d88f383b6814b785d4676f26e01081a5d9a611232843ef205b43094df1345b",
        },
        "catalog": dict(CATALOG),
        "summary": None,
        "case_results": [],
        "native": {
            "status": "partial_pass",
            "cleanup": "succeeded",
            "startup": ["db", "api", "worker", "bff"],
            "readiness": [
                "db/health",
                "api/health",
                "bff/config",
                "bff/api/auth/status",
            ],
            "readiness_requests": {"attempted": 4, "completed": 4},
            "request_counts": {"attempted": 23, "completed": 23, "mutations": 7},
            "transaction": {
                "native_checks": "succeeded",
                "worker_completion": "extraction_succeeded",
                "export_status": "succeeded",
                "portable_status": "succeeded",
                "original_sha256": "20e21965df9711d91e8e2b03dd890a453f0a71bc5092c7eb251c43e4c664effa",
                "zip_sha256": "3f09f798e9a2dd0758f48f23705fecdd085afe50bacfabe7d786853b9fceb0ba",
            },
            "citation_validation": "not_run",
            "auxiliary_embedding": {
                "status": "failed",
                "reason": "no-model-configured",
                "source": "reviewed-results",
            },
        },
        "limitations": ["Frozen native partial projection; no full acceptance."],
    }
    return inputs


def test_actual_frozen_native_projection_remains_blocked_and_is_not_a_full_export():
    # Real categorical/hash projection, deliberately paired with UNIT envelopes.
    result = planner.make_cutover_plan(**native_inputs())
    assert_blocked(result, "ACCEPTANCE_SCOPE_NOT_EXECUTED")
    assert_blocked(result, "ACCEPTANCE_INCOMPLETE")
    assert_blocked(result, "EVIDENCE_IDENTITY_MISMATCH")
    assert "INPUT_SCHEMA_INVALID" not in result["blockers"]
    assert result["candidate"]["evidence_basis"] == "partial-only"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update(summary={"complete": True}),
        lambda p: p.update(
            case_results=[
                {"id": "C2-R11-old-tab-window", "status": "passed", "evidence": []}
            ]
        ),
        lambda p: p["native"].update(citation_validation="passed"),
        lambda p: p["native"]["auxiliary_embedding"].update(status="succeeded"),
        lambda p: p["native"]["transaction"].update(private_notebook_id="forbidden"),
        lambda p: p["native"]["request_counts"].update(mutations=True),
        lambda p: p["producer"]["receipt"].update(sha256="f" * 64),
    ],
)
def test_native_projection_rejects_promotion_or_changed_anchored_receipt(mutate):
    inputs = native_inputs()
    mutate(inputs["acceptance"]["profile"])
    assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def test_partial_profiles_reject_observed_checks_without_a_proof_index():
    for inputs in (preparation_inputs(), native_inputs()):
        inputs["acceptance"]["checks"]["artifact_association"] = staged_inputs()[
            "acceptance"
        ]["checks"]["artifact_association"]
        assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def cli(tmp_path, inputs, extra=()):
    paths = []
    for name in ("candidate", "current", "acceptance"):
        path = tmp_path / (name + ".json")
        path.write_bytes(canon(inputs[name]))
        paths.extend(["--" + name, str(path)])
    return subprocess.run(
        [
            sys.executable,
            "-B",
            str(Path(__file__).resolve().parents[1] / "scripts/v1/spa_cutover_plan.py"),
            *paths,
            *extra,
        ],
        cwd=tmp_path,
        env={"PATH": os.defpath, "PYTHON_DOTENV_DISABLED": "1"},
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_direct_cli_is_cwd_independent_and_returns_structural_zero_only(tmp_path):
    result = cli(tmp_path, staged_inputs())
    assert result.returncode == 0
    assert result.stderr == ""
    output = json.loads(result.stdout)
    assert set(output) == OUTPUT_KEYS
    assert output["candidate"]["evidence_basis"] == "unit-fixture"


def test_cli_distinguishes_schema_blockers_from_malformed_input(tmp_path):
    result = cli(tmp_path, preparation_inputs())
    assert result.returncode == 1 and result.stderr == ""
    result = cli(tmp_path, {"candidate": {}, "current": {}, "acceptance": {}})
    assert result.returncode == 1
    assert json.loads(result.stdout)["blockers"] == ["INPUT_SCHEMA_INVALID"]


@pytest.mark.parametrize(
    "extra",
    [("--force",), ("--execute",), ("--cand", "x"), ("--unknown-private-path",)],
)
def test_cli_never_accepts_force_execution_or_abbreviated_flags(tmp_path, extra):
    result = cli(tmp_path, preparation_inputs(), extra)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "unknown-private-path" not in result.stderr
    assert str(tmp_path) not in result.stderr


def test_main_reads_only_three_explicit_files_once_and_sanitizes_load_errors(
    tmp_path, monkeypatch, capsys
):
    inputs = staged_inputs()
    values = [inputs[name] for name in ("candidate", "current", "acceptance")]
    seen = []

    def read(path):
        seen.append(path)
        return values[len(seen) - 1]

    monkeypatch.setattr(planner, "load_input", read)
    assert (
        planner.main(
            ["--candidate", "one", "--current", "two", "--acceptance", "three"]
        )
        == 0
    )
    assert seen == ["one", "two", "three"]
    assert json.loads(capsys.readouterr().out)["blockers"] == []

    def failed(path):
        raise ValueError("SECRET_PATH_DO_NOT_ECHO")

    monkeypatch.setattr(planner, "load_input", failed)
    assert (
        planner.main(
            ["--candidate", "one", "--current", "two", "--acceptance", "three"]
        )
        == 2
    )
    output = capsys.readouterr()
    assert output.out == "" and "SECRET" not in output.err


@pytest.mark.parametrize(
    "mutate,code",
    [
        (
            lambda a: a["profile"]["evidence"][0].update(layer="production"),
            "EVIDENCE_IDENTITY_MISMATCH",
        ),
        (
            lambda a: a["profile"]["evidence"][0].update(conditions_sha256="f" * 64),
            "EVIDENCE_IDENTITY_MISMATCH",
        ),
        (
            lambda a: a["profile"]["evidence"][0].update(evidence_type="unlisted"),
            "ACCEPTANCE_INCOMPLETE",
        ),
        (
            lambda a: a["profile"]["cases"][0].update(evidence=["e0003"]),
            "ACCEPTANCE_INCOMPLETE",
        ),
        (
            lambda a: a["profile"]["cases"][0].update(status="blocked", evidence=[]),
            "ACCEPTANCE_INCOMPLETE",
        ),
        (
            lambda a: a["profile"]["catalog_membership"][0]["conditions"].update(
                zoom=200
            ),
            "EVIDENCE_IDENTITY_MISMATCH",
        ),
        (
            lambda a: a["checks"]["isolated_restore"]["result"].update(
                snapshot_id="other"
            ),
            "RESTORE_NOT_VERIFIED",
        ),
        (
            lambda a: a["checks"]["isolated_restore"]["result"].update(
                target_storage_id="unit-storage"
            ),
            "RESTORE_NOT_VERIFIED",
        ),
        (
            lambda a: a["checks"]["backup_snapshot"]["result"].update(
                hold_id="stale-hold"
            ),
            "BACKUP_NOT_VERIFIED",
        ),
        (
            lambda a: a["checks"]["schema_content"]["result"].update(
                cutoff_id="stale-cutoff"
            ),
            "EVIDENCE_FRESHNESS_UNVERIFIED",
        ),
        (
            lambda a: a["checks"]["served_identity"]["result"]["observations"][1][
                "components"
            ][3].update(source_commit="d" * 40),
            "SOURCE_DEPLOYMENT_IDENTITY_MISMATCH",
        ),
        (
            lambda a: a["checks"]["cookie_upload"]["result"]["observations"][0][
                "patches"
            ][0].update(component_identity_sha256="f" * 64),
            "COOKIE_COMPATIBILITY_UNVERIFIED",
        ),
        (
            lambda a: a["profile"]["provenance"]["proofs"][0].update(
                claim_sha256="f" * 64
            ),
            "EVIDENCE_IDENTITY_MISMATCH",
        ),
    ],
)
def test_independent_corruption_cannot_bypass_a_gate(mutate, code):
    inputs = staged_inputs()
    mutate(inputs["acceptance"])
    if (
        code != "EVIDENCE_IDENTITY_MISMATCH"
        or inputs["acceptance"]["profile"]["provenance"]["proofs"][0]["claim_sha256"]
        != "f" * 64
    ):
        seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), code)


@pytest.mark.parametrize(
    "phase",
    [
        "forward-entry",
        "forward-verification",
        "reverse-entry",
        "reverse-verification",
        "finalize",
    ],
)
def test_unit_fixture_cannot_be_relabelled_as_production(phase):
    inputs = staged_inputs(phase, phase == "finalize")
    for name in ("candidate", "current", "acceptance"):
        inputs[name]["scope"] = "production"
    rebind(inputs)
    acceptance = inputs["acceptance"]
    pair = {name: acceptance[name] for name in ("candidate_sha256", "current_sha256")}
    acceptance["profile"]["binding"].update(scope="production", **pair)
    for proof in (
        acceptance["profile"]["provenance"]["proofs"]
        + acceptance["profile"]["provenance"]["case_contexts"]
    ):
        proof["pair"] = dict(pair)
    seal_claims(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert_blocked(result, "EVIDENCE_SCOPE_MISMATCH")
    assert result["backups_verified"] is False
    assert result["compatibility"] == "unavailable"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda a: a["profile"]["provenance"]["proofs"][0]["record"].update(bytes=0),
        lambda a: a["profile"]["provenance"]["proofs"][0]["record"].update(bytes=True),
        lambda a: a["profile"]["provenance"]["proofs"][0].update(extra="unsafe"),
        lambda a: a["checks"]["backup_snapshot"]["result"].update(data_bytes=2**63),
        lambda a: a["checks"]["backup_snapshot"]["result"].update(data_bytes=True),
        lambda a: a["checks"]["forward_owners"]["result"].update(unseen_count=1),
        lambda a: a["checks"]["user_work"]["result"].update(discarded_count=1),
        lambda a: a["checks"]["schema_content"]["result"].update(
            data_action="snapshot-restore"
        ),
        lambda a: a["checks"]["schema_content"]["result"].update(
            schema_action="downgrade"
        ),
        lambda a: a["checks"]["user_work"]["result"].update(
            update_action="forced-reload"
        ),
        lambda a: a["profile"].update(complete=True),
    ],
)
def test_closed_schema_blocks_unsafe_or_unbounded_success_shapes(mutate):
    inputs = staged_inputs()
    mutate(inputs["acceptance"])
    assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def test_predecessor_cycle_and_future_proof_are_blocked():
    for mutation in ("cycle", "future", "missing"):
        inputs = staged_inputs()
        proof = inputs["acceptance"]["profile"]["provenance"]["proofs"][0]
        if mutation == "cycle":
            proof["predecessor_ids"] = [proof["id"]]
        elif mutation == "future":
            proof["observed_at"] = "2026-11-10T00:00:00Z"
        else:
            proof["predecessor_ids"] = ["unknown-record"]
        seal_claims(inputs)
        result = planner.make_cutover_plan(**inputs)
        assert result["ordered_actions"] == result["rollback_actions"] == []
        assert result["blockers"]


def test_new_reverse_window_cannot_reuse_pre_forward_custody():
    inputs = staged_inputs("reverse-entry")
    inputs["acceptance"]["checks"]["operation_custody"]["result"]["cutoff_id"] = (
        "forward-cutoff"
    )
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


def reseal_bindings(inputs):
    rebind(inputs)
    a = inputs["acceptance"]
    pair = {key: a[key] for key in ("candidate_sha256", "current_sha256")}
    identities = {key: ident(inputs[key]) for key in ("candidate", "current")}
    identities["pair"] = digest(identities)
    a["profile"]["binding"].update(**pair)
    for proof in (
        a["profile"]["provenance"]["proofs"]
        + a["profile"]["provenance"]["case_contexts"]
    ):
        proof["pair"] = dict(pair)
        proof["identity_sha256"] = identities[proof["subject"]]
    return seal_claims(inputs)


def test_actual_unknown_operation_can_only_retain_original_owner_and_check_only_custody():
    inputs = staged_inputs()
    checks = inputs["acceptance"]["checks"]
    checks["forward_owners"]["result"]["owners"] = [
        {
            "owner_id": "unit-owner",
            "client": "legacy-next",
            "client_identity_sha256": ident(inputs["current"]),
            "save": "saved",
            "reconcile": "original-custody-retained",
            "exit": "observed",
            "proof_ids": ["forward-owner"],
        }
    ]
    checks["operation_custody"]["result"].update(
        continuity="compatible-original-owner-retained",
        unknown_count=1,
        entries=[
            {
                "operation_id": "unit-operation",
                "original_owner_id": "unit-owner",
                "original_handle_id": "unit-original-handle",
                "state": "unknown",
                "disposition": "check-only",
                "proof_id": "custody",
            }
        ],
    )
    checks["user_work"]["result"]["items"] = [
        {
            "owner_id": "unit-owner",
            "obligation_id": "unit-draft",
            "kind": "draft",
            "disposition": "saved",
            "saved_record_id": "unit-saved",
        }
    ]
    seal_claims(inputs)
    assert planner.make_cutover_plan(**inputs)["blockers"] == []
    for field, value in (("original_owner_id", "unowned"), ("disposition", "settled")):
        bad = copy.deepcopy(inputs)
        bad["acceptance"]["checks"]["operation_custody"]["result"]["entries"][0][
            field
        ] = value
        seal_claims(bad)
        assert_blocked(
            planner.make_cutover_plan(**bad), "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED"
        )


def test_reverse_uses_a_new_data_cutoff_without_relabelling_historical_backup():
    inputs = staged_inputs("reverse-entry")
    for key in ("reverse_owners", "schema_content", "operation_custody", "user_work"):
        inputs["acceptance"]["checks"][key]["result"]["cutoff_id"] = (
            "new-candidate-epoch"
        )
    seal_claims(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"] == []
    assert result["backups_verified"] is True
    assert (
        inputs["acceptance"]["checks"]["backup_snapshot"]["result"]["cutoff_id"]
        == "forward-cutoff"
    )


def test_source_mismatch_cannot_be_hidden_by_equal_api_contract():
    inputs = staged_inputs()
    old_contract = inputs["candidate"]["components"]["web"]["manifest"][
        "contract_digest"
    ]
    inputs["candidate"]["backend"]["worker_commit"] = "d" * 40
    reseal_bindings(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"] and not result["ordered_actions"]
    assert (
        inputs["candidate"]["components"]["web"]["manifest"]["contract_digest"]
        == old_contract
    )


def test_case_context_requires_primary_family_predecessor_not_just_a_tag():
    inputs = staged_inputs()
    inputs["acceptance"]["profile"]["provenance"]["case_contexts"][1][
        "predecessor_ids"
    ] = ["catalog"]
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_IDENTITY_MISMATCH")


def test_entry_observation_requires_the_actual_directional_owner_event():
    inputs = staged_inputs("forward-verification")
    entry = next(
        p
        for p in inputs["acceptance"]["profile"]["provenance"]["proofs"]
        if p["id"] == "actual-forward-entry"
    )
    entry["predecessor_ids"] = ["artifact-web"]
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


def test_nonpass_reason_must_belong_to_the_check():
    inputs = staged_inputs()
    check = inputs["acceptance"]["checks"]["backup_snapshot"]
    check.update(status="failed", result={"reason": "COOKIE_COMPATIBILITY_FAILED"})
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def test_schema_failure_does_not_render_full_catalog_complete():
    inputs = staged_inputs("finalize", True)
    inputs["acceptance"]["profile"]["provenance"]["case_contexts"][2]["scope"] = (
        "production"
    )
    seal_claims(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"]
    assert result["candidate"]["full_catalog_complete"] is False


def test_compatible_retained_slot_is_bound_by_the_explicit_gateway_claim():
    inputs = staged_inputs()
    gateway = inputs["candidate"]["components"]["gateway"]
    retained = copy.deepcopy(gateway["retained"][0])
    retained["identity"].update(
        release_slot="unit-fixture-older-0001", source_commit="d" * 40
    )
    retained["manifest"]["source_commit"] = "d" * 40
    retained["inventory_header"]["release_slot"] = "unit-fixture-older-0001"
    for filename, document in (
        ("spa-artifact-manifest.json", retained["manifest"]),
        ("artifact-identity.json", retained["identity"]),
    ):
        retained["metadata"][filename] = {
            "bytes": len(canon(document)) + 1,
            "sha256": hashlib.sha256(canon(document) + b"\n").hexdigest(),
        }
    gateway["retained"].append(retained)
    gateway["window"]["retained"].append("unit-fixture-older-0001")
    gateway["window_file"] = {
        "bytes": len(canon(gateway["window"])) + 1,
        "sha256": hashlib.sha256(canon(gateway["window"]) + b"\n").hexdigest(),
    }
    # Every selected declaration is rebound, retaining original older metadata.
    a = inputs["acceptance"]
    new_identity = ident(inputs["candidate"])
    a["checks"]["artifact_association"]["result"]["candidate"]["identity_sha256"] = (
        new_identity
    )
    a["checks"]["served_identity"]["result"]["observations"][1]["identity_sha256"] = (
        new_identity
    )
    a["checks"]["cookie_upload"]["result"]["observations"][1]["identity_sha256"] = (
        new_identity
    )
    a["checks"]["rollback_drill"]["result"]["candidate_identity_sha256"] = new_identity
    a["profile"]["binding"]["window_file_sha256"] = gateway["window_file"]["sha256"]
    reseal_bindings(inputs)
    assert planner.make_cutover_plan(**inputs)["blockers"] == []
    gateway["retained"][1]["identity"]["source_commit"] = C
    assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def final_after_a_later_forward():
    """Historical both-direction evidence remains history after a fresh entry."""
    inputs = staged_inputs("finalize", True)
    donor = staged_inputs("forward-verification")
    a, d = inputs["acceptance"], donor["acceptance"]
    replace_checks = (
        "served_identity",
        "auth_runtime",
        "ingress_topology",
        "cookie_upload",
        "forward_owners",
        "schema_content",
        "operation_custody",
        "user_work",
        "post_entry_acceptance",
    )
    live_names = {
        p["id"]
        for p in d["profile"]["provenance"]["proofs"]
        if p["phase"] in ("after-forward", "before-forward")
        and p["id"] not in {"backup", "restore"}
    }
    rename = {name: "fresh-" + name for name in live_names}

    def remap(value):
        if isinstance(value, str):
            return rename.get(value, value)
        if isinstance(value, list):
            return [remap(item) for item in value]
        if isinstance(value, dict):
            return {key: remap(item) for key, item in value.items()}
        return value

    for key in replace_checks:
        a["checks"][key] = remap(copy.deepcopy(d["checks"][key]))
        if "cutoff_id" in a["checks"][key]["result"]:
            a["checks"][key]["result"]["cutoff_id"] = "fresh-forward-cutoff"
    a["checks"]["operation_custody"]["result"]["hold_id"] = "fresh-forward-hold"
    for item in d["profile"]["provenance"]["proofs"]:
        if item["id"] not in live_names:
            continue
        row = remap(copy.deepcopy(item))
        row["observed_at"] = "2026-11-09T10:07:00Z"
        if item["id"] == "forward-owner":
            row.update(
                observed_at="2026-11-09T10:05:00Z",
                predecessor_ids=["actual-reverse-entry"],
            )
        if item["id"] == "actual-forward-entry":
            row["observed_at"] = "2026-11-09T10:06:00Z"
        a["profile"]["provenance"]["proofs"].append(row)
    a["transition"]["forward_entry_proof_id"] = "fresh-actual-forward-entry"
    # Prune truly unused descriptors; preserve everything referenced by history.
    while True:
        proofs = a["profile"]["provenance"]["proofs"]
        used = set()
        for check in a["checks"].values():
            used.update(check["proof_ids"])
        for row in proofs + a["profile"]["provenance"]["case_contexts"]:
            used.update(row["predecessor_ids"])
        used.update(
            value
            for key, value in a["transition"].items()
            if key.endswith("_proof_id") and value
        )
        retained = [row for row in proofs if row["id"] in used]
        if len(retained) == len(proofs):
            break
        a["profile"]["provenance"]["proofs"] = retained
    return seal_claims(inputs)


def test_finalization_can_select_a_new_forward_target_without_erasing_historical_reverse():
    result = planner.make_cutover_plan(**final_after_a_later_forward())
    assert result["blockers"] == []
    assert result["candidate"]["full_catalog_complete"] is True


def test_import_and_pure_plan_do_not_touch_environment_network_clock_or_files(
    monkeypatch,
):
    # Inputs are assembled before enforcing the pure function boundary.
    inputs = staged_inputs()

    def denied(*args, **kwargs):
        raise AssertionError("Forbidden side effect")

    import builtins
    import socket
    import time

    monkeypatch.setattr(builtins, "open", denied)
    monkeypatch.setattr(os, "open", denied)
    monkeypatch.setattr(os, "getenv", denied)
    monkeypatch.setattr(socket, "socket", denied)
    monkeypatch.setattr(time, "time", denied)
    before = copy.deepcopy(inputs)
    assert planner.make_cutover_plan(**inputs)["blockers"] == []
    assert inputs == before


# Bounds are conjunctive: an inventory fitting its item limit may still exceed
# the independently enforced checks/proofs byte budget.
@pytest.mark.parametrize(
    "field,limit",
    [
        ("proofs-primary", 48),
        ("proofs-supplemental", 16),
        ("contexts", 16),
    ],
)
def test_proof_and_context_count_boundaries(field, limit):
    inputs = staged_inputs()
    provenance = inputs["acceptance"]["profile"]["provenance"]
    if field == "contexts":
        template = provenance["case_contexts"][0]
        provenance["case_contexts"] = [
            dict(copy.deepcopy(template), id=f"c{i:02d}") for i in range(limit)
        ]
        planner.s._staged_shape(inputs["acceptance"])
        provenance["case_contexts"].append(copy.deepcopy(template))
    elif field == "proofs-primary":
        template = provenance["proofs"][0]
        provenance["proofs"] = [
            dict(copy.deepcopy(template), id=f"p{i:02d}") for i in range(limit)
        ]
        planner.s._staged_shape(inputs["acceptance"])
        provenance["proofs"].append(dict(copy.deepcopy(template), id="overflow"))
    else:
        template = copy.deepcopy(provenance["proofs"][0])
        template.update(role="supplemental", family="supplemental-log")
        template["record"]["bytes"] = 0
        provenance["proofs"] += [
            dict(copy.deepcopy(template), id=f"log{i:02d}") for i in range(limit)
        ]
        planner.s._staged_shape(inputs["acceptance"])
        provenance["proofs"].append(dict(copy.deepcopy(template), id="log-overflow"))
    with pytest.raises(ValueError):
        planner.s._staged_shape(inputs["acceptance"])


@pytest.mark.parametrize(
    "check,key,template",
    [
        (
            "forward_owners",
            "owners",
            {
                "owner_id": "owner",
                "client": "legacy-next",
                "client_identity_sha256": H,
                "save": "no-obligation",
                "reconcile": "no-operation",
                "exit": "observed",
                "proof_ids": ["forward-owner"],
            },
        ),
        (
            "operation_custody",
            "entries",
            {
                "operation_id": "op",
                "original_owner_id": "owner",
                "original_handle_id": "original",
                "state": "succeeded",
                "disposition": "settled",
                "proof_id": "custody",
            },
        ),
        (
            "user_work",
            "items",
            {
                "owner_id": "owner",
                "obligation_id": "saved",
                "kind": "file",
                "disposition": "saved",
                "saved_record_id": "saved-record",
            },
        ),
    ],
)
def test_inventory_item_limit_is_256_not_truncation(check, key, template):
    result = staged_inputs()["acceptance"]["checks"][check]["result"]
    identity_key = {
        "owners": "owner_id",
        "entries": "operation_id",
        "items": "obligation_id",
    }[key]
    result[key] = [
        dict(copy.deepcopy(template), **{identity_key: "item-" + str(i)})
        for i in range(256)
    ]
    planner.s._result(check, result)
    result[key].append(dict(copy.deepcopy(template), **{identity_key: "overflow"}))
    with pytest.raises(ValueError):
        planner.s._result(check, result)


def test_primary_record_and_payload_metadata_have_different_byte_limits():
    proof = copy.deepcopy(
        staged_inputs()["acceptance"]["profile"]["provenance"]["proofs"][0]
    )
    proof["record"]["bytes"] = 33554432
    planner.s._proof(proof)
    proof["record"]["bytes"] += 1
    with pytest.raises(ValueError):
        planner.s._proof(proof)
    result = staged_inputs()["acceptance"]["checks"]["backup_snapshot"]["result"]
    result["data_bytes"] = 2**63 - 1
    planner.s._result("backup_snapshot", result)
    result["data_bytes"] = 2**63
    with pytest.raises(ValueError):
        planner.s._result("backup_snapshot", result)


@pytest.mark.parametrize("part", ["catalog_membership", "cases", "evidence"])
def test_catalog_counts_cannot_be_extended_or_truncated(part):
    inputs = staged_inputs("finalize", True)
    rows = inputs["acceptance"]["profile"][part]
    rows.append(copy.deepcopy(rows[0]))
    assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def test_due_obligation_is_not_a_pass_and_future_observed_is_not_prepassed():
    inputs = staged_inputs("forward-verification")
    inputs["acceptance"]["checks"]["post_entry_acceptance"] = {
        "state": "obligation",
        "status": "not_run",
        "proof_ids": [],
        "result": {"obligation": "post_entry_acceptance"},
    }
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "ACCEPTANCE_INCOMPLETE")
    inputs = staged_inputs()
    inputs["acceptance"]["checks"]["reverse_owners"] = {
        "state": "observed",
        "status": "blocked",
        "proof_ids": ["forward-owner"],
        "result": {"reason": "ROLLBACK_CLIENT_WINDOW_UNPROVEN"},
    }
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


def test_each_typed_success_result_rejects_unknown_fields():
    for key in CHECK_IDS:
        inputs = staged_inputs("finalize", True)
        inputs["acceptance"]["checks"][key]["result"]["approved"] = True
        assert_blocked(planner.make_cutover_plan(**inputs), "INPUT_SCHEMA_INVALID")


def test_checks_byte_budget_is_enforced_before_semantic_reduction():
    inputs = staged_inputs()
    result = inputs["acceptance"]["checks"]["forward_owners"]["result"]
    result["owners"] = [
        {
            "owner_id": "o" * 90 + str(i),
            "client": "legacy-next",
            "client_identity_sha256": H,
            "save": "no-obligation",
            "reconcile": "no-operation",
            "exit": "observed",
            "proof_ids": ["forward-owner"],
        }
        for i in range(120)
    ]
    planner.s._result("forward_owners", result)
    assert len(canon(inputs["acceptance"])) < 896 * 1024
    with pytest.raises(ValueError):
        planner.s._staged_shape(inputs["acceptance"])


def test_reader_detects_an_input_changed_during_its_single_read(tmp_path, monkeypatch):
    path = tmp_path / "input.json"
    path.write_text("{}")
    original = os.read

    def changing(fd, count):
        content = original(fd, count)
        path.write_text('{"changed":true}')
        return content

    monkeypatch.setattr(planner.s.os, "read", changing)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_reader_allows_sixteen_container_levels_but_not_seventeen(tmp_path):
    path = tmp_path / "nested.json"
    path.write_text("[" * 16 + "0" + "]" * 16)
    assert planner.load_input(path)
    path.write_text("[" * 17 + "0" + "]" * 17)
    with pytest.raises(ValueError, match="Invalid input"):
        planner.load_input(path)


def test_fresh_import_is_inert(tmp_path):
    root = str(Path(__file__).resolve().parents[1])
    program = (
        "import sys, argparse, hashlib, json, os, re, stat, datetime, typing, socket, time, builtins\n"
        + "sys.path.insert(0, "
        + repr(root)
        + ")\n"
        + "def deny(*a, **k): raise AssertionError('Forbidden import side effect')\n"
        + "os.open = os.getenv = socket.socket = time.time = builtins.open = deny\n"
        + "from scripts.v1 import spa_cutover_plan\n"
        + "assert callable(spa_cutover_plan.make_cutover_plan)\nprint('import-safe')\n"
    )
    result = subprocess.run(
        [sys.executable, "-B", "-c", program],
        cwd=tmp_path,
        env={"PATH": os.defpath, "PYTHON_DOTENV_DISABLED": "1"},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "import-safe\n"
    assert list(tmp_path.iterdir()) == []


def test_cli_help_is_not_a_plan_or_execution(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(Path(__file__).resolve().parents[1] / "scripts/v1/spa_cutover_plan.py"),
            "--help",
        ],
        cwd=tmp_path,
        env={"PATH": os.defpath},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0 and "Structural dry-run only" in result.stdout
    assert result.stderr == ""


def test_cutover_does_not_silently_select_another_storage_or_lock_boundary():
    for key in ("storage_id", "lock_id"):
        inputs = staged_inputs()
        inputs["candidate"]["data_boundary"][key] = "different-boundary"
        inputs["acceptance"]["checks"]["ingress_topology"]["result"]["observations"][1][
            "boundary"
        ][key] = "different-boundary"
        reseal_bindings(inputs)
        assert_blocked(
            planner.make_cutover_plan(**inputs), "TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED"
        )


def test_fresh_entry_and_owner_gate_are_the_same_observed_window():
    inputs = staged_inputs("forward-verification")
    proofs = inputs["acceptance"]["profile"]["provenance"]["proofs"]
    old_owner = copy.deepcopy(next(p for p in proofs if p["id"] == "forward-owner"))
    old_owner["id"] = "unrelated-owner-window"
    proofs.append(old_owner)
    entry = next(p for p in proofs if p["id"] == "actual-forward-entry")
    entry["predecessor_ids"] = ["unrelated-owner-window"]
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


def test_latest_target_schema_cannot_borrow_a_historical_forward_event():
    inputs = final_after_a_later_forward()
    proof = next(
        p
        for p in inputs["acceptance"]["profile"]["provenance"]["proofs"]
        if p["id"] == "fresh-schema"
    )
    proof["predecessor_ids"] = ["actual-forward-entry"]
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


# C3 independent review regressions. These are UNIT declarations, not observations.
@pytest.mark.parametrize("location", ["context", "gate"])
@pytest.mark.parametrize(
    "defect",
    [
        "empty-supplemental",
        "nonempty-supplemental",
        "subject",
        "scope",
        "phase",
        "event",
        "event-subject",
    ],
)
def test_r11_runtime_support_requires_matching_primary_context(location, defect):
    inputs = staged_inputs("finalize", True)
    a = inputs["acceptance"]
    provenance = a["profile"]["provenance"]
    runtime = copy.deepcopy(
        next(p for p in provenance["proofs"] if p["id"] == "runtime-current")
    )
    runtime["id"] = "unit-r11-runtime"
    if defect.endswith("supplemental"):
        runtime["role"] = "supplemental"
        runtime["record"]["bytes"] = 0 if defect == "empty-supplemental" else 1
    elif defect == "subject":
        runtime.update(subject="candidate", identity_sha256=ident(inputs["candidate"]))
    elif defect == "scope":
        # Independently permitted producer/scope, but not this UNIT context's scope.
        runtime.update(scope="synthetic")
        runtime["producer"]["kind"] = "reviewed-synthetic-runtime"
    elif defect == "phase":
        runtime.update(phase="after-forward", predecessor_ids=["actual-forward-entry"])
    else:
        other = copy.deepcopy(
            next(p for p in provenance["proofs"] if p["id"] == "actual-reverse-entry")
        )
        other["id"] = "unit-other-reverse-entry"
        if defect == "event-subject":
            other.update(
                subject="candidate", identity_sha256=ident(inputs["candidate"])
            )
            next(c for c in provenance["case_contexts"] if c["id"] == "c03")[
                "predecessor_ids"
            ].append(other["id"])
        provenance["proofs"].append(other)
        runtime["predecessor_ids"] = [other["id"]]
    provenance["proofs"].append(runtime)
    if location == "context":
        next(c for c in provenance["case_contexts"] if c["id"] == "c03")[
            "predecessor_ids"
        ][0] = runtime["id"]
    # Context mutations also update the gate, so a gate/context disagreement
    # cannot mask an incorrectly admitted context predecessor.
    gate = a["checks"]["catalog_acceptance"]
    for ids in (gate["proof_ids"], gate["result"]["proof_ids"]):
        ids[ids.index("runtime-current")] = runtime["id"]
    seal_claims(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"], (location, defect)
    assert "INPUT_SCHEMA_INVALID" not in result["blockers"]
    assert result["ordered_actions"] == result["rollback_actions"] == []


@pytest.mark.parametrize("state", ["pending", "unknown", "succeeded"])
def test_due_operation_entry_cannot_borrow_an_obsolete_epoch(state):
    inputs = final_after_a_later_forward()
    a = inputs["acceptance"]
    checks, proofs = a["checks"], a["profile"]["provenance"]["proofs"]
    entry_proof = copy.deepcopy(next(p for p in proofs if p["id"] == "fresh-custody"))
    entry_proof["id"] = "unit-individual-custody"
    proofs.append(entry_proof)
    unsettled = state in {"pending", "unknown"}
    if unsettled:
        checks["forward_owners"]["result"]["owners"] = [
            {
                "owner_id": "unit-owner",
                "client": "legacy-next",
                "client_identity_sha256": ident(inputs["current"]),
                "save": "no-obligation",
                "reconcile": "original-custody-retained",
                "exit": "observed",
                "proof_ids": ["fresh-forward-owner"],
            }
        ]
    checks["operation_custody"]["result"].update(
        continuity="compatible-original-owner-retained" if unsettled else "quiescent",
        pending_count=int(state == "pending"),
        unknown_count=int(state == "unknown"),
        entries=[
            {
                "operation_id": "unit-operation",
                "original_owner_id": "unit-owner",
                "original_handle_id": "unit-original",
                "state": state,
                "disposition": "check-only" if unsettled else "settled",
                "proof_id": entry_proof["id"],
            }
        ],
    )
    checks["operation_custody"]["proof_ids"].append(entry_proof["id"])
    seal_claims(inputs)
    assert planner.make_cutover_plan(**inputs)["blockers"] == []
    # Only the individual proof regresses. The inventory and owner gate stay fresh.
    entry_proof.update(
        observed_at="2026-11-09T10:02:00Z",
        predecessor_ids=["actual-forward-entry"],
    )
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


def test_later_forward_verification_preserves_historical_reverse_as_future_obligation():
    inputs = final_after_a_later_forward()
    a = inputs["acceptance"]
    a["phase"] = "forward-verification"
    old_reverse = copy.deepcopy(a["checks"]["reverse_owners"])
    a["checks"]["reverse_owners"] = {
        "state": "obligation",
        "status": "not_run",
        "proof_ids": [],
        "result": {"obligation": "reverse_owners"},
    }
    seal_claims(inputs)
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"] == []
    assert result["candidate"]["full_catalog_complete"] is True
    assert result["ordered_actions"] and result["rollback_actions"]
    assert a["transition"]["reverse_entry_proof_id"] == "actual-reverse-entry"
    a["checks"]["reverse_owners"] = old_reverse
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


def repeat_entry_inputs(phase):
    """Fresh due facts over a complete unchanged historical R11/backup aggregate."""
    inputs = (
        staged_inputs("finalize", True)
        if phase == "forward-entry"
        else final_after_a_later_forward()
    )
    donor = staged_inputs(phase)
    a, d = inputs["acceptance"], donor["acceptance"]
    a["phase"] = phase
    direction = "forward" if phase == "forward-entry" else "reverse"
    prior_entry = a["transition"][
        "reverse_entry_proof_id" if direction == "forward" else "forward_entry_proof_id"
    ]
    names = {
        p["id"]
        for p in d["profile"]["provenance"]["proofs"]
        if p["id"].startswith(("runtime-", "capability-", "ingress-", "transport-"))
        or p["id"] in {direction + "-owner", "schema", "custody", "work"}
    }
    rename = {name: "repeat-" + name for name in names}

    def remap(value):
        if isinstance(value, str):
            return rename.get(value, value)
        if isinstance(value, list):
            return [remap(item) for item in value]
        if isinstance(value, dict):
            return {key: remap(item) for key, item in value.items()}
        return value

    for key in (
        "served_identity",
        "auth_runtime",
        "ingress_topology",
        "cookie_upload",
        direction + "_owners",
        "schema_content",
        "operation_custody",
        "user_work",
        "post_entry_acceptance",
    ) + (("reverse_owners",) if direction == "forward" else ()):
        a["checks"][key] = remap(copy.deepcopy(d["checks"][key]))
        if a["checks"][key]["result"] and "cutoff_id" in a["checks"][key]["result"]:
            a["checks"][key]["result"]["cutoff_id"] = "repeat-entry-cutoff"
    a["checks"]["operation_custody"]["result"]["hold_id"] = "repeat-entry-hold"
    for p in d["profile"]["provenance"]["proofs"]:
        if p["id"] not in names:
            continue
        row = remap(copy.deepcopy(p))
        row["observed_at"] = "2026-11-09T10:08:00Z"
        if row["phase"] != "rehearsal":
            row["predecessor_ids"] = [prior_entry]
        a["profile"]["provenance"]["proofs"].append(row)
    # Preserve every historical descriptor still used by a context, event or gate.
    while True:
        proofs = a["profile"]["provenance"]["proofs"]
        used = {pid for check in a["checks"].values() for pid in check["proof_ids"]}
        used.update(
            pid
            for row in proofs + a["profile"]["provenance"]["case_contexts"]
            for pid in row["predecessor_ids"]
        )
        used.update(
            pid
            for key, pid in a["transition"].items()
            if key.endswith("_proof_id") and pid
        )
        retained = [row for row in proofs if row["id"] in used]
        if len(retained) == len(proofs):
            break
        a["profile"]["provenance"]["proofs"] = retained
    return seal_claims(inputs)


@pytest.mark.parametrize("phase", ["forward-entry", "reverse-entry"])
def test_repeat_entry_preserves_history_and_requires_a_fresh_directional_window(phase):
    inputs = repeat_entry_inputs(phase)
    a = inputs["acceptance"]
    backup = copy.deepcopy(a["checks"]["backup_snapshot"])
    restore = copy.deepcopy(a["checks"]["isolated_restore"])
    result = planner.make_cutover_plan(**inputs)
    assert result["blockers"] == []
    assert result["candidate"]["full_catalog_complete"] is True
    assert result["backups_verified"] is True
    assert result["ordered_actions"] and result["rollback_actions"]
    assert (
        backup["result"]["cutoff_id"]
        != a["checks"]["operation_custody"]["result"]["cutoff_id"]
    )
    direction = "forward" if phase == "forward-entry" else "reverse"
    owner = next(
        p
        for p in a["profile"]["provenance"]["proofs"]
        if p["id"] == "repeat-" + direction + "-owner"
    )
    owner["predecessor_ids"] = []
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")
    assert a["checks"]["backup_snapshot"] == backup
    assert a["checks"]["isolated_restore"] == restore


def test_first_entry_still_requires_snapshot_at_its_current_cutoff_and_hold():
    inputs = staged_inputs()
    inputs["acceptance"]["checks"]["operation_custody"]["result"]["hold_id"] = (
        "other-hold"
    )
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "BACKUP_NOT_VERIFIED")


def test_historical_entry_still_requires_its_own_primary_owner():
    inputs = final_after_a_later_forward()
    a = inputs["acceptance"]
    a["phase"] = "forward-verification"
    a["checks"]["reverse_owners"] = {
        "state": "obligation",
        "status": "not_run",
        "proof_ids": [],
        "result": {"obligation": "reverse_owners"},
    }
    reverse = next(
        p
        for p in a["profile"]["provenance"]["proofs"]
        if p["id"] == "actual-reverse-entry"
    )
    reverse["predecessor_ids"] = ["actual-forward-entry"]
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


@pytest.mark.parametrize("phase", ["forward-entry", "reverse-entry"])
def test_repeat_entry_checks_each_operation_epoch_not_only_its_inventory(phase):
    inputs = repeat_entry_inputs(phase)
    a = inputs["acceptance"]
    custody = a["checks"]["operation_custody"]
    proof = copy.deepcopy(
        next(
            p
            for p in a["profile"]["provenance"]["proofs"]
            if p["id"] == "repeat-custody"
        )
    )
    proof["id"] = "unit-repeat-individual"
    a["profile"]["provenance"]["proofs"].append(proof)
    custody["result"]["entries"] = [
        {
            "operation_id": "unit-settled",
            "original_owner_id": "unit-original-owner",
            "original_handle_id": "unit-original-handle",
            "state": "succeeded",
            "disposition": "settled",
            "proof_id": proof["id"],
        }
    ]
    custody["proof_ids"].append(proof["id"])
    seal_claims(inputs)
    assert planner.make_cutover_plan(**inputs)["blockers"] == []
    proof["predecessor_ids"] = (
        [] if phase == "forward-entry" else ["actual-forward-entry"]
    )
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")


@pytest.mark.parametrize("phase", ["forward-verification", "reverse-verification"])
def test_active_entry_cannot_replace_its_gate_with_an_unrelated_owner_window(phase):
    inputs = staged_inputs(phase)
    a = inputs["acceptance"]
    direction = "forward" if phase == "forward-verification" else "reverse"
    old = next(
        p
        for p in a["profile"]["provenance"]["proofs"]
        if p["id"] == direction + "-owner"
    )
    other = copy.deepcopy(old)
    other["id"] = "unit-unrelated-" + direction + "-owner"
    a["profile"]["provenance"]["proofs"].append(other)
    a["checks"][direction + "_owners"]["proof_ids"] = [other["id"]]
    seal_claims(inputs)
    assert_blocked(planner.make_cutover_plan(**inputs), "EVIDENCE_FRESHNESS_UNVERIFIED")
