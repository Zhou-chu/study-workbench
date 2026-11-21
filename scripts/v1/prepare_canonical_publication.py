#!/usr/bin/env python3
"""Export an exact committed canonical tree and offline publication receipt."""

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

if __package__:
    from .prepare_private_snapshot import (
        encode_json,
        exclusion,
        new_destination,
        object_sha,
        tree_sha,
    )
else:
    # Also support direct CLI execution and importlib-based tooling.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "private_snapshot", Path(__file__).with_name("prepare_private_snapshot.py")
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load private snapshot policy helper")
    snapshot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(snapshot)
    encode_json = snapshot.encode_json
    exclusion = snapshot.exclusion
    new_destination = snapshot.new_destination
    object_sha = snapshot.object_sha
    tree_sha = snapshot.tree_sha

HISTORICAL_RUNTIME_PATH = "frontend/test-results/.last-run.json"
HISTORICAL_RUNTIME_SHA = "5fca3f84bc7b9240b2963858fe2f32f7c515a8d4"


def git(repo, *args):
    """Read local original objects only; missing objects must never trigger fetch."""
    env = dict(os.environ)
    env.update(
        GIT_NO_LAZY_FETCH="1",
        GIT_ALLOW_PROTOCOL="",
        GIT_TERMINAL_PROMPT="0",
    )
    return subprocess.check_output(
        [
            "git",
            "--no-replace-objects",
            "--no-lazy-fetch",
            "-c",
            "protocol.allow=never",
            "-c",
            "credential.helper=",
            "-C",
            str(repo),
            *args,
        ],
        env=env,
    )


def validate_path(name):
    """Reject ambiguous/unsafe paths rather than normalize or filter them."""
    if (
        not name
        or "\\" in name
        or any(ord(c) < 32 or ord(c) == 127 for c in name)
        or any(p.lower() in {"", ".", "..", ".git"} for p in name.split("/"))
        or ":" in name
    ):
        raise ValueError(f"Unsafe committed path: {name!r}")
    return name


def resolve_commit(repo, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Require explicit full lowercase SHA-1 commit IDs")
    resolved = (
        git(repo, "rev-parse", "--verify", f"{commit}^{{commit}}").decode().strip()
    )
    if resolved != commit:
        raise ValueError("Require a commit object, not a tag")
    return resolved


def read_tree(repo, commit):
    entries = {}
    for raw in git(repo, "ls-tree", "-rz", commit).split(b"\0"):
        if not raw:
            continue
        metadata, raw_name = raw.split(b"\t", 1)
        mode, kind, sha = metadata.decode("ascii").split()
        name = validate_path(raw_name.decode("utf-8"))
        if mode not in {"100644", "100755"} or kind != "blob":
            raise ValueError(f"Unsupported mode/type: {name}")
        if name in entries:
            raise ValueError(f"Duplicate committed path: {name}")
        entries[name] = (mode, sha)
    for name in entries:
        parts = name.split("/")
        if any("/".join(parts[:i]) in entries for i in range(1, len(parts))):
            raise ValueError(f"File/directory collision: {name}")
    return entries


def validate_policy(source, baseline):
    exceptions = []
    # Both complete inventories are checked before reading any blob contents.
    for entries in (baseline, source):
        for name, value in entries.items():
            reason = exclusion(name)
            if "test-results" in name.split("/"):
                historical = (
                    name == HISTORICAL_RUNTIME_PATH
                    and value == ("100644", HISTORICAL_RUNTIME_SHA)
                    and baseline.get(name) == value
                )
                if not historical:
                    reason = (
                        "generated test-results (only pinned historical blob allowed)"
                    )
            if reason:
                raise ValueError(f"Forbidden committed path: {name} ({reason})")
    if HISTORICAL_RUNTIME_PATH in source:
        exceptions.append(
            {
                "path": HISTORICAL_RUNTIME_PATH,
                "git_blob_sha": HISTORICAL_RUNTIME_SHA,
                "reason": "unchanged historical baseline result; not current test evidence",
            }
        )
    return exceptions


def committed_parents(repo, commit):
    """Read object headers, unaffected by shallow boundaries or graft traversal."""
    raw = git(repo, "cat-file", "commit", commit)
    if object_sha("commit", raw) != commit:
        raise ValueError("Commit integrity mismatch")
    parents = []
    for line in raw.split(b"\n\n", 1)[0].split(b"\n"):
        if line.startswith(b"parent "):
            parent = line[len(b"parent ") :].decode("ascii")
            if not re.fullmatch(r"[0-9a-f]{40}", parent):
                raise ValueError("Invalid committed parent header")
            parents.append(parent)
    return parents


def prepare(repo, commit, baseline, output):
    """Validate everything before creating a new export; never inspect worktree data."""
    output = new_destination(output)
    commit = resolve_commit(repo, commit)
    baseline = resolve_commit(repo, baseline)
    source, old = read_tree(repo, commit), read_tree(repo, baseline)
    exceptions = validate_policy(source, old)
    expected = git(repo, "rev-parse", f"{commit}^{{tree}}").decode().strip()
    baseline_tree = git(repo, "rev-parse", f"{baseline}^{{tree}}").decode().strip()
    old_inventory = [
        {"path": n, "mode": m, "git_blob_sha": s} for n, (m, s) in sorted(old.items())
    ]
    if tree_sha(old_inventory) != baseline_tree:
        raise ValueError("Baseline tree reconstruction mismatch")
    changes = {
        "added": sorted(source.keys() - old.keys()),
        "modified": sorted(
            n for n in source.keys() & old.keys() if source[n] != old[n]
        ),
        "deleted": sorted(old.keys() - source.keys()),
    }
    payload, inventory, unchanged, contents = [], [], [], {}
    # Reuse any blob present in the verified baseline, including mode-only changes.
    known_blobs = {sha for _, sha in old.values()}
    for name, (mode, sha) in sorted(source.items()):
        data = git(repo, "cat-file", "blob", sha)
        if object_sha("blob", data) != sha:
            raise ValueError(f"Blob integrity mismatch: {name}")
        item = {
            "path": name,
            "mode": mode,
            "git_blob_sha": sha,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
        }
        inventory.append(item)
        contents[name] = data
        if sha in known_blobs:
            unchanged.append({"path": name, "mode": mode, "git_blob_sha": sha})
        else:
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                raise ValueError(f"Unsupported changed binary blob: {name}") from None
            if "\0" in text:
                raise ValueError(f"Unsupported changed binary blob: {name}")
            payload.append(
                {
                    "path": name,
                    "mode": mode,
                    "git_blob_sha": sha,
                    "encoding": "utf-8",
                    "content": text,
                }
            )
    if tree_sha(inventory) != expected:
        raise ValueError("Source tree reconstruction mismatch")
    result = {
        "schema_version": 1,
        "source_commit": commit,
        "source_parents": committed_parents(repo, commit),
        "baseline_commit": baseline,
        "baseline_tree_sha": baseline_tree,
        "expected_tree_sha": expected,
        "total_files": len(inventory),
        "total_bytes": sum(f["bytes"] for f in inventory),
        "files": inventory,
        "baseline_files": old_inventory,
        "changes": changes,
        "changed_text_blobs": payload,
        "unchanged_blobs": unchanged,
        "policy_exceptions": exceptions,
        "inventory_sha256": hashlib.sha256(encode_json(inventory)).hexdigest(),
    }
    output.mkdir()
    for item in inventory:
        path = output / item["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(contents[item["path"]])
        path.chmod(0o755 if item["mode"] == "100755" else 0o644)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--commit", required=True, help="Full committed source SHA")
    parser.add_argument(
        "--baseline", required=True, help="Full committed comparison SHA"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--inventory", type=Path, required=True, help="New external JSON receipt"
    )
    args = parser.parse_args()
    try:
        receipt, output = new_destination(args.inventory), new_destination(args.output)
        if receipt == output or output in receipt.parents or receipt in output.parents:
            raise ValueError("Inventory must be outside the export")
        result = prepare(args.repo, args.commit, args.baseline, output)
        with receipt.open("xb") as stream:
            stream.write(encode_json(result))
    except ValueError as exc:
        parser.error(str(exc))
    print(
        json.dumps(
            {
                k: result[k]
                for k in (
                    "source_commit",
                    "expected_tree_sha",
                    "total_files",
                    "changes",
                )
            }
        )
    )


if __name__ == "__main__":
    main()
