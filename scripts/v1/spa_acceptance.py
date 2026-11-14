"""Inert C2 preparation and structural evidence checks, not runtime acceptance.

No application imports, listener discovery, port probing, process adoption or deletion.
Only pinned, clean-source C1 pure verifiers may run. Runtime schema extension and
reviewed observation producers are deliberately outside this source-stage tool.
"""

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).absolute().parents[2]
APPROVED_SOURCE_ROOT = Path(
    "/home/zhouchu/study-workbench-worktrees-20261108/notebook-redesign"
)
APPROVED_RUN_PARENT = Path("/tmp")
BASE = "8dacbb3519963f5da0c6deb9f615a0a77327116a"
DEPLOY = Path("/home/zhouchu/study-workbench-deploy-20261107")
NODE = DEPLOY / "tools/node-v24.19.0-linux-x64/bin/node"
GIT = DEPLOY / "tools/git/bin/git"
PYTHON = DEPLOY / "source/.venv/bin/python"
PROTECTED_ROOTS = (
    APPROVED_SOURCE_ROOT,
    DEPLOY,
    Path("/home/zhouchu/.config"),
    Path("/home/zhouchu/.cache"),
    Path("/home/zhouchu/.mozilla"),
    Path("/home/zhouchu/.local"),
)
FIXTURE = "contracts/v1/fixtures/workspace-view-v1.json"
FIXTURE_SHA = "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423"
CONTRACT_SHA = "7457772928802237c1e2e59ba1841352dd4ccce5124c5259ce5eca09c161b0f1"
REVIEWED_HELPERS = {
    "scripts/v1/spa-artifact-common.mjs": "0ba886c552818b67ecf2cbb43ebeff2c3c63f8bdcd647c1ed4e7e1bb390cba80",
    "scripts/v1/check_spa_artifacts.py": "1dcfa9b0901482fe82c262e8df83faddc73b3dc792b23dda1ed6f41409aad2d5",
    "apps/web/scripts/build-manifest.mjs": "79473df8b7260fb34ea6a25e3dff40bc1be00efd41496d4cae0252954fe9d00d",
    "apps/bff/scripts/build-manifest.mjs": "55492a87654d63c726f74fb25887aa9249a011d20fbee7b4186b398f2e8d2a83",
}
FINGERPRINTS = {
    "all": (446, "b9fe7af28a5e85aaf628afa49b142b451aa4f985bc5de36c2e2796d3946936f6"),
    "B8": (172, "67f3dc508ae3a8bc0366e4527a6aceefde65c5ff51fe849aaaeeda14bf754a07"),
    "B9": (129, "3177889733346b0bdec0312b96068f522a904e4d47233fa20afc7db8b8798af6"),
}
CASE_MEMBERSHIP_SHA = "ab0a55bd912efef1901e259005189a25f3d51e7ea83afd257e6e64319473e7b4"
OPERATION_OWNERS_SHA = (
    "c8a66fe134bc5953ca5192d9124f66784911801da1aba12f21245486babec7c9"
)
STATUSES = {"passed", "failed", "not_run", "blocked"}
LAYERS = {
    "browser",
    "runtime",
    "device",
    "provider",
    "gateway",
    "image",
    "user",
    "production",
}
RUN_KEYS = {
    "version",
    "run_id",
    "created_at",
    "source_commit",
    "api_commit",
    "environment",
    "auth_mode",
    "source",
    "root",
    "fixture",
    "contract",
    "web",
    "bff",
    "gateway",
    "runtime_started",
    "phase",
}
MAX_FILE = 32 * 1024 * 1024


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


def exact(value: Any, keys: set[str]) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("Unexpected schema fields")


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def parse(data: bytes) -> Any:
    def reject_constant(value: str) -> None:
        raise ValueError("Non-finite JSON")

    return json.loads(
        data, object_pairs_hook=unique_object, parse_constant=reject_constant
    )


def absolute(path: str | Path) -> Path:
    raw = str(path)
    if (
        not raw.startswith("/")
        or "\\" in raw
        or "//" in raw
        or any(x in {".", ".."} for x in raw.split("/"))
    ):
        raise ValueError("Absolute canonical path required")
    return Path(raw)


def directory(path: str | Path, private: bool = False) -> int:
    """Walk from / with anchored no-follow dirfds; caller closes the returned fd."""
    target = absolute(path)
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in target.parts[1:]:
            child = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            os.close(fd)
            fd = child
        st = os.fstat(fd)
        if private and (st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700):
            raise ValueError("Private directory custody mismatch")
        return fd
    except BaseException:
        os.close(fd)
        raise


def identity(path: Path, private: bool = False) -> dict[str, Any]:
    fd = directory(path, private)
    try:
        s = os.fstat(fd)
        return {
            "path": str(path),
            "device": s.st_dev,
            "inode": s.st_ino,
            "owner": s.st_uid,
            "mode": stat.S_IMODE(s.st_mode),
        }
    finally:
        os.close(fd)


def read_file(path: Path, private: bool = False) -> bytes:
    path = absolute(path)
    parent = directory(path.parent, private)
    try:
        fd = os.open(
            path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent
        )
        with os.fdopen(fd, "rb") as f:
            s = os.fstat(f.fileno())
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size > MAX_FILE:
                raise ValueError("Special, linked or oversized file")
            if private and (
                s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o600
            ):
                raise ValueError("Private file custody mismatch")
            data = f.read(MAX_FILE + 1)
            after = os.fstat(f.fileno())
            if len(data) != s.st_size or (s.st_ino, s.st_mtime_ns, s.st_ctime_ns) != (
                after.st_ino,
                after.st_mtime_ns,
                after.st_ctime_ns,
            ):
                raise ValueError("File changed while reading")
            return data
    finally:
        os.close(parent)


def tree_measurement(root: Path, private: bool = False) -> str:
    rows: list[dict[str, Any]] = []
    total = 0

    def walk(path: Path) -> None:
        nonlocal total
        fd = directory(path, private)
        try:
            names = sorted(os.listdir(fd))
            for name in names:
                p = path / name
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(s.st_mode):
                    walk(p)
                else:
                    data = read_file(p, private)
                    total += len(data)
                    if len(rows) >= 20000 or total > 256 * 1024 * 1024:
                        raise ValueError("Inventory limit")
                    rows.append(
                        {
                            "path": p.relative_to(root).as_posix(),
                            "size": len(data),
                            "mode": "0755" if s.st_mode & 0o111 else "0644",
                            "sha256": sha(data),
                        }
                    )
        finally:
            os.close(fd)

    walk(root)
    return sha(canonical(sorted(rows, key=lambda row: row["path"])))


def verifier_environment() -> dict[str, str]:
    return {
        "PATH": f"{NODE.parent}:{GIT.parent}:/usr/bin:/bin",
        "HOME": "/nonexistent",
        "LANG": "C.UTF-8",
        "TZ": "UTC",
        "PYTHON_DOTENV_DISABLED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_OPTIONAL_LOCKS": "0",
    }


def command(args: list[str], source: Path) -> str:
    result = subprocess.run(
        args,
        cwd=source,
        env=verifier_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode:
        raise ValueError(
            f"Pure verifier refused ({Path(args[0]).name}, exit {result.returncode}); context retained"
        )
    return result.stdout.strip()


def git(source: Path, *args: str) -> str:
    return command(
        [
            str(GIT),
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            *args,
        ],
        source,
    )


def verify_source(source_root: Path) -> dict[str, Any]:
    source = absolute(source_root)
    if source != APPROVED_SOURCE_ROOT or ROOT != APPROVED_SOURCE_ROOT:
        raise ValueError("Unavailable controller-approved source context")
    result = identity(source)
    for name, expected in REVIEWED_HELPERS.items():
        if sha(read_file(source / name)) != expected:
            raise ValueError("Reviewed verifier changed; independent release required")
    if git(source, "rev-parse", "--show-toplevel") != str(source):
        raise ValueError("Wrong Git context")
    if git(source, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Clean committed source required")
    if git(source, "branch", "--show-current") != "feat/notebook-spa-redesign-20261108":
        raise ValueError("Wrong approved branch")
    git(source, "merge-base", "--is-ancestor", BASE, "HEAD")
    for name in (
        "scripts/v1/spa_acceptance.py",
        "docs/v1/SPA_BROWSER_CASES.json",
        "apps/web/src/app/route-coverage.ts",
        *REVIEWED_HELPERS,
    ):
        committed = command([str(GIT), "--no-pager", "show", f"HEAD:{name}"], source)
        if committed != read_file(source / name).decode().strip():
            raise ValueError("Helper/catalog source identity mismatch")
    result.update(
        commit=git(source, "rev-parse", "HEAD"),
        tree=git(source, "rev-parse", "HEAD^{tree}"),
    )
    return result


def validate_fixture(source: Path, fixture: str) -> dict[str, str]:
    if not fixture:
        raise ValueError("Explicit allowlisted fixture required")
    path = source / FIXTURE if fixture == FIXTURE else absolute(fixture)
    if path != source / FIXTURE or sha(read_file(path)) != FIXTURE_SHA:
        raise ValueError("Allowlisted fixture identity mismatch")
    parse(read_file(path))
    return {"path": str(path), "sha256": FIXTURE_SHA}


def verify_inputs(
    *,
    source_root: Path,
    fixture: str,
    web: Path,
    bff: Path,
    gateway: Path,
    contract: Path,
) -> dict[str, Any]:
    source = verify_source(source_root)
    load_catalog(source_root)
    fixture_record = validate_fixture(source_root, fixture)
    if sha(read_file(contract)) != CONTRACT_SHA:
        raise ValueError("Reviewed OpenAPI required")
    result: dict[str, Any] = {
        "source": source,
        "fixture": fixture_record,
        "contract": {"path": str(contract), "sha256": CONTRACT_SHA},
    }
    for kind, root in (("web", web), ("bff", bff)):
        tree_measurement(
            root
        )  # Additional hardlink/special/path custody, not a copied C1 verifier.
        command(
            [
                str(NODE),
                str(source_root / f"apps/{kind}/scripts/build-manifest.mjs"),
                "--verify",
                str(root),
            ],
            source_root,
        )
        manifest = parse(read_file(root / "spa-artifact-manifest.json"))
        inventory = parse(read_file(root / "artifact-inventory.json"))
        result[kind] = {
            "root": str(root),
            "slot": inventory["release_slot"],
            "manifest": manifest,
            "metadata": {
                name: sha(read_file(root / name))
                for name in (
                    "spa-artifact-manifest.json",
                    "artifact-inventory.json",
                    "artifact-identity.json",
                )
            },
        }
    command(
        [
            str(PYTHON),
            "-I",
            str(source_root / "scripts/v1/check_spa_artifacts.py"),
            "--web",
            str(web),
            "--bff",
            str(bff),
            "--contract",
            str(contract),
        ],
        source_root,
    )
    measurement = tree_measurement(gateway)
    script = "import {verifyGateway} from './scripts/v1/spa-artifact-common.mjs'; console.log(JSON.stringify(await verifyGateway(process.argv[1],{contract:process.argv[2]})));"
    window = parse(
        command(
            [
                str(NODE),
                "--input-type=module",
                "-e",
                script,
                str(gateway),
                str(contract),
            ],
            source_root,
        ).encode()
    )
    if window["current"] != result["web"]["slot"]:
        raise ValueError("Gateway does not serve selected current Web")
    result["gateway"] = {"root": str(gateway), "window": window, "sha256": measurement}
    if verify_source(source_root) != source or tree_measurement(gateway) != measurement:
        raise ValueError("Source/stage changed during verification")
    return result


def overlap(left: Path, right: Path) -> bool:
    return left == right or left in right.parents or right in left.parents


def write_private(root: Path, name: str, value: Any, expected: dict[str, Any]) -> None:
    fd = directory(root, True)
    try:
        if identity(root, True) != expected:
            raise ValueError("Run root changed")
        temporary = "pending-" + uuid.uuid4().hex + ".json"
        child = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=fd,
        )
        with os.fdopen(child, "wb") as f:
            f.write(canonical(value) + b"\n")
            f.flush()
            os.fsync(f.fileno())
        # O_EXCL reservation prevents another invocation from publishing this name.
        # An interrupted publication leaves its private partial files for review.
        reservation = os.open(
            name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd
        )
        os.close(reservation)
        os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
        if identity(root, True) != expected:
            raise ValueError("Run root changed; retain partial preparation")
    finally:
        os.close(fd)


def prepare(
    run_root: Path,
    fixture: str,
    *,
    source_root: Path = ROOT,
    web: Path | None = None,
    bff: Path | None = None,
    gateway: Path | None = None,
    contract: Path | None = None,
) -> dict[str, Any]:
    if not fixture:
        raise ValueError("Explicit allowlisted fixture required")
    root, source = absolute(run_root), absolute(source_root)
    if root.parent != APPROVED_RUN_PARENT:
        raise ValueError("Run parent must be the approved temporary preparation parent")
    paths = {
        "web": absolute(web or source / "apps/web/dist"),
        "bff": absolute(bff or source / "apps/bff/dist"),
        "gateway": absolute(gateway or source / "apps/web/gateway/dist"),
        "contract": absolute(contract or source / "contracts/v1/openapi.json"),
    }
    fixture_path = source / FIXTURE if fixture == FIXTURE else absolute(fixture)
    forbidden = (*PROTECTED_ROOTS, source, fixture_path, *paths.values())
    if any(overlap(root, item) for item in forbidden):
        raise ValueError("Run root overlaps source/deploy/data/profile/artifact/input")
    # Requiring a dedicated direct child of an existing private/owned parent prevents
    # implicitly creating or adopting a user dataset/profile. No arbitrary root reuse.
    parent = directory(root.parent)
    try:
        st = os.fstat(parent)
        if st.st_uid != os.getuid() and not (
            st.st_uid == 0 and st.st_mode & stat.S_ISVTX
        ):
            raise ValueError("Unowned preparation parent")
        try:
            os.stat(root.name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError("Never reuse a preparation root")
        inputs = verify_inputs(source_root=source, fixture=fixture, **paths)
        os.mkdir(root.name, mode=0o700, dir_fd=parent)
        owned = os.open(
            root.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
        )
        try:
            st = os.fstat(owned)
            root_identity = {
                "path": str(root),
                "device": st.st_dev,
                "inode": st.st_ino,
                "owner": st.st_uid,
                "mode": stat.S_IMODE(st.st_mode),
            }
            if identity(root, True) != root_identity:
                raise ValueError("New preparation root changed; retain partial root")
        finally:
            os.close(owned)
        run = {
            "version": "spa-acceptance-run-v1",
            "run_id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_commit": inputs["source"]["commit"],
            "api_commit": inputs["source"]["commit"],
            "environment": "synthetic-preparation-only",
            "auth_mode": "legacy_password",
            "root": root_identity,
            **inputs,
            "runtime_started": False,
            "phase": "prepared",
        }
        write_private(root, "manifest.json", run, root_identity)
        return {
            "manifest": str(root / "manifest.json"),
            "phase": "prepared",
            "runtime_started": False,
        }
    finally:
        os.close(parent)


def validate_run(run: Any, path: Path) -> None:
    exact(run, RUN_KEYS)
    if (
        run["version"] != "spa-acceptance-run-v1"
        or run["runtime_started"] is not False
        or run["phase"] not in {"prepared", "closed", "cleanup_uncertain"}
    ):
        raise ValueError("Runtime claims unsupported; cleanup_uncertain, retain root")
    if (
        str(uuid.UUID(run["run_id"])) != run["run_id"]
        or not isinstance(run["created_at"], str)
        or datetime.fromisoformat(run["created_at"]).tzinfo is None
    ):
        raise ValueError("Invalid run identity/time")
    if (
        not re.fullmatch(r"[a-f0-9]{40}", run["source_commit"])
        or run["api_commit"] != run["source_commit"]
        or run["auth_mode"] != "legacy_password"
        or run["environment"] != "synthetic-preparation-only"
    ):
        raise ValueError("Unsupported source/auth/environment")
    if path.name != "manifest.json" or run["root"] != identity(path.parent, True):
        raise ValueError("Run root custody mismatch")
    for field in ("source", "fixture", "contract", "web", "bff", "gateway"):
        if not isinstance(run[field], dict):
            raise ValueError("Invalid input identity schema")
    if run["source"].get("path") != str(APPROVED_SOURCE_ROOT):
        raise ValueError("Pinned approved context unavailable")


def inspect(manifest: Path) -> dict[str, Any]:
    path = absolute(manifest)
    run = parse(read_file(path, True))
    validate_run(run, path)
    tree_measurement(path.parent, True)
    inputs = verify_inputs(
        source_root=absolute(run["source"]["path"]),
        fixture=run["fixture"]["path"],
        **{k: absolute(run[k]["root"]) for k in ("web", "bff", "gateway")},
        contract=absolute(run["contract"]["path"]),
    )
    if any(run[key] != value for key, value in inputs.items()):
        raise ValueError("Pinned input identity drift")
    if run["source_commit"] != inputs["source"]["commit"]:
        raise ValueError("Pinned source commit drift")
    closed = path.parent / "closed.json"
    try:
        receipt = parse(read_file(closed, True))
    except FileNotFoundError:
        pass
    else:
        expected = {**run, "phase": "closed"}
        if receipt != expected:
            raise ValueError("Conflicting closure receipt; cleanup_uncertain")
        run = receipt
    return run


def stop(manifest: Path) -> dict[str, Any]:
    path = absolute(manifest)
    run = inspect(path)
    if run["phase"] == "cleanup_uncertain":
        raise ValueError("cleanup_uncertain; retain root; no runtime signal authority")
    if run["phase"] != "closed":
        run = {**run, "phase": "closed"}
        write_private(path.parent, "closed.json", run, run["root"])
    return {
        "phase": "closed",
        "runtime_started": False,
        "root_retained": True,
        "claim": "Never-started preparation closed; no runtime stopped, drained or probed",
    }


def operation_inventory(source: Path) -> dict[str, str]:
    text = read_file(source / "apps/web/src/app/route-coverage.ts").decode()
    rows = [parse(x.encode()) for x in re.findall(r"^  (\{.*\}),?$", text, re.M)]
    operations: dict[str, str] = {}
    for row in rows:
        if len(row["coveredOperations"]) != 1:
            raise ValueError("Individual operation inventory required")
        op = row["coveredOperations"][0]
        if op in operations:
            raise ValueError("Duplicate operation")
        operations[op] = row["ownerTask"]
    for owner, (count, fingerprint) in FINGERPRINTS.items():
        ids = sorted(
            op for op, task in operations.items() if owner == "all" or task == owner
        )
        if len(ids) != count or sha(("\n".join(ids) + "\n").encode()) != fingerprint:
            raise ValueError("Accepted operation inventory changed")
    if sha(canonical(operations)) != OPERATION_OWNERS_SHA:
        raise ValueError("Accepted operation ownership changed")
    return operations


def load_catalog(source: Path = ROOT) -> dict[str, Any]:
    catalog = parse(read_file(source / "docs/v1/SPA_BROWSER_CASES.json"))
    exact(catalog, {"version", "operation_fingerprint", "cases"})
    if (
        catalog["version"] != "spa-browser-cases-v1"
        or catalog["operation_fingerprint"] != FINGERPRINTS["all"][1]
    ):
        raise ValueError("Unreviewed catalog identity")
    operations = operation_inventory(source)
    seen: set[str] = set()
    anchors: set[str] = set()
    for case in catalog["cases"]:
        required = {
            "id",
            "operation_ids",
            "layer",
            "mandatory",
            "preconditions",
            "actions",
            "expected",
            "conditions",
            "required_evidence_types",
            "initial_status",
        }
        exact(
            case, required | ({"blocked_reason"} if "blocked_reason" in case else set())
        )
        cid = case["id"]
        if (
            not isinstance(cid, str)
            or not re.fullmatch(r"[-A-Za-z0-9_.]+", cid)
            or cid in seen
        ):
            raise ValueError("Duplicate/invalid case ID")
        seen.add(cid)
        if (
            case["mandatory"] is not True
            or case["layer"] not in LAYERS
            or case["initial_status"] not in {"not_run", "blocked"}
        ):
            raise ValueError("Catalog is a mandatory plan, not passed evidence")
        if case["initial_status"] == "blocked" and not case.get("blocked_reason"):
            raise ValueError("Blocked reason required")
        for field in (
            "operation_ids",
            "preconditions",
            "actions",
            "expected",
            "required_evidence_types",
        ):
            if (
                not isinstance(case[field], list)
                or not case[field]
                or any(not isinstance(x, str) or not x.strip() for x in case[field])
                or len(case[field]) != len(set(case[field]))
            ):
                raise ValueError("Concrete distinct case entries required")
        if any(op not in operations for op in case["operation_ids"]):
            raise ValueError("Unknown operation link")
        exact(
            case["conditions"],
            {"viewport", "locale", "theme", "input", "device", "zoom"},
        )
        if len(case["operation_ids"]) == 1:
            op = case["operation_ids"][0]
            if cid.startswith(f"C2-{operations[op]}-{op}--"):
                anchors.add(op)
    if anchors != set(operations):
        raise ValueError("Missing individual operation cases")
    fields = (
        "id",
        "operation_ids",
        "layer",
        "mandatory",
        "conditions",
        "required_evidence_types",
    )
    membership = sorted(
        [{k: c[k] for k in fields} for c in catalog["cases"]], key=lambda c: c["id"]
    )
    if sha(canonical(membership)) != CASE_MEMBERSHIP_SHA:
        raise ValueError("Exact mandatory case/layer/condition/evidence set changed")
    return catalog


def relative_evidence(root: Path, name: Any) -> Path:
    if not isinstance(name, str) or len(name) > 512 or not name or "\\" in name:
        raise ValueError("Unsafe evidence reference")
    if any(
        not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", part)
        or part in {".", ".."}
        or part.lower().endswith((".key", ".pem", ".db"))
        for part in name.split("/")
    ):
        raise ValueError("Unsafe evidence reference")
    return root / name


def evidence_identities(run: dict[str, Any]) -> dict[str, str]:
    return {
        "source_commit": run["source_commit"],
        "api_commit": run["api_commit"],
        "web_digest": run["web"]["manifest"]["asset_digest"],
        "bff_digest": run["bff"]["manifest"]["asset_digest"],
        "web_slot": run["web"]["slot"],
        "bff_slot": run["bff"]["slot"],
        "contract_digest": run["contract"]["sha256"],
        "fixture_digest": run["fixture"]["sha256"],
        "gateway_digest": run["gateway"]["sha256"],
        "catalog_digest": sha(
            read_file(Path(run["source"]["path"]) / "docs/v1/SPA_BROWSER_CASES.json")
        ),
    }


def validate_evidence(value: Any, run: dict[str, Any], case: dict[str, Any]) -> str:
    """Structural validation only. This does not authenticate the producer's claim."""
    exact(
        value,
        {
            "version",
            "run_id",
            "case_id",
            "layer",
            "identities",
            "conditions",
            "evidence_type",
            "outcome",
            "files",
        },
    )
    if (
        value["version"] != "spa-case-evidence-v1"
        or value["run_id"] != run["run_id"]
        or value["case_id"] != case["id"]
        or value["layer"] != case["layer"]
        or value["identities"] != evidence_identities(run)
        or value["conditions"] != case["conditions"]
    ):
        raise ValueError("Evidence run/build/case/layer/condition identity mismatch")
    if (
        value["outcome"] not in STATUSES
        or value["evidence_type"] not in case["required_evidence_types"]
        or not isinstance(value["files"], list)
        or not value["files"]
    ):
        raise ValueError("Invalid producer outcome/evidence kind")
    names: set[str] = set()
    for file in value["files"]:
        exact(file, {"relative_path", "size", "sha256"})
        path = relative_evidence(Path(run["root"]["path"]), file["relative_path"])
        if (
            file["relative_path"] in names
            or type(file["size"]) is not int
            or file["size"] < 0
            or not isinstance(file["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", file["sha256"])
        ):
            raise ValueError("Invalid evidence file identity")
        names.add(file["relative_path"])
        data = read_file(path, True)
        if len(data) != file["size"] or sha(data) != file["sha256"]:
            raise ValueError("Evidence bytes changed")
    return str(value["outcome"])


def summarize_cases(manifest: Path, results: list[dict[str, Any]]) -> dict[str, Any]:
    run = inspect(manifest)
    catalog = load_catalog(Path(run["source"]["path"]))
    wanted = {case["id"]: case for case in catalog["cases"]}
    supplied: dict[str, dict[str, Any]] = {}
    for row in results:
        exact(row, {"id", "status", "evidence"})
        if (
            row["id"] not in wanted
            or row["id"] in supplied
            or row["status"] not in STATUSES
            or not isinstance(row["evidence"], list)
        ):
            raise ValueError("Unknown/duplicate/invalid case result")
        supplied[row["id"]] = row
        kinds: set[str] = set()
        if len(set(row["evidence"])) != len(row["evidence"]):
            raise ValueError("Duplicate evidence")
        for name in row["evidence"]:
            value = parse(
                read_file(relative_evidence(Path(run["root"]["path"]), name), True)
            )
            outcome = validate_evidence(value, run, wanted[row["id"]])
            if outcome != row["status"] or value["evidence_type"] in kinds:
                raise ValueError("Conflicting producer outcome/evidence")
            kinds.add(value["evidence_type"])
        if row["status"] == "passed":
            if kinds != set(wanted[row["id"]]["required_evidence_types"]):
                raise ValueError("Missing mandatory producer evidence")
            # No reviewed runtime producer exists in this source release. Matching
            # caller-authored JSON is not a genuine observation or signal authority.
            raise ValueError(
                "Never-started preparation cannot establish external acceptance"
            )
    cases = [
        supplied.get(cid, {"id": cid, "status": case["initial_status"], "evidence": []})
        for cid, case in wanted.items()
    ]
    return {
        "source_commit": run["source_commit"],
        "web_digest": run["web"]["manifest"]["asset_digest"],
        "bff_digest": run["bff"]["manifest"]["asset_digest"],
        "api_commit": run["api_commit"],
        "contract_digest": run["contract"]["sha256"],
        "auth_mode": run["auth_mode"],
        "environment": run["environment"],
        "cases": cases,
        "limitations": [
            "Source-only preparation; no runtime/browser/device/provider/image/user/production observation",
            "Structural identity validation does not authenticate arbitrary producer JSON",
            "Runtime owner, genuine producers and cleanup require separately reviewed scope",
        ],
        "complete": all(c["status"] == "passed" for c in cases),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--run-root", type=Path, required=True)
    prep.add_argument("--fixture", required=True)
    for name in ("source-root", "web", "bff", "gateway", "contract"):
        prep.add_argument("--" + name, type=Path)
    for name in ("inspect", "stop"):
        sub.add_parser(name).add_argument("--manifest", type=Path, required=True)
    args = vars(parser.parse_args())
    action = args.pop("action")
    try:
        if action == "prepare":
            result = prepare(**{k: v for k, v in args.items() if v is not None})
        elif action == "inspect":
            result = inspect(args["manifest"])
        else:
            result = stop(args["manifest"])
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        # Never echo arbitrary manifest contents, paths, stderr or private values.
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "phase": "cleanup_uncertain",
                    "root_retained": True,
                    "runtime_claim": "none",
                    "reason": "Identity/schema/custody or pure file verification failed; retain inputs and review",
                }
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
