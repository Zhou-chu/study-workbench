"""Pure portable-project validation; no archive, directory, store or HTTP access."""

import copy
import hashlib
from pathlib import PurePosixPath

import pytest

from api import portable_service as subject
from open_notebook.exceptions import InvalidInputError


def project():
    value = {kind: [] for kind in subject.FILES}
    value["notebook"] = {"id": "notebook:one", "name": "Synthetic"}
    value["sources"] = [{"id": "source:one"}]
    value["notes"] = [{"id": "note:one", "content": "Saved"}]
    value["version"] = [
        {
            "source_version_id": "sv_one",
            "source_id": "source:one",
            "mime_type": "text/plain",
            "origin": "upload",
            "current_extraction_id": "ex_one",
        }
    ]
    locator = {
        "block_id": "block-one",
        "start_offset": 6,
        "end_offset": 16,
        "page_index": 0,
        "page_label": "1",
        "bbox": [0, 0, 1, 1],
    }
    value["extraction"] = [
        {
            "extraction_id": "ex_one",
            "source_version_id": "sv_one",
            "evidence_ids": ["ev_one"],
            "page_count": 1,
            "blocks": [
                {
                    "block_id": "block-one",
                    "text": "Intro Alpha beta tail",
                    "page_index": 0,
                    "page_label": "1",
                    "bbox": [0, 0, 1, 1],
                }
            ],
        }
    ]
    value["evidence"] = [
        {
            "evidence_id": "ev_one",
            "extraction_id": "ex_one",
            "source_version_id": "sv_one",
            "quote": "Alpha beta",
            "quote_hash": hashlib.sha256(b"Alpha beta").hexdigest(),
            "locator": locator,
        }
    ]
    value["turn"] = [
        {
            "turn_id": "turn_one",
            "scope_snapshot": {"source_version_ids": ["sv_one"]},
            "evidence_ids": ["ev_one"],
            "citations": [
                {
                    "reference_validity": "verified",
                    "evidence_id": "ev_one",
                    "source_version_id": "sv_one",
                    "quote": "beta",
                    "locator": {**locator, "start_offset": 12},
                }
            ],
        }
    ]
    return value


def test_closed_project_validates_real_quote_and_normalizes_legacy_revision():
    value = project()
    subject._validate_project(value, set())
    assert value["notes"][0]["revision"] == 1
    assert value["turn"][0]["citations"][0]["locator"]["start_offset"] == 12


@pytest.mark.parametrize(
    "kind,record,expected",
    [
        ("sources", {"id": "source:one"}, "source:one"),
        ("link", {"link_id": "", "notebook_id": "notebook:one"}, "notebook:one"),
        (
            "import_report",
            {"import_report_id": False, "report_id": "report_one"},
            "report_one",
        ),
        ("version", {"source_version_id": "x" * 512}, "x" * 512),
    ],
)
def test_identity_uses_valid_kind_specific_fallback(kind, record, expected):
    assert subject._identity(kind, record) == expected


@pytest.mark.parametrize("value", [None, "", False, 3, "x" * 513])
def test_identity_rejects_missing_wrong_type_and_oversize(value):
    with pytest.raises(InvalidInputError, match="no valid identity"):
        subject._identity("sources", {"id": value})


def test_clean_recursively_drops_managed_fields_without_mutating_input():
    value = {
        "title": "Keep",
        "nested": [
            {
                "API_KEY": "synthetic",
                "source_url": "synthetic",
                "command": "run",
                "good": [1, None, True],
            }
        ],
        7: "number key",
        "ordinary": PurePosixPath("relative"),
    }
    before = copy.deepcopy(value)
    assert subject._clean(value) == {
        "title": "Keep",
        "nested": [{"good": [1, None, True]}],
        "7": "number key",
        "ordinary": "relative",
    }
    assert value == before


@pytest.mark.parametrize(
    "name",
    [
        None,
        "",
        "x" * 513,
        "a\\b",
        "a\x00b",
        "/absolute",
        "../x",
        "a/../b",
        "a/./b",
        "a//b",
        "a/",
        "C:drive",
    ],
)
def test_archive_member_rejects_unsafe_names_without_filesystem(name):
    with pytest.raises(InvalidInputError, match="Unsafe archive path"):
        subject._safe_member(name)


@pytest.mark.parametrize(
    "name", ["originals/lesson.txt", "artifacts/音声.mp3", "x" * 512]
)
def test_archive_member_returns_pure_posix_path(name):
    assert subject._safe_member(name) == PurePosixPath(name)


@pytest.mark.parametrize("revision", [0, -1, True, False, None, "1", 1.0])
@pytest.mark.parametrize("where", ["note", "snapshot"])
def test_revision_validation_rejects_invalid_values_before_any_normalization(
    revision, where
):
    notes = [{"id": "note:one"}]
    snapshots = [{"note_id": "note:one"}]
    (notes if where == "note" else snapshots)[0]["revision"] = revision
    before = copy.deepcopy((notes, snapshots))
    with pytest.raises(InvalidInputError, match="Invalid portable note revision"):
        subject.normalize_note_revisions(notes, snapshots)
    assert (notes, snapshots) == before


@pytest.mark.parametrize(
    "snapshot",
    [{"note_id": "note:other", "revision": 3}, {"note_id": "note:one", "revision": 2}],
)
def test_revision_snapshot_requires_exact_native_identity_and_revision(snapshot):
    notes = [{"id": "note:one", "revision": 3}]
    before = copy.deepcopy((notes, snapshot))
    with pytest.raises(InvalidInputError, match="Inconsistent portable note revisions"):
        subject.normalize_note_revisions(notes, [snapshot])
    assert (notes, snapshot) == before


def test_legacy_and_large_positive_revisions_are_preserved_exactly():
    notes = [{"id": "note:one"}, {"id": "note:two", "revision": 2**60}]
    snapshots = [{"note_id": "note:one"}, {"note_id": "note:two", "revision": 2**60}]
    subject.normalize_note_revisions(notes, snapshots)
    assert [row["revision"] for row in notes] == [1, 2**60]
    assert [row["revision"] for row in snapshots] == [1, 2**60]


@pytest.mark.parametrize(
    "mutation,reason",
    [
        (lambda p: p.pop("artifact"), "entity collections"),
        (lambda p: p.update(extra=[]), "entity collections"),
        (lambda p: p.update(notebook=[]), "entity collections"),
        (lambda p: p.update(sources={}), "Invalid sources records"),
        (lambda p: p["sources"].append(None), "Invalid sources records"),
        (lambda p: p["sources"].append(dict(p["sources"][0])), "Duplicate sources"),
        (lambda p: p["notebook"].update(name="  "), "needs a name"),
        (
            lambda p: p["sources"][0].update(notebook_id="notebook:other"),
            "Cross-project",
        ),
        (lambda p: p["sources"][0].update(note_id="note:missing"), "Dangling note_id"),
        (
            lambda p: p["sources"][0].update(parent_id="source:missing"),
            "Dangling chat parent",
        ),
        (
            lambda p: p["source_insights"].append(
                {"id": "insight:one", "source": "source:missing"}
            ),
            "Dangling source insight",
        ),
        (
            lambda p: p["turn"][0].update(evidence_ids=["ev_missing"]),
            "Dangling evidence_ids",
        ),
        (lambda p: p["turn"][0].update(evidence_ids="ev_one"), "Dangling evidence_ids"),
        (
            lambda p: p["sources"][0].update(asset={"file_path": "originals/missing"}),
            "Dangling file",
        ),
    ],
)
def test_entity_collection_closure_rejects_invalid_project(mutation, reason):
    value = project()
    mutation(value)
    with pytest.raises(InvalidInputError, match=reason):
        subject._validate_project(value, set())


@pytest.mark.parametrize(
    "key",
    [
        "API_KEY",
        "password",
        "nested_credential",
        "access_token",
        "model_override",
        "url",
        "source_URL",
    ],
)
def test_nested_managed_secret_and_runtime_fields_cannot_enter_archive(key):
    value = project()
    value["sources"][0]["metadata"] = [{key: "synthetic-only"}]
    with pytest.raises(InvalidInputError, match="disallowed secret or runtime"):
        subject._validate_project(value, set())


@pytest.mark.parametrize(
    "field,value",
    [
        ("block_id", "missing"),
        ("start_offset", True),
        ("end_offset", 16.0),
        ("start_offset", -1),
        ("end_offset", 5),
        ("end_offset", 99),
        ("start_offset", 7),
        ("page_index", 1),
        ("page_label", "wrong"),
        ("bbox", [1, 2, 3, 4]),
    ],
)
def test_evidence_locator_is_bound_to_exact_retained_block(field, value):
    data = project()
    data["evidence"][0]["locator"][field] = value
    with pytest.raises(InvalidInputError, match="Evidence locator integrity"):
        subject._validate_project(data, set())


def test_evidence_hash_cannot_be_replaced_with_unverified_quote():
    data = project()
    data["evidence"][0]["quote_hash"] = "0" * 64
    with pytest.raises(InvalidInputError, match="Evidence quote integrity"):
        subject._validate_project(data, set())


@pytest.mark.parametrize(
    "field,value",
    [
        ("source_version_id", None),
        ("quote", "absent"),
        ("quote", ""),
        ("quote", 9),
        ("locator", {"start_offset": 0}),
    ],
)
def test_verified_citation_requires_matching_identity_quote_and_locator(field, value):
    data = project()
    data["turn"][0]["citations"][0][field] = value
    with pytest.raises(InvalidInputError, match="Verified citation"):
        subject._validate_project(data, set())


@pytest.mark.parametrize(
    "mutation,reason",
    [
        (
            lambda row: row.update(scope_snapshot={"source_version_ids": []}),
            "outside the frozen",
        ),
        (lambda row: row.update(scope_snapshot={}), "answer evidence scope"),
        (lambda row: row.pop("evidence_ids"), "answer evidence scope"),
        (lambda row: row.update(evidence_ids=[]), "answer evidence scope"),
    ],
)
def test_verified_turn_citation_cannot_escape_frozen_or_supplied_scope(
    mutation, reason
):
    data = project()
    mutation(data["turn"][0])
    with pytest.raises(InvalidInputError, match=reason):
        subject._validate_project(data, set())


def test_repeated_subquote_is_not_a_verified_unique_locator():
    data = project()
    data["extraction"][0]["blocks"][0]["text"] = "Intro beta beta tail"
    data["evidence"][0].update(
        quote="beta beta", quote_hash=hashlib.sha256(b"beta beta").hexdigest()
    )
    data["evidence"][0]["locator"]["end_offset"] = 15
    with pytest.raises(InvalidInputError, match="quote is invalid or ambiguous"):
        subject._validate_project(data, set())


def test_unverified_historical_citation_does_not_claim_locator_validation():
    data = project()
    data["turn"][0]["citations"][0].update(
        reference_validity="historical", locator={"arbitrary": True}
    )
    subject._validate_project(data, set())


@pytest.mark.parametrize(
    "target,path,reason",
    [
        ("version", "artifacts/wrong", "binary payload directory"),
        ("artifact", "originals/wrong", "binary payload directory"),
        ("source", "artifacts/wrong", "originals directory"),
    ],
)
def test_existing_file_members_must_belong_to_correct_entity_directory(
    target, path, reason
):
    data = project()
    if target == "source":
        data["sources"][0]["asset"] = {"file_path": path}
    elif target == "artifact":
        data["artifact"] = [
            {
                "artifact_id": "artifact_one",
                "file_path": path,
                "mime_type": "audio/mpeg",
            }
        ]
    else:
        data["version"][0]["file_path"] = path
    with pytest.raises(InvalidInputError, match=reason):
        subject._validate_project(data, {path})


@pytest.mark.parametrize(
    "field,value,reason",
    [
        ("origin", "executable", "Unsupported source provenance"),
        ("mime_type", "application/executable", "Unsupported original MIME"),
        ("original_status", "available", "Available original has no file"),
        ("origin", "derived_snapshot", "Invalid source snapshot provenance"),
        ("origin", "web_snapshot", "Invalid source snapshot provenance"),
    ],
)
def test_version_rejects_unsupported_or_incomplete_metadata(field, value, reason):
    data = project()
    data["version"][0][field] = value
    with pytest.raises(InvalidInputError, match=reason):
        subject._validate_project(data, set())


def test_artifact_requires_supported_audio_mime():
    data = project()
    data["artifact"] = [{"artifact_id": "artifact_one", "mime_type": "text/html"}]
    with pytest.raises(InvalidInputError, match="Unsupported artifact MIME"):
        subject._validate_project(data, set())


@pytest.mark.parametrize("page_count", [True, None, 0, -1])
def test_locator_page_must_fit_integer_page_count(page_count):
    data = project()
    data["extraction"][0]["page_count"] = page_count
    with pytest.raises(InvalidInputError, match="Evidence locator integrity"):
        subject._validate_project(data, set())


@pytest.mark.parametrize(
    "mode", ["extraction_membership", "current_version", "evidence_version"]
)
def test_known_entities_still_require_consistent_version_extraction_relationships(mode):
    data = project()
    data["version"].append({"source_version_id": "sv_two", "mime_type": "text/plain"})
    data["extraction"].append(
        {"extraction_id": "ex_two", "source_version_id": "sv_two", "evidence_ids": []}
    )
    if mode == "extraction_membership":
        data["extraction"][1]["evidence_ids"] = ["ev_one"]
        reason = "Evidence/extraction reference mismatch"
    elif mode == "current_version":
        data["version"][0]["current_extraction_id"] = "ex_two"
        reason = "Current extraction reference mismatch"
    else:
        data["extraction"][0]["evidence_ids"] = []
        data["evidence"][0]["extraction_id"] = "ex_two"
        reason = "Evidence version reference mismatch"
    with pytest.raises(InvalidInputError, match=reason):
        subject._validate_project(data, set())


def test_unicode_citation_offsets_are_codepoints_not_utf16_units():
    data = project()
    data["extraction"][0]["blocks"][0]["text"] = "引言🌍中文资料尾"
    item = data["evidence"][0]
    item.update(
        quote="🌍中文资料", quote_hash=hashlib.sha256("🌍中文资料".encode()).hexdigest()
    )
    item["locator"].update(start_offset=2, end_offset=7)
    citation = data["turn"][0]["citations"][0]
    citation.update(
        quote="中文", locator={**item["locator"], "start_offset": 3, "end_offset": 5}
    )
    subject._validate_project(data, set())
    assert data["extraction"][0]["blocks"][0]["text"][3:5] == citation["quote"]
    citation["locator"].update(start_offset=4, end_offset=6)
    with pytest.raises(InvalidInputError, match="Verified citation locator"):
        subject._validate_project(data, set())
