"""Pure cutover planning contracts over synthetic declarations; no execution."""

import copy
import hashlib
import json
import os

import pytest
from spa_cutover_plan_fixtures import (
    CHECK_IDS,
    OUTPUT_KEYS,
    C,
    H,
    assert_blocked,
    canon,
    final_after_a_later_forward,
    ident,
    native_inputs,
    preparation_inputs,
    rebind,
    repeat_entry_inputs,
    reseal_bindings,
    seal_claims,
    staged_inputs,
    unavailable_checks,
)

from scripts.v1 import spa_cutover_plan as planner


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
