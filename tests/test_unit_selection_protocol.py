"""Pure selection protocol tests; no filesystem, Git, or test execution."""

import copy
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "unit_selection_policy",
    Path(__file__).parents[1] / "scripts/quality/test_layers.py",
)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def inputs():
    paths = [
        "api/a.py",
        "scripts/quality/test-layers.json",
        "tests/test_a.py",
        "tests/test_b.py",
    ]
    hashes = {path: str(index + 1) * 64 for index, path in enumerate(paths)}
    document = {
        "version": 1,
        "entries": [
            {
                "path": path,
                "sha256": hashes[path],
                "layer": layer,
                "targets": ["api/a.py"],
                "reason": "Synthetic classified boundary.",
            }
            for path, layer in [
                ("tests/test_a.py", "unit"),
                ("tests/test_b.py", "api-integration"),
            ]
        ],
    }
    return {
        "revision": "a" * 40,
        "inventory": paths,
        "hashes": hashes,
        "document": document,
    }


def build(current=None):
    return policy.build_unit_selection(**(inputs() if current is None else current))


def test_selection_is_explicit_unit_files_with_complete_input_binding():
    current = inputs()
    result = build(current)
    assert result["version"] == 1
    assert result["layer"] == "unit"
    assert result["revision"] == current["revision"]
    assert result["unitFiles"] == ["tests/test_a.py"]
    assert result["inventory"] == current["inventory"]
    assert result["fileHashes"] == current["hashes"]
    assert result["testHashes"] == {
        path: current["hashes"][path]
        for path in current["inventory"]
        if path.startswith("tests/")
    }
    for key in ["inventorySha256", "classificationSha256", "sourceSha256"]:
        assert len(result[key]) == 64
    assert policy.validate_unit_selection(result, **current) == ["tests/test_a.py"]


@pytest.mark.parametrize("layer", ["mixed", "unclassified", "unknown"])
def test_no_partial_executable_selection_for_any_unresolved_file(layer):
    current = inputs()
    current["document"]["entries"][1]["layer"] = layer
    with pytest.raises(ValueError):
        build(current)


@pytest.mark.parametrize(
    "field",
    [
        "version",
        "layer",
        "revision",
        "unitFiles",
        "inventory",
        "fileHashes",
        "testHashes",
        "inventorySha256",
        "classificationSha256",
        "sourceSha256",
    ],
)
def test_runner_rejects_tampered_binding_fields(field):
    result = build()
    result[field] = None
    with pytest.raises(ValueError):
        policy.validate_unit_selection(result, **inputs())


@pytest.mark.parametrize(
    "files",
    [
        [],
        ["tests"],
        ["tests/test_b.py"],
        ["../tests/test_a.py"],
        ["tests/test_a.py", "tests/test_a.py"],
    ],
)
def test_runner_never_falls_back_to_directory_or_accepts_nonunit_files(files):
    result = build()
    result["unitFiles"] = files
    with pytest.raises(ValueError):
        policy.validate_unit_selection(result, **inputs())


@pytest.mark.parametrize(
    "changed", ["revision", "source", "test", "classification", "inventory"]
)
def test_runner_recomputes_against_current_authoritative_inputs(changed):
    result = build()
    current = inputs()
    if changed == "revision":
        current["revision"] = "b" * 40
    elif changed == "source":
        current["hashes"]["api/a.py"] = "f" * 64
    elif changed == "test":
        current["hashes"]["tests/test_a.py"] = "f" * 64
        current["document"]["entries"][0]["sha256"] = "f" * 64
    elif changed == "classification":
        current["document"]["entries"][0]["reason"] = "Changed review."
    else:
        current["inventory"].append("api/new.py")
        current["hashes"]["api/new.py"] = "f" * 64
    with pytest.raises(ValueError):
        policy.validate_unit_selection(result, **current)


@pytest.mark.parametrize(
    "mutation", ["missing", "extra", "invalid", "duplicate", "unsafe", "revision"]
)
def test_input_binding_rejects_incomplete_or_malformed_inventory(mutation):
    current = inputs()
    if mutation == "missing":
        del current["hashes"]["api/a.py"]
    elif mutation == "extra":
        current["hashes"]["api/hidden.py"] = "f" * 64
    elif mutation == "invalid":
        current["hashes"]["api/a.py"] = "not a digest"
    elif mutation == "duplicate":
        current["inventory"].append("api/a.py")
    elif mutation == "unsafe":
        current["inventory"].append("../outside")
        current["hashes"]["../outside"] = "f" * 64
    else:
        current["revision"] = "HEAD"
    with pytest.raises(ValueError):
        build(current)


def test_digest_order_is_deterministic_and_returned_data_does_not_alias_inputs():
    current = inputs()
    reordered = copy.deepcopy(current)
    reordered["inventory"].reverse()
    reordered["hashes"] = dict(reversed(list(reordered["hashes"].items())))
    assert build(current) == build(reordered)
    result = build(current)
    result["inventory"].clear()
    result["fileHashes"].clear()
    assert current == inputs()


def test_unknown_artifact_fields_are_not_silently_accepted():
    result = build()
    result["fallbackDirectory"] = "tests"
    with pytest.raises(ValueError):
        policy.validate_unit_selection(result, **inputs())


def test_no_unit_files_is_failure_not_an_implicit_full_suite():
    current = inputs()
    current["document"]["entries"][0]["layer"] = "api-integration"
    with pytest.raises(ValueError, match="unit"):
        build(current)


def test_each_summary_digest_tracks_its_named_input():
    initial = build()
    current = inputs()
    current["hashes"]["api/a.py"] = "f" * 64
    assert build(current)["sourceSha256"] != initial["sourceSha256"]
    current = inputs()
    current["document"]["entries"][0]["reason"] = "Different reviewed reason."
    assert build(current)["classificationSha256"] != initial["classificationSha256"]
    current = inputs()
    current["inventory"].append("docs/context.md")
    current["hashes"]["docs/context.md"] = "f" * 64
    assert build(current)["inventorySha256"] != initial["inventorySha256"]


def test_boolean_version_cannot_impersonate_integer_version():
    artifact = build()
    artifact["version"] = True
    with pytest.raises(ValueError):
        policy.validate_unit_selection(artifact, **inputs())


@pytest.mark.parametrize("version", [True, 1.0, False, "1", None])
def test_manifest_version_requires_integer_schema_version(version):
    current = inputs()
    current["document"]["version"] = version
    with pytest.raises(ValueError, match="invalid manifest version/document"):
        build(current)
