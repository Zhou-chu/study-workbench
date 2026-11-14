"""CLI/tool integration only: real subprocess and owned temporary fixture files."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts/quality/test_layers.py"


def fixture(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "api").mkdir()
    (tmp_path / "api/a.py").write_text("value = 1")
    test = tmp_path / "tests/test_a.py"
    test.write_text("synthetic static test bytes")
    manifest = tmp_path / "layers.json"
    manifest.write_text(
        json.dumps(
            {
                "version": 1,
                "entries": [
                    {
                        "path": "tests/test_a.py",
                        "layer": "unit",
                        "targets": ["api/a.py"],
                        "reason": "Synthetic validator input, not an executed test.",
                        "sha256": hashlib.sha256(test.read_bytes()).hexdigest(),
                    }
                ],
            }
        )
    )
    inventory = tmp_path / "inventory"
    inventory.write_bytes(b"tests/test_a.py\0api/a.py\0")
    return test, manifest, inventory


def invoke(root, manifest, inventory):
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(root),
            "--manifest",
            str(manifest),
            "--inventory",
            str(inventory),
        ],
        env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
        capture_output=True,
        text=True,
        timeout=2,
    )
    return result.returncode, json.loads(result.stdout)


def test_cli_reads_manifest_inventory_and_real_test_digest(tmp_path):
    test, manifest, inventory = fixture(tmp_path)
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 0 and report["ok"]
    test.write_text("changed bytes")
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 1 and not report["ok"]
    assert any("digest" in error for error in report["errors"])


@pytest.mark.parametrize(
    "raw",
    [
        b"tests/test_a.py",
        b"tests/../test_a.py\0",
        b"tests/../../escape.test.ts\0",
        b"\xff\0",
    ],
)
def test_cli_rejects_invalid_inventory(tmp_path, raw):
    _, manifest, inventory = fixture(tmp_path)
    inventory.write_bytes(raw)
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 1 and not report["ok"]


@pytest.mark.parametrize("kind", ["directory", "symlink", "fifo"])
def test_cli_rejects_nonregular_test_before_reading(tmp_path, kind):
    test, manifest, inventory = fixture(tmp_path)
    test.unlink()
    if kind == "directory":
        test.mkdir()
    elif kind == "symlink":
        test.symlink_to(tmp_path / "api/a.py")
    else:
        os.mkfifo(test)
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 1 and not report["ok"]
    assert any("regular file" in error for error in report["errors"])


@pytest.mark.parametrize("document", [None, [], "not a manifest", 7])
def test_cli_nonobject_json_has_structured_failure(tmp_path, document):
    _, manifest, inventory = fixture(tmp_path)
    manifest.write_text(json.dumps(document))
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 1
    assert report["ok"] is False
    assert report["errors"] == ["invalid manifest version/document"]


@pytest.mark.parametrize("entries", [None, 7, "not a list"])
def test_cli_invalid_entries_has_structured_failure(tmp_path, entries):
    _, manifest, inventory = fixture(tmp_path)
    manifest.write_text(json.dumps({"version": 1, "entries": entries}))
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 1
    assert report["ok"] is False
    assert report["errors"] == ["entries must be a list"]


def test_project_cli_rejects_empty_inventory_even_with_empty_manifest(tmp_path):
    _, manifest, inventory = fixture(tmp_path)
    inventory.write_bytes(b"")
    manifest.write_text(json.dumps({"version": 1, "entries": []}))
    code, report = invoke(tmp_path, manifest, inventory)
    assert code == 1 and report["ok"] is False
    assert "empty project inventory" in report["errors"][0]
