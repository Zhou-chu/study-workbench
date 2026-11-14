"""Pure validator units: in-memory inventories, no subprocess or filesystem I/O."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "test_layers", Path(__file__).parents[1] / "scripts/quality/test_layers.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def entry(path="tests/test_a.py", layer="unit"):
    return {
        "path": path,
        "layer": layer,
        "targets": ["api/a.py"],
        "reason": "Direct function with dependency stubs.",
        "sha256": "a" * 64,
    }


def check(entries=None, inventory=None, hashes=None):
    return module.validate_manifest(
        {"version": 1, "entries": [entry()] if entries is None else entries},
        ["tests/test_a.py", "api/a.py"] if inventory is None else inventory,
        {"tests/test_a.py": "a" * 64} if hashes is None else hashes,
    )


def test_valid_single_unit_is_selectable():
    assert check() == []


@pytest.mark.parametrize("layer", ["unclassified", "mixed"])
def test_unresolved_files_fail_closed(layer):
    assert any("unresolved" in error for error in check([entry(layer=layer)]))


def test_duplicate_classification_is_rejected():
    assert any("duplicate" in error for error in check([entry(), entry()]))


def test_missing_new_test_is_rejected():
    assert any(
        "missing" in error
        for error in check(
            inventory=["tests/test_a.py", "tests/test_new.py", "api/a.py"]
        )
    )


def test_stale_test_is_rejected():
    assert any("stale" in error for error in check(inventory=["api/a.py"]))


def test_changed_test_requires_review():
    assert any(
        "digest" in error for error in check(hashes={"tests/test_a.py": "b" * 64})
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"targets": []},
        {"targets": ["api/missing.py"]},
        {"reason": ""},
        {"layer": "integration-ish"},
        {"path": "../tests/test_a.py"},
        {"sha256": "not-a-hash"},
    ],
)
def test_invalid_metadata_is_rejected(patch):
    record = entry()
    record.update(patch)
    assert check([record])


def test_all_test_extensions_and_locations_are_inventoried():
    paths = [
        "tests/nested/test_a.py",
        "tests/a_test.py",
        "apps/web/src/a.test.tsx",
        "frontend/src/a.spec.ts",
        "apps/web/scripts/a.test.mjs",
        "scripts/tests/quality/a.test.ts",
        "scripts/tests/quality/a.test.cjs",
    ]
    assert module.test_paths(paths) == sorted(paths)
    assert (
        module.test_paths(["api/main.py", "tests/conftest.py", "docs/a.test.ts"]) == []
    )


def test_inventory_cannot_hide_duplicate_paths():
    assert any(
        "inventory" in error
        for error in check(inventory=["tests/test_a.py", "tests/test_a.py", "api/a.py"])
    )


def test_unknown_schema_is_rejected():
    assert module.validate_manifest({"version": 2, "entries": []}, [], {})


def test_malformed_document_is_rejected():
    for value in [None, [], {"version": 1}, {"version": 1, "entries": [None]}]:
        assert module.validate_manifest(value, [], {})


def test_selection_never_returns_partial_unit_list():
    document = {"version": 1, "entries": [entry()]}
    assert module.select_unit_paths(
        document, ["tests/test_a.py", "api/a.py"], {"tests/test_a.py": "a" * 64}
    ) == ["tests/test_a.py"]
    document["entries"].append(entry("tests/test_b.py", "unclassified"))
    with pytest.raises(ValueError, match="unresolved"):
        module.select_unit_paths(
            document,
            ["tests/test_a.py", "tests/test_b.py", "api/a.py"],
            {"tests/test_a.py": "a" * 64, "tests/test_b.py": "a" * 64},
        )


@pytest.mark.parametrize(
    "inventory", [[[]], [{}], [None], [3], None, "tests/test_a.py"]
)
def test_malformed_inventory_returns_errors_instead_of_raising(inventory):
    assert module.validate_manifest({"version": 1, "entries": []}, inventory, {})
