"""Read-only exact acceptance catalog and evidence-gate source contracts."""

import os

import pytest
from spa_acceptance_contract_fixtures import ROOT, helper

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
