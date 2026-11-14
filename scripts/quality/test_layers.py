"""Fail-closed test-layer policy. Selection only; never changes coverage scope."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
from pathlib import Path, PurePosixPath

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


def _safe_path(value: object) -> bool:
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
    if not isinstance(document, dict) or document.get("version") != 1:
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
        entry["path"] for entry in document["entries"] if entry["layer"] == "unit"
    )


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
    counts = {}
    entries = document.get("entries", []) if isinstance(document, dict) else []
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, dict):
            layer = entry.get("layer", "invalid")
            if isinstance(layer, str):
                counts[layer] = counts.get(layer, 0) + 1
    print(json.dumps({"ok": not errors, "counts": counts, "errors": errors}, indent=2))
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
