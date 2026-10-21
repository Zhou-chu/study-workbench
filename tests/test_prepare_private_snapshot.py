"""Offline snapshot boundaries: no working-tree, traversal or remote writes."""

import hashlib
import importlib.util
import io
import json
import subprocess
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts/v1/prepare_private_snapshot.py"


def module():
    assert SCRIPT.exists(), "offline exporter must exist"
    spec = importlib.util.spec_from_file_location("snapshot", SCRIPT)
    assert spec is not None and spec.loader is not None
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args]).decode().strip()


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.name", "Test")
    git(root, "config", "user.email", "test@example.invalid")
    for name, data in {
        "README.md": b"upstream\n",
        "LICENSE": b"license",
        "uv.lock": b"lock",
        "frontend/public/logo.png": b"\x00image",
        "tests/fixtures/data.txt": b"fixture",
        "docs/v1/examples/synthetic.zip": b"PK\x00example",
        "run.sh": b"#!/bin/sh\n",
        ".github/workflows/check.yml": b"workflow",
        ".github/dependabot.yml": b"bot",
        ".env": b"secret",
        ".env.example": b"TOKEN=",
        "data/private.txt": b"private",
        "docs/v1/evidence/browser/desktop.png": b"screenshot",
        "docs/v1/evidence/backend/coverage.json": b"raw",
        "docs/v1/evidence/backend/summary.json": b"summary",
    }.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    (root / "run.sh").chmod(0o755)
    git(root, "add", ".")
    git(root, "commit", "-qm", "fixture")
    return root


def test_export_parity_tree_readme_and_committed_only(repo, tmp_path):
    m = module()
    commit = git(repo, "rev-parse", "HEAD")
    (repo / "LICENSE").write_text("dirty")
    (repo / "untracked").write_text("private")
    out = tmp_path / "snapshot"
    inventory = m.prepare(repo, commit, out)
    assert (out / "LICENSE").read_bytes() == b"license"
    assert not (out / "untracked").exists()
    assert (out / "README_UPSTREAM.md").read_bytes() == b"upstream\n"
    assert commit in (out / "README.md").read_text()
    assert "docs/v1/PROGRESS.md" in (out / "README.md").read_text()
    excluded = [
        ".env",
        "data/private.txt",
        ".github/workflows/check.yml",
        ".github/dependabot.yml",
        "docs/v1/evidence/browser/desktop.png",
        "docs/v1/evidence/backend/coverage.json",
    ]
    assert all(not (out / name).exists() for name in excluded)
    for name in [
        "uv.lock",
        "frontend/public/logo.png",
        "tests/fixtures/data.txt",
        "docs/v1/examples/synthetic.zip",
        ".env.example",
    ]:
        assert (out / name).read_bytes() == (repo / name).read_bytes()
    for item in inventory["files"]:
        data = (out / item["path"]).read_bytes()
        assert item["sha256"] == hashlib.sha256(data).hexdigest()
        assert (
            item["git_blob_sha"]
            == hashlib.sha1(
                b"blob " + str(len(data)).encode() + b"\0" + data
            ).hexdigest()
        )
    assert (
        next(f for f in inventory["files"] if f["path"] == "run.sh")["mode"] == "100755"
    )
    git(out, "init", "-q")
    git(out, "add", "--all")
    assert inventory["expected_tree_sha"] == git(out, "write-tree")


@pytest.mark.parametrize("kind", ["empty", "nonempty", "symlink", "ancestor_symlink"])
def test_refuse_existing_or_symlink_output(repo, tmp_path, kind):
    m = module()
    out = tmp_path / "out"
    if kind == "ancestor_symlink":
        out.symlink_to(repo, target_is_directory=True)
        out /= "new"
    elif kind == "symlink":
        out.symlink_to(repo, target_is_directory=True)
    else:
        out.mkdir()
        if kind == "nonempty":
            (out / "keep").write_text("keep")
    with pytest.raises(ValueError):
        m.prepare(repo, "HEAD", out)
    assert (repo / "README.md").read_text() == "upstream\n"


@pytest.mark.parametrize(
    "name,kind",
    [
        ("../outside", "file"),
        ("/absolute", "file"),
        ("a/../../outside", "file"),
        ("a\\evil", "file"),
        ("link", "symlink"),
        ("hard", "hardlink"),
    ],
)
def test_reject_unsafe_archive_members(name, kind):
    m = module()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        member = tarfile.TarInfo(name)
        if kind != "file":
            member.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
            member.linkname = "outside"
        archive.addfile(member)
    with pytest.raises(ValueError):
        m.read_archive(buffer.getvalue())


def test_incremental_deletes_mode_changes_and_legacy_inventory(repo, tmp_path):
    m = module()
    first = m.prepare(repo, "HEAD", tmp_path / "first")
    legacy = {
        "files": [
            {k: v for k, v in f.items() if k != "git_blob_sha"} for f in first["files"]
        ]
    }
    (repo / "LICENSE").unlink()
    (repo / "run.sh").chmod(0o644)
    (repo / "new.txt").write_text("new")
    git(repo, "add", "--all")
    git(repo, "commit", "-qm", "iteration")
    second = m.prepare(repo, "HEAD", tmp_path / "second", legacy)
    assert second["changes"]["deleted"] == ["LICENSE"]
    assert second["changes"]["added"] == ["new.txt"]
    assert "run.sh" in second["changes"]["modified"]
    assert "README.md" in second["changes"]["modified"]
    assert "uv.lock" not in second["changes"]["modified"]
    assert json.loads((tmp_path / "second/PUBLISH_MANIFEST.json").read_text())[
        "source_commit"
    ] == git(repo, "rev-parse", "HEAD")


@pytest.mark.parametrize(
    "name",
    [
        ".env.local",
        ".env.v1",
        "uploads/file.txt",
        "runtime/state.json",
        ".aws/config",
        "nested/token.json",
        "nested/key.pem",
        "nested/state.sqlite",
        "nested/node_modules/x.js",
    ],
)
def test_sensitive_path_exclusions(name):
    assert module().exclusion(name)


@pytest.mark.parametrize(
    "change", ["symlink", "submodule", "export-ignore", "export-subst", "reserved"]
)
def test_reject_source_parity_hazards_before_output(repo, tmp_path, change):
    if change == "symlink":
        (repo / "link").symlink_to("LICENSE")
    elif change == "submodule":
        git(
            repo,
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{git(repo, 'rev-parse', 'HEAD')},submodule",
        )
    elif change == "reserved":
        (repo / "README_UPSTREAM.md").write_text("do not overwrite")
    else:
        (repo / ".gitattributes").write_text(f"LICENSE {change}\n")
        if change == "export-subst":
            (repo / "LICENSE").write_text("$Format:%H$")
    if change != "submodule":
        git(repo, "add", ".")
    git(repo, "commit", "-qm", change)
    output = tmp_path / "rejected"
    with pytest.raises(ValueError):
        module().prepare(repo, "HEAD", output)
    assert not output.exists()


def test_repeatable_bytes_and_tree(repo, tmp_path):
    m = module()
    first = m.prepare(repo, "HEAD", tmp_path / "a")
    second = m.prepare(repo, "HEAD", tmp_path / "b", first)
    assert first["files"] == second["files"]
    assert first["expected_tree_sha"] == second["expected_tree_sha"]
    assert second["changes"] == {"added": [], "deleted": [], "modified": []}


@pytest.mark.parametrize(
    "name", [".runtime/private.log", "evidence/browser/screen.png"]
)
def test_actual_runtime_and_root_browser_evidence_excluded(name):
    assert module().exclusion(name)


@pytest.mark.parametrize(
    "name",
    [
        "provider.secret",
        ".mcp.json",
        ".claude/sessions/private.json",
        ".maintainer/state/private.json",
    ],
)
def test_repository_local_secret_conventions_excluded(name):
    assert module().exclusion(name)


@pytest.mark.parametrize(
    "name",
    [
        ".git-credentials",
        ".netrc",
        ".pypirc",
        ".npmrc",
        ".config/gcloud/token.json",
        ".config/notebooklm/state.json",
        ".notebooklm/storage_state.json",
    ],
)
def test_private_credential_configuration_excluded(name):
    assert module().exclusion(name)
