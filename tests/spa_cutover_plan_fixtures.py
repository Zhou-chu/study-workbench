"""Synthetic declarations only; no observations or production custody."""

import copy
import hashlib
import json
from pathlib import Path


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
