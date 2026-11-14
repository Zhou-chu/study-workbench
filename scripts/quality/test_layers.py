"""Fail-closed test-layer policy. Selection only; never changes coverage scope."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path, PurePosixPath
from typing import TypeGuard, cast

LAYERS = {
    "unit",
    "component-integration",
    "api-integration",
    "tool-integration",
    "system-browser",
    "static-contract",
    "mixed",
    "unclassified",
}
ROOTS = {"tests", "apps", "packages", "frontend", "scripts"}


def test_paths(inventory: list[str]) -> list[str]:
    """Conservative test inventory, including test names outside current runners."""
    return sorted(
        path
        for path in inventory
        if (
            PurePosixPath(path).parts
            and PurePosixPath(path).parts[0] in ROOTS
            and (
                (
                    path.startswith("tests/")
                    and (
                        PurePosixPath(path).name.startswith("test_")
                        or PurePosixPath(path).name.endswith("_test.py")
                    )
                    and path.endswith(".py")
                )
                or re.search(r"\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$", path)
            )
        )
    )


def _safe_path(value: object) -> TypeGuard[str]:
    return (
        isinstance(value, str)
        and bool(value)
        and not value.startswith("/")
        and "\\" not in value
        and all(part not in {"", ".", ".."} for part in value.split("/"))
    )


def validate_manifest(
    document: object, inventory: list[str], hashes: dict[str, str]
) -> list[str]:
    """Pure validation; caller supplies complete authoritative tracked inventory."""
    errors: list[str] = []
    if (
        not isinstance(document, dict)
        or type(document.get("version")) is not int
        or document["version"] != 1
    ):
        return ["invalid manifest version/document"]
    entries = document.get("entries")
    if not isinstance(entries, list):
        return ["entries must be a list"]
    if not isinstance(inventory, list) or not all(_safe_path(p) for p in inventory):
        return ["invalid inventory paths"]
    if len(inventory) != len(set(inventory)):
        errors.append("duplicate inventory path")
    expected = set(test_paths(inventory))
    known = set(inventory)
    seen: set[str] = set()
    for record in entries:
        if not isinstance(record, dict):
            errors.append("invalid entry")
            continue
        path = record.get("path")
        if not _safe_path(path):
            errors.append("invalid entry path")
            continue
        if path in seen:
            errors.append(f"duplicate: {path}")
        seen.add(path)
        if path not in expected:
            errors.append(f"stale/non-test: {path}")
        layer = record.get("layer")
        if not isinstance(layer, str) or layer not in LAYERS:
            errors.append(f"invalid layer: {path}")
        elif layer in {"unclassified", "mixed"}:
            errors.append(f"unresolved {layer}: {path}")
        targets = record.get("targets")
        if not isinstance(targets, list) or not targets:
            errors.append(f"missing targets: {path}")
        elif any(not _safe_path(p) or p not in known or p in expected for p in targets):
            errors.append(f"invalid production target: {path}")
        reason = record.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            errors.append(f"missing review reason: {path}")
        digest = record.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{64}", digest):
            errors.append(f"invalid digest: {path}")
        elif hashes.get(path) != digest:
            errors.append(f"changed/missing test digest: {path}")
    errors.extend(f"missing classification: {path}" for path in sorted(expected - seen))
    return errors


def select_unit_paths(
    document: object, inventory: list[str], hashes: dict[str, str]
) -> list[str]:
    """No partial selection: unresolved or stale classification blocks every unit run."""
    errors = validate_manifest(document, inventory, hashes)
    if errors:
        raise ValueError("; ".join(errors))
    return sorted(
        entry["path"]
        for entry in cast(dict, document)["entries"]
        if entry["layer"] == "unit"
    )


def _binding_digest(value: object) -> str:
    """Unambiguous canonical JSON digest; evidence binding, not authentication."""
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_unit_selection(
    *, revision: str, inventory: list[str], hashes: dict[str, str], document: object
) -> dict:
    """Pure protocol builder. Caller MUST obtain inputs from trusted current Git.

    This function does not authenticate caller-supplied paths or establish a Git
    trust boundary. Executing adapters must capture their own complete snapshot;
    never accept an artifact's inventory/hash claims as the current inputs.
    """
    if not isinstance(revision, str) or not re.fullmatch(
        r"(?:[a-f0-9]{40}|[a-f0-9]{64})", revision
    ):
        raise ValueError("invalid full revision")
    if (
        not isinstance(inventory, list)
        or not inventory
        or not all(_safe_path(path) for path in inventory)
        or len(inventory) != len(set(inventory))
    ):
        raise ValueError("invalid complete inventory")
    if not isinstance(hashes, dict) or set(hashes) != set(inventory):
        raise ValueError("hashes must cover exactly the complete inventory")
    if any(
        not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)
        for digest in hashes.values()
    ):
        raise ValueError("invalid file digest")
    unit_files = select_unit_paths(document, inventory, hashes)
    if not unit_files:
        raise ValueError("empty unit selection; no directory fallback")
    ordered = sorted(inventory)
    file_hashes = {path: hashes[path] for path in ordered}
    tests = test_paths(ordered)
    # Bind every non-test tracked input, not merely reviewed production targets.
    # This deliberately includes configs, helper fixtures, and documentation.
    source_hashes = {path: hashes[path] for path in ordered if path not in tests}
    return {
        "version": 1,
        "layer": "unit",
        "revision": revision,
        "inventory": ordered,
        "fileHashes": file_hashes,
        "testHashes": {path: hashes[path] for path in tests},
        "inventorySha256": _binding_digest(ordered),
        "classificationSha256": _binding_digest(document),
        "sourceSha256": _binding_digest(source_hashes),
        "unitFiles": unit_files,
    }


def validate_unit_selection(
    artifact: object,
    *,
    revision: str,
    inventory: list[str],
    hashes: dict[str, str],
    document: object,
) -> list[str]:
    """Runner preflight: recompute from independently obtained current inputs."""
    expected = build_unit_selection(
        revision=revision, inventory=inventory, hashes=hashes, document=document
    )
    # Canonical serialization also distinguishes JSON true from integer 1.
    if not isinstance(artifact, dict) or _binding_digest(artifact) != _binding_digest(
        expected
    ):
        raise ValueError("unit selection does not match current authoritative inputs")
    return list(expected["unitFiles"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument(
        "--inventory",
        required=True,
        type=Path,
        help="NUL-delimited complete tracked paths from trusted Git",
    )
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    try:
        root = args.root.resolve(strict=True)
        raw = args.inventory.read_bytes()
        if not raw:
            raise ValueError("empty project inventory")
        if raw and not raw.endswith(b"\0"):
            raise ValueError("inventory must be NUL terminated")
        inventory = raw.decode("utf-8").split("\0")[:-1] if raw else []
        hashes = {}
        for path in test_paths(inventory):
            if not _safe_path(path):
                raise ValueError("unsafe inventory path")
            file = root / path
            resolved = file.resolve(strict=True)
            if not resolved.is_relative_to(root) or not stat.S_ISREG(
                file.lstat().st_mode
            ):
                raise ValueError("test must be a contained regular file")
            hashes[path] = hashlib.sha256(file.read_bytes()).hexdigest()
        document = json.loads(args.manifest.read_text())
        errors = validate_manifest(document, inventory, hashes)
    except (OSError, ValueError, TypeError) as error:
        print(json.dumps({"ok": False, "errors": [str(error)]}))
        return 1
    counts: dict[str, int] = {}
    entries = document.get("entries", []) if isinstance(document, dict) else []
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, dict):
            layer = entry.get("layer", "invalid")
            if isinstance(layer, str):
                counts[layer] = counts.get(layer, 0) + 1
    print(json.dumps({"ok": not errors, "counts": counts, "errors": errors}, indent=2))
    return int(bool(errors))


def binding_main() -> int:
    """Internal pure-policy bridge. Only the Node adapter establishes provenance."""
    try:
        request = json.load(sys.stdin)
        current = request["current"]
        artifact = (
            validate_unit_selection(request["artifact"], **current)
            if "artifact" in request
            else build_unit_selection(**current)
        )
        print(json.dumps({"ok": True, "value": artifact}))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(binding_main() if sys.argv[1:] == ["--binding-stdin"] else main())
