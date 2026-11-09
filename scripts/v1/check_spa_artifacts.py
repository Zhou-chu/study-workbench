"""Independent, offline SPA artifact verification. Never contacts a service."""

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
META = {"spa-artifact-manifest.json", "artifact-inventory.json"}
HASH = re.compile(r"[a-f0-9]{64}")
SLOT = re.compile(r"[a-z0-9][a-z0-9-]{15,79}")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def safe_path(name, authored=False):
    if authored and name == ".dockerignore":
        return name
    if not isinstance(name, str) or not name or len(name) > 512 or "\\" in name:
        raise ValueError("Unsafe path")
    for part in name.split("/"):
        if (
            not re.fullmatch(r"[-A-Za-z0-9_@.]+", part)
            or part in {".", ".."}
            or re.match(
                r"(?i)(?:\.|node_modules$|private(?:\.|$)|secrets?(?:\.|$)|credentials?(?:\.|$)|browser[-_]profile)",
                part,
            )
            or re.search(r"(?i)\.(?:pem|key|secret|sqlite3?|db|p12|pfx)$", part)
        ):
            raise ValueError("Unsafe/private path")
    return name


def read_file(path, scan=True):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("Symlink path")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(stream.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > 32 * 1024 * 1024:
            raise ValueError("Special/oversized file")
        value = stream.read(st.st_size + 1)
        if len(value) != st.st_size:
            raise ValueError("Changed file")
        if scan and re.search(
            rb"PRIVATE_SENTINEL|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:sk-proj-|sk_live_)[A-Za-z0-9]{16}",
            value,
        ):
            raise ValueError("Private sentinel")
        return value, "0755" if st.st_mode & 0o111 else "0644"


def inventory(root):
    root = Path(root).absolute()
    if any(p.is_symlink() for p in (root, *root.parents)):
        raise ValueError("Symlink root")
    if not root.is_dir():
        raise ValueError("Missing artifact directory")
    rows: list[dict[str, Any]] = []
    total = 0
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            child = Path(directory) / name
            safe_path(child.relative_to(root).as_posix())
            if child.is_symlink():
                raise ValueError("Symlink directory")
        for name in files:
            full = Path(directory) / name
            relative = safe_path(full.relative_to(root).as_posix())
            value, mode = read_file(full)
            total += len(value)
            if len(rows) >= 20000 or total > 256 * 1024 * 1024:
                raise ValueError("Inventory limit")
            if relative not in META:
                rows.append(
                    {
                        "path": relative,
                        "size": len(value),
                        "mode": mode,
                        "sha256": hashlib.sha256(value).hexdigest(),
                    }
                )
    return sorted(rows, key=lambda row: row["path"])


def load_json(path):
    value, _ = read_file(path)
    parsed = json.loads(value)
    if value != (canonical(parsed) + "\n").encode():
        raise ValueError("Noncanonical/duplicate JSON")
    return parsed


def exact_keys(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("Malformed schema")


def validate_rows(rows, authored=False):
    if not isinstance(rows, list) or not rows or len(rows) > 20000:
        raise ValueError("Malformed inventory")
    previous = ""
    for row in rows:
        exact_keys(row, ("path", "size", "mode", "sha256"))
        safe_path(row["path"], authored)
        if (
            row["path"] <= previous
            or type(row["size"]) is not int
            or not 0 <= row["size"] <= 32 * 1024 * 1024
            or row["mode"] not in ("0644", "0755")
            or not HASH.fullmatch(str(row["sha256"]))
        ):
            raise ValueError("Malformed inventory entry")
        previous = row["path"]


def git(*args):
    return subprocess.check_output(
        ["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
    ).strip()


def source_inventory(kind):
    paths = [
        "package.json",
        "package-lock.json",
        "tsconfig.base.json",
        "contracts/v1/openapi.json",
        "packages/contracts",
        "deploy/v1",
        "scripts/v1/spa-artifact-common.mjs",
        "scripts/v1/check_spa_artifacts.py",
        "scripts/v1/container_check.py",
        ".dockerignore",
        "apps/" + kind,
    ]
    if kind == "web":
        paths += ["packages/domain", "packages/web-transport"]
    rows: list[dict[str, Any]] = []
    for name in sorted(filter(None, git("ls-files", "-z", "--", *paths).split("\0"))):
        if "/dist/" in name:
            continue
        value, mode = read_file(ROOT / name, scan=False)
        rows.append(
            {
                "path": name,
                "size": len(value),
                "mode": mode,
                "sha256": hashlib.sha256(value).hexdigest(),
            }
        )
    return rows


def reject_dynamic_loading(code):
    """Conservative token gate, not a sandbox/data-flow proof; never evaluates."""
    loaders = {
        "require",
        "eval",
        "Function",
        "createRequire",
        "importScripts",
        "getBuiltinModule",
        "dlopen",
    }

    def after_trivia(index):
        while index < len(code):
            if code[index].isspace() or code[index] == "\ufeff":
                index += 1
                continue
            if code.startswith("//", index):
                index += 2
                while index < len(code) and code[index] not in "\r\n\u2028\u2029":
                    index += 1
                continue
            if code.startswith("/*", index):
                end = code.find("*/", index + 2)
                if end < 0:
                    raise ValueError("Unterminated dependency trivia")
                index = end + 2
                continue
            break
        return index

    index = 0
    while index < len(code):
        word = ""
        cursor = index
        # Intentionally inspect literal/comment/template text too. This can
        # reject inert loader-like text, but cannot skip hidden expressions.
        while cursor < len(code):
            if (
                code[cursor]
                in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$"
            ):
                word += code[cursor]
                cursor += 1
                continue
            if code.startswith("\\u", cursor):
                match = re.match(
                    r"\\u(?:\{([a-fA-F0-9]{1,6})\}|([a-fA-F0-9]{4}))", code[cursor:]
                )
                if match:
                    word += chr(int(match.group(1) or match.group(2), 16))
                    cursor += len(match.group(0))
                    continue
            break
        next_index = after_trivia(cursor) if word == "import" else cursor
        if (
            word in loaders
            or word == "import"
            and code[next_index : next_index + 1] == "("
        ):
            raise ValueError("Dynamic BFF dependency loader")
        index = max(index + 1, cursor)


def verify(root, kind, contract, source=True):
    root = Path(root)
    manifest = load_json(root / "spa-artifact-manifest.json")
    exact_keys(
        manifest,
        (
            "schema_version",
            "source_commit",
            "authored_digest",
            "asset_digest",
            "contract_digest",
            "ui_transport_protocol",
            "supported_contracts",
        ),
    )
    if (
        manifest["schema_version"] != "spa-artifact-v1"
        or not re.fullmatch(r"[a-f0-9]{40}", str(manifest["source_commit"]))
        or any(
            not HASH.fullmatch(str(manifest[k]))
            for k in ("authored_digest", "asset_digest", "contract_digest")
        )
        or type(manifest["ui_transport_protocol"]) is not int
        or manifest["ui_transport_protocol"] != 1
        or manifest["supported_contracts"] != ["workspace-view-v1"]
    ):
        raise ValueError("Malformed manifest")
    receipt = load_json(root / "artifact-inventory.json")
    exact_keys(
        receipt, ("schema_version", "kind", "release_slot", "authored", "assets")
    )
    if (
        receipt["schema_version"] != "spa-inventory-v1"
        or receipt["kind"] != kind
        or not SLOT.fullmatch(str(receipt["release_slot"]))
    ):
        raise ValueError("Malformed association")
    validate_rows(receipt["authored"], authored=True)
    validate_rows(receipt["assets"])
    if (
        digest(receipt["authored"]) != manifest["authored_digest"]
        or digest(receipt["assets"]) != manifest["asset_digest"]
        or inventory(root) != receipt["assets"]
    ):
        raise ValueError("Missing, extra or changed payload bytes")
    expected = {
        k: manifest[k]
        for k in (
            "source_commit",
            "authored_digest",
            "contract_digest",
            "ui_transport_protocol",
            "supported_contracts",
        )
    }
    expected["release_slot"] = receipt["release_slot"]
    if load_json(root / "artifact-identity.json") != expected:
        raise ValueError("Immutable association mismatch")
    if (
        hashlib.sha256(read_file(contract)[0]).hexdigest()
        != manifest["contract_digest"]
    ):
        raise ValueError("Wrong contract")
    if source and (
        git("status", "--porcelain", "--untracked-files=all")
        or git("rev-parse", "HEAD") != manifest["source_commit"]
        or source_inventory(kind) != receipt["authored"]
    ):
        raise ValueError("Wrong or dirty source")
    names = {r["path"] for r in receipt["assets"]}
    if kind == "bff":
        if (
            load_json(root / "package.json") != {"type": "module", "private": True}
            or not {"cli.js", "server.js"} <= names
        ):
            raise ValueError("BFF runtime metadata missing")
        for name in names:
            if name in {"artifact-identity.json", "package.json"}:
                continue
            if not name.endswith(".js"):
                raise ValueError("Unexpected BFF closure payload")
            code = read_file(root / name)[0].decode()
            reject_dynamic_loading(code)
            parse = (
                "import {SourceTextModule} from 'node:vm'; import {readFileSync} from 'node:fs'; "
                "const m=new SourceTextModule(readFileSync(0,'utf8')); process.stdout.write(JSON.stringify(m.dependencySpecifiers));"
            )
            result = subprocess.run(
                [
                    "node",
                    "--experimental-vm-modules",
                    "--input-type=module",
                    "-e",
                    parse,
                ],
                input=code,
                capture_output=True,
                text=True,
                env={"PATH": os.environ.get("PATH", os.defpath), "LANG": "C.UTF-8"},
                check=True,
            )
            for imported in json.loads(result.stdout):
                if imported in {
                    "node:async_hooks",
                    "node:crypto",
                    "node:http",
                    "node:path",
                    "node:url",
                }:
                    continue
                if (
                    not imported.startswith("./")
                    or not imported.endswith(".js")
                    or (Path(name).parent / imported).as_posix() not in names
                ):
                    raise ValueError("External/missing BFF dependency")
    else:
        prefix = "/_spa/releases/" + receipt["release_slot"] + "/"
        html = read_file(root / "index.html")[0].decode()
        targets = re.findall(r'''(?:src|href)="([^"]+)"''', html)
        if not any(
            t.startswith(prefix + "assets/") and t.endswith(".js") for t in targets
        ) or any(
            not t.startswith(prefix) or t[len(prefix) :] not in names for t in targets
        ):
            raise ValueError("Index association mismatch")
        code = [
            read_file(root / n)[0].decode()
            for n in names
            if n.startswith("assets/") and n.endswith(".js")
        ]
        if not any(
            all(
                value in c
                for value in (
                    receipt["release_slot"],
                    manifest["source_commit"],
                    manifest["authored_digest"],
                    manifest["contract_digest"],
                )
            )
            for c in code
        ):
            raise ValueError("Executable association missing")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web", required=True)
    parser.add_argument("--bff", required=True)
    parser.add_argument("--contract", required=True)
    args = parser.parse_args(argv)
    try:
        web = verify(args.web, "web", args.contract)
        bff = verify(args.bff, "bff", args.contract)
        if web["source_commit"] != bff["source_commit"]:
            raise ValueError("Different source snapshots")
    except (ValueError, OSError, TypeError, KeyError, subprocess.SubprocessError):
        print("FAIL: artifact/source/contract validation rejected")
        return 1
    print(
        "PASS: independent Web/BFF bytes match clean committed source and selected contract. Runtime/served bytes NOT_RUN."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
