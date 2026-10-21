#!/usr/bin/env python3
"""Prepare an offline, reviewable private snapshot; never connects to a remote."""

import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path, PurePosixPath
from typing import TypeAlias

Tree: TypeAlias = dict[str, "Tree | tuple[str, str]"]


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def object_sha(kind, data):
    return hashlib.sha1(
        kind.encode() + b" " + str(len(data)).encode() + b"\0" + data
    ).hexdigest()


def safe_path(name):
    parts = name.rstrip("/").split("/")
    if not name or "\\" in name or any(p in {"", ".", "..", ".git"} for p in parts):
        raise ValueError(f"Unsafe archive path: {name!r}")
    return name.rstrip("/")


def read_archive(data):
    files = {}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        for member in archive:
            name = safe_path(member.name)
            if name in seen:
                raise ValueError(f"Duplicate archive path: {name}")
            seen.add(name)
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f"Unsupported archive entry (links forbidden): {name}")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"Unreadable archive file: {name}")
            files[name] = (
                stream.read(),
                "100755" if member.mode & 0o111 else "100644",
            )
    return files


def exclusion(name):
    path = PurePosixPath(name)
    parts = path.parts
    if name.startswith(".github/workflows/") or name in {
        ".github/dependabot.yml",
        ".github/dependabot.yaml",
    }:
        return "upstream automation disabled"
    if name == ".mcp.json" or name.startswith(
        (".claude/sessions/", ".maintainer/state/")
    ):
        return "local private tool state"
    runtime = {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".next",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".runtime",
        ".config",
        ".notebooklm",
        ".aws",
        ".ssh",
    }
    if runtime.intersection(parts) or parts[0] in {
        "data",
        "storage",
        "uploads",
        "logs",
        "backups",
        "surreal_data",
        "notebook_data",
        "runtime",
    }:
        return "runtime or local configuration"
    if (
        (path.name.startswith(".env") and not path.name.endswith(".example"))
        or path.name
        in {
            ".git-credentials",
            ".netrc",
            ".pypirc",
            ".npmrc",
            "credentials.json",
            "token.json",
            "storage_state.json",
            "storage-state.json",
            "cookies.json",
            "id_rsa",
            "id_ed25519",
        }
        or path.suffix.lower()
        in {".secret", ".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db"}
    ):
        return "potential secrets or private runtime state"
    if (
        "evidence" in parts
        and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        and "browser" in parts
    ):
        return "browser screenshot evidence omitted"
    if path.name in {
        "coverage.json",
        "coverage.xml",
        "coverage-final.json",
        ".coverage",
    }:
        return "raw coverage omitted; summaries retained"
    return None


def root_readme(commit):
    return f"""# StudyWorkbench · 开发进度

> 本仓库展示开发中的 V1 源代码和已记录的验证结果，不代表完整验收或生产部署。
> 上传 GitHub 不等于部署应用，也不证明外部访问、真实 Google/NotebookLM 或模型能力已验收。

## 当前进度与验收边界

- [当前进度](docs/v1/PROGRESS.md)：最新检查点、测试结果及下一步。
- [验收矩阵](docs/v1/ACCEPTANCE.md)：真实验证、模拟测试、部分完成和阻塞项。
- [运行手册](docs/v1/RUNBOOK.md)：本地配置与复现。
- [开发计划](docs/v1/DEVELOPMENT_PLAN.md) · [验证证据](docs/v1/evidence/)
- [上游说明](README_UPSTREAM.md)：原始 README 字节保留，不作为本项目功能承诺。

测试数量及功能状态以以上文档中对应提交的最新记录为准；本次导出不重新运行测试，
也不把历史测试或 fake 注入结果当作当前线上能力证明。

## 快照来源与发布边界

源提交：`{commit}`。仅以 `git archive` 导出该提交的已跟踪文件，无 Git 历史或未跟踪文件。
保留的源码、许可证、锁文件、静态资源、测试夹具及合成示例 ZIP 逐字节一致。
仅替换本首页，并将原 README 保存为 `README_UPSTREAM.md`。

排除上游 GitHub workflows、Dependabot、运行数据与敏感路径，避免意外自动发布。
省略浏览器截图和原始覆盖率文件；保留日志和摘要。历史文档中的部分证据链接因此可能不可用。
完整排除清单见 [发布清单](PUBLISH_MANIFEST.json)。这是路径过滤而非秘密内容扫描；发布前仍需人工审核。
""".encode()


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def tree_sha(files):
    root: Tree = {}
    for item in files:
        node = root
        parts = item["path"].split("/")
        for part in parts[:-1]:
            child = node.setdefault(part, {})
            if not isinstance(child, dict):
                raise ValueError(f"File/directory collision: {item['path']}")
            node = child
        node[parts[-1]] = (item["mode"], item["git_blob_sha"])

    def digest(node):
        entries = []
        for name, value in node.items():
            directory = isinstance(value, dict)
            mode, sha = ("40000", digest(value)) if directory else value
            raw = name.encode("utf-8")
            entries.append(
                (
                    raw + (b"/" if directory else b""),
                    mode.encode() + b" " + raw + b"\0" + bytes.fromhex(sha),
                )
            )
        return object_sha("tree", b"".join(entry for _, entry in sorted(entries)))

    return digest(root)


def new_destination(path):
    path = Path(path).absolute()
    if path.exists() or path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise ValueError(
            f"Destination must be new and have no symlink ancestors: {path}"
        )
    if not path.parent.is_dir():
        raise ValueError(f"Destination parent must already exist: {path.parent}")
    return path


def prepare(repo, commit, output, previous=None):
    output = new_destination(output)
    resolved = (
        git(repo, "rev-parse", "--verify", "--end-of-options", f"{commit}^{{commit}}")
        .decode()
        .strip()
    )
    tracked = {}
    for entry in git(repo, "ls-tree", "-rz", resolved).split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        mode, kind, sha = metadata.decode().split()
        name = safe_path(raw_name.decode("utf-8"))
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"Links/submodules unsupported: {name}")
        tracked[name] = (mode, sha)
    source = read_archive(git(repo, "archive", "--format=tar", resolved))
    if source.keys() != tracked.keys():
        raise ValueError(
            "Archive differs from tracked tree (e.g. export-ignore attributes)"
        )
    for name, (data, mode) in source.items():
        if tracked[name] != (mode, object_sha("blob", data)):
            raise ValueError(f"Archive parity mismatch (e.g. export-subst): {name}")
    if "README.md" not in source or {
        "README_UPSTREAM.md",
        "PUBLISH_MANIFEST.json",
    }.intersection(source):
        raise ValueError(
            "Source needs README.md and no reserved generated snapshot filenames"
        )
    excluded = []
    files = {}
    for name, content in source.items():
        reason = exclusion(name)
        if reason:
            excluded.append({"path": name, "reason": reason, "bytes": len(content[0])})
        else:
            files[name] = content
    files["README_UPSTREAM.md"] = source["README.md"]
    files["README.md"] = (root_readme(resolved), "100644")
    manifest = {
        "schema_version": 1,
        "source_commit": resolved,
        "method": "git archive; byte/mode parity verified; no history or network",
        "presentation_only_changes": [
            "README.md",
            "README_UPSTREAM.md",
            "PUBLISH_MANIFEST.json",
        ],
        "excluded_files": excluded,
    }
    files["PUBLISH_MANIFEST.json"] = (encode_json(manifest), "100644")
    inventory = []
    for name, (data, mode) in sorted(files.items()):
        inventory.append(
            {
                "path": name,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "git_blob_sha": object_sha("blob", data),
                "mode": mode,
            }
        )
    old = {}
    for item in (previous or {}).get("files", []):
        name = safe_path(item["path"])
        if name in old:
            raise ValueError(f"Duplicate previous inventory path: {name}")
        old[name] = item
    current = {item["path"]: item for item in inventory}
    changes = {
        "added": sorted(current.keys() - old.keys()),
        "deleted": sorted(old.keys() - current.keys()),
        "modified": sorted(
            name
            for name in current.keys() & old.keys()
            if any(current[name][key] != old[name][key] for key in ("sha256", "mode"))
        ),
    }
    result = {
        "schema_version": 1,
        "source_commit": resolved,
        "total_files": len(inventory),
        "total_bytes": sum(f["bytes"] for f in inventory),
        "expected_tree_sha": tree_sha(inventory),
        "files": inventory,
        "changes": changes,
    }
    output.mkdir()
    for name, (data, mode) in files.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as handle:
            handle.write(data)
        path.chmod(0o755 if mode == "100755" else 0o644)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--inventory",
        type=Path,
        required=True,
        help="New JSON file outside the snapshot",
    )
    parser.add_argument("--previous-inventory", type=Path)
    args = parser.parse_args()
    inventory = new_destination(args.inventory)
    output = new_destination(args.output)
    if inventory == output or output in inventory.parents:
        parser.error("Inventory must be outside the snapshot")
    previous = (
        json.loads(args.previous_inventory.read_text())
        if args.previous_inventory
        else None
    )
    result = prepare(args.repo, args.commit, output, previous)
    with inventory.open("xb") as handle:
        handle.write(encode_json(result))
    print(
        json.dumps(
            {
                k: result[k]
                for k in (
                    "source_commit",
                    "total_files",
                    "expected_tree_sha",
                    "changes",
                )
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
