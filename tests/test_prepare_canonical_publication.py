"""Committed canonical exports reject rather than silently transform content."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts/v1/prepare_canonical_publication.py"


def module():
    assert SCRIPT.exists(), "canonical exporter must exist"
    spec = importlib.util.spec_from_file_location("canonical", SCRIPT)
    assert spec is not None and spec.loader is not None
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args]).decode().strip()


def commit(repo):
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "fixture")
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.name", "Test")
    git(root, "config", "user.email", "test@example.invalid")
    for name, data in {
        "README.md": b"canonical\r\n",
        "README_UPSTREAM.md": b"historical upstream\n",
        "PUBLISH_MANIFEST.json": b'{"historical":true}\n',
        "binary.png": b"\x00\xffimage",
        "removed.txt": b"old",
        ".gitattributes": b"README.md export-ignore\n",
        "run.sh": b"#!/bin/sh\n",
    }.items():
        (root / name).write_bytes(data)
    (root / "run.sh").chmod(0o755)
    return root, commit(root)


def test_exact_tree_diff_and_dirty_tree_ignored(repo, tmp_path):
    root, base = repo
    m = module()
    (root / "added.txt").write_bytes(b"hello\r\n")
    (root / "run.sh").chmod(0o644)
    (root / "removed.txt").unlink()
    source = commit(root)
    (root / "README.md").write_text("dirty")
    (root / ".env").write_text("untracked private")
    out = tmp_path / "export"
    result = m.prepare(root, source, base, out)
    assert result["expected_tree_sha"] == git(root, "rev-parse", source + "^{tree}")
    assert result["baseline_tree_sha"] == git(root, "rev-parse", base + "^{tree}")
    assert result["source_parents"] == [base]
    assert (out / "README.md").read_bytes() == b"canonical\r\n"
    assert (out / "README_UPSTREAM.md").read_bytes() == b"historical upstream\n"
    assert (out / "PUBLISH_MANIFEST.json").read_bytes() == b'{"historical":true}\n'
    assert (out / "binary.png").read_bytes() == b"\x00\xffimage"
    assert not (out / ".env").exists()
    assert result["changes"] == {
        "added": ["added.txt"],
        "modified": ["run.sh"],
        "deleted": ["removed.txt"],
    }
    assert result["changed_text_blobs"][0]["content"] == "hello\r\n"
    assert "binary.png" in {f["path"] for f in result["unchanged_blobs"]}
    assert m.tree_sha(result["files"]) == result["expected_tree_sha"]
    assert result == m.prepare(root, source, base, tmp_path / "again")


@pytest.mark.parametrize(
    "name",
    [
        ".env",
        "data/private.txt",
        ".github/workflows/ci.yml",
        "credentials.json",
        "frontend/test-results/new.json",
        "test-results/.last-run.json",
        "foo.sqlite",
        "node_modules/x",
    ],
)
def test_exclusions_rejected_before_blob_reads(repo, tmp_path, monkeypatch, name):
    root, base = repo
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("synthetic forbidden fixture")
    source = commit(root)
    m = module()
    original = m.git

    def guarded(repo, *args):
        assert "cat-file" not in args, "must reject all paths before reading payloads"
        return original(repo, *args)

    monkeypatch.setattr(m, "git", guarded)
    with pytest.raises(ValueError, match="Forbidden"):
        m.prepare(root, source, base, tmp_path / "out")
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize(
    "path",
    [
        "../x",
        "/absolute",
        "a/../x",
        "a\\b",
        ".git/config",
        "A/.GIT/config",
        "a//b",
        "a/./b",
        "a/",
        "a\nname",
    ],
)
def test_unsafe_paths(path):
    with pytest.raises(ValueError, match="Unsafe"):
        module().validate_path(path)


@pytest.mark.parametrize("kind", ["link", "submodule"])
def test_nonregular_entries_rejected(repo, tmp_path, kind):
    root, base = repo
    if kind == "link":
        (root / "link").symlink_to("README.md")
        source = commit(root)
    else:
        git(root, "update-index", "--add", "--cacheinfo", f"160000,{base},submodule")
        git(root, "commit", "-qm", "gitlink")
        source = git(root, "rev-parse", "HEAD")
    with pytest.raises(ValueError, match="Unsupported"):
        module().prepare(root, source, base, tmp_path / "out")


def test_historical_runtime_only_known_unchanged_blob(repo, tmp_path):
    root, _ = repo
    m = module()
    p = root / "frontend/test-results/.last-run.json"
    p.parent.mkdir(parents=True)
    # Bytes of the explicitly grandfathered canonical baseline object.
    p.write_bytes(b'{\n  "status": "failed",\n  "failedTests": []\n}')
    base = commit(root)
    assert (
        git(root, "rev-parse", base + ":" + m.HISTORICAL_RUNTIME_PATH)
        == m.HISTORICAL_RUNTIME_SHA
    )
    result = m.prepare(root, base, base, tmp_path / "allowed")
    assert result["policy_exceptions"][0]["git_blob_sha"] == m.HISTORICAL_RUNTIME_SHA
    p.write_text("changed runtime")
    source = commit(root)
    with pytest.raises(ValueError, match="Forbidden"):
        m.prepare(root, source, base, tmp_path / "denied")
    with pytest.raises(ValueError, match="Forbidden"):
        m.prepare(root, source, source, tmp_path / "not_laundered")


@pytest.mark.parametrize("data", [b"\x00binary", b"\xffinvalid"])
def test_changed_binary_fails_without_output(repo, tmp_path, data):
    root, base = repo
    (root / "binary.png").write_bytes(data)
    source = commit(root)
    with pytest.raises(ValueError, match="binary"):
        module().prepare(root, source, base, tmp_path / "out")
    assert not (tmp_path / "out").exists()


def test_full_commit_ids_required(repo, tmp_path):
    root, base = repo
    for source, baseline in [("HEAD", base), (base, "HEAD"), (base[:8], base)]:
        with pytest.raises(ValueError, match="full"):
            module().prepare(root, source, baseline, tmp_path / "out")


def test_no_overwrite_or_symlink_output(repo, tmp_path):
    root, base = repo
    out = tmp_path / "out"
    out.mkdir()
    (out / "keep").write_text("keep")
    with pytest.raises(ValueError, match="new"):
        module().prepare(root, base, base, out)
    assert (out / "keep").read_text() == "keep"
    link = tmp_path / "link"
    link.symlink_to(out, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        module().prepare(root, base, base, link / "child")


def test_cli_receipt_external_new_and_matches(repo, tmp_path):
    root, base = repo
    out, receipt = tmp_path / "out", tmp_path / "receipt.json"
    import sys

    args = [
        sys.executable,
        str(SCRIPT),
        "--repo",
        str(root),
        "--commit",
        base,
        "--baseline",
        base,
        "--output",
        str(out),
        "--inventory",
        str(receipt),
    ]
    subprocess.run(args, check=True, capture_output=True)
    assert json.loads(receipt.read_text())["source_commit"] == base
    retry = subprocess.run(args, capture_output=True)
    assert retry.returncode != 0


def test_local_replace_refs_cannot_change_pinned_commit(repo, tmp_path):
    root, base = repo
    (root / "README.md").write_text("replacement content")
    replacement = commit(root)
    git(root, "replace", base, replacement)
    result = module().prepare(root, base, base, tmp_path / "out")
    assert (tmp_path / "out/README.md").read_bytes() == b"canonical\r\n"
    assert result["source_parents"] == []


def test_cli_inventory_inside_export_rejected_before_writes(repo, tmp_path):
    import sys

    root, base = repo
    out = tmp_path / "out"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--repo",
            str(root),
            "--commit",
            base,
            "--baseline",
            base,
            "--output",
            str(out),
            "--inventory",
            str(out / "receipt.json"),
        ],
        capture_output=True,
    )
    assert result.returncode != 0
    assert not out.exists()


def test_new_historical_runtime_is_not_grandfathered(repo, tmp_path):
    root, base = repo
    m = module()
    path = root / m.HISTORICAL_RUNTIME_PATH
    path.parent.mkdir(parents=True)
    path.write_bytes(b'{\n  "status": "failed",\n  "failedTests": []\n}')
    source = commit(root)
    with pytest.raises(ValueError, match="Forbidden"):
        m.prepare(root, source, base, tmp_path / "out")


@pytest.mark.parametrize(
    "entries",
    [
        b"100644 blob " + b"a" * 40 + b"\t../bad\0",
        (b"100644 blob " + b"a" * 40 + b"\tduplicate\0") * 2,
        b"100644 blob "
        + b"a" * 40
        + b"\tfile\0"
        + b"100644 blob "
        + b"a" * 40
        + b"\tfile/child\0",
    ],
)
def test_malformed_git_tree_inventory_rejected(monkeypatch, entries):
    m = module()
    monkeypatch.setattr(m, "git", lambda *args: entries)
    with pytest.raises(ValueError):
        m.read_tree("unused", "a" * 40)


def test_blob_hash_mismatch_does_not_create_output(repo, tmp_path, monkeypatch):
    root, base = repo
    m = module()
    original = m.git

    def corrupt(repo, *args):
        return b"wrong bytes" if args[0] == "cat-file" else original(repo, *args)

    monkeypatch.setattr(m, "git", corrupt)
    with pytest.raises(ValueError, match="integrity"):
        m.prepare(root, base, base, tmp_path / "out")
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("missing", ["blob", "unknown"])
def test_promisor_missing_objects_do_not_fetch(repo, tmp_path, monkeypatch, missing):
    root, base = repo
    git(
        root,
        "config",
        "remote.offlinefixture.url",
        str(tmp_path / "nonexistent-remote"),
    )
    git(root, "config", "remote.offlinefixture.promisor", "true")
    git(root, "config", "remote.offlinefixture.partialclonefilter", "blob:none")
    # Even permissive inherited transport settings must not weaken the wrapper.
    git(root, "config", "protocol.file.allow", "always")
    monkeypatch.setenv("GIT_ALLOW_PROTOCOL", "file")
    trace = tmp_path / "git-trace"
    monkeypatch.setenv("GIT_TRACE", str(trace))
    if missing == "blob":
        blob = git(root, "rev-parse", base + ":README.md")
        (root / ".git/objects" / blob[:2] / blob[2:]).unlink()
        source = base
    else:
        source = "a" * 40
    trace.write_text("")
    with pytest.raises(subprocess.CalledProcessError):
        module().prepare(root, source, base, tmp_path / "out")
    assert not (tmp_path / "out").exists()
    traced = trace.read_text()
    assert " fetch " not in traced
    assert "upload-pack" not in traced
    assert "remote-" not in traced


def test_shallow_source_reports_raw_committed_parents(repo, tmp_path):
    root, base = repo
    (root / "README.md").write_text("second")
    source = commit(root)
    (root / ".git/shallow").write_text(source + "\n")
    result = module().prepare(root, source, base, tmp_path / "out")
    assert result["source_parents"] == [base]


def test_merge_parents_ignore_signature_continuations(repo, tmp_path):
    root, base = repo
    (root / "README.md").write_text("second")
    second = commit(root)
    tree = git(root, "rev-parse", second + "^{tree}")
    data = (
        f"tree {tree}\nparent {base}\nparent {second}\n"
        "author Test <test@example.invalid> 1 +0000\n"
        "committer Test <test@example.invalid> 1 +0000\n"
        "gpgsig -----BEGIN SYNTHETIC SIGNATURE-----\n"
        f" parent {'b' * 40}\n -----END SYNTHETIC SIGNATURE-----\n\n"
        f"parent {'c' * 40}\n"
    ).encode()
    source = (
        subprocess.check_output(
            ["git", "-C", str(root), "hash-object", "-t", "commit", "-w", "--stdin"],
            input=data,
        )
        .decode()
        .strip()
    )
    (root / ".git/shallow").write_text(source + "\n")
    result = module().prepare(root, source, base, tmp_path / "out")
    assert result["source_parents"] == [base, second]


PUBLIC_NPMRC_PATH = "clients/mobile/.npmrc"
PUBLIC_NPMRC_BYTES = b"ignore-scripts=true\naudit=false\nfund=false\n"


def npmrc_commit(root, data, name=PUBLIC_NPMRC_PATH):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return commit(root)


def test_exact_public_npmrc_uses_tracked_bytes(repo, tmp_path):
    root, base = repo
    source = npmrc_commit(root, PUBLIC_NPMRC_BYTES)
    (root / PUBLIC_NPMRC_PATH).write_bytes(b"dirty synthetic content")
    m = module()
    for baseline in (base, source):
        out = tmp_path / baseline
        result = m.prepare(root, source, baseline, out)
        assert (out / PUBLIC_NPMRC_PATH).read_bytes() == PUBLIC_NPMRC_BYTES
        assert result["expected_tree_sha"] == git(root, "rev-parse", source + "^{tree}")
        assert result["policy_exceptions"] == [
            {
                "path": PUBLIC_NPMRC_PATH,
                "git_blob_sha": m.object_sha("blob", PUBLIC_NPMRC_BYTES),
                "reason": "exact reviewed public npm safety configuration v1",
            }
        ]


@pytest.mark.parametrize(
    "data",
    [
        b"",
        PUBLIC_NPMRC_BYTES + b"registry=https://example.invalid\n",
        PUBLIC_NPMRC_BYTES.replace(b"true", b"false"),
        PUBLIC_NPMRC_BYTES + b"//example.invalid/:_authToken=SYNTHETIC_TOKEN\n",
        PUBLIC_NPMRC_BYTES + b"//example.invalid/:_authToken=${NPM_TOKEN}\n",
        PUBLIC_NPMRC_BYTES + b"ignore-scripts=false\n",
        PUBLIC_NPMRC_BYTES + b"ignore-scripts=true\n",
        PUBLIC_NPMRC_BYTES + b"# comment\n",
        b"\xef\xbb\xbf" + PUBLIC_NPMRC_BYTES,
        PUBLIC_NPMRC_BYTES.decode().encode("utf-16"),
        PUBLIC_NPMRC_BYTES.replace(b"\n", b"\r\n"),
        PUBLIC_NPMRC_BYTES.rstrip(b"\n"),
        PUBLIC_NPMRC_BYTES + b"\n",
        PUBLIC_NPMRC_BYTES.replace(b"=", b" = "),
        b"\xff" + PUBLIC_NPMRC_BYTES,
    ],
)
def test_public_npmrc_rejects_any_different_bytes(repo, tmp_path, data):
    root, base = repo
    source = npmrc_commit(root, data)
    m = module()
    for source_id, base_id in ((source, base), (source, source), (base, source)):
        with pytest.raises(ValueError, match="Forbidden") as exc:
            m.prepare(root, source_id, base_id, tmp_path / "out")
        assert "SYNTHETIC_TOKEN" not in str(exc.value)
        assert not (tmp_path / "out").exists()


@pytest.mark.parametrize(
    "name",
    [
        ".npmrc",
        "other/.npmrc",
        "clients/Mobile/.npmrc",
        "clients/mobile/.NPMRC",
        "clients/mobile/nested/.npmrc",
        "Clients/mobile/.npmrc",
    ],
)
def test_other_npmrc_paths_rejected_before_reads(repo, tmp_path, monkeypatch, name):
    root, base = repo
    source = npmrc_commit(root, PUBLIC_NPMRC_BYTES, name)
    m = module()
    original = m.git

    def guarded(repo, *args):
        assert "cat-file" not in args
        return original(repo, *args)

    monkeypatch.setattr(m, "git", guarded)
    with pytest.raises(ValueError, match="Forbidden"):
        m.prepare(root, source, base, tmp_path / "out")


def test_public_npmrc_requires_content_and_valid_blob_hash(repo, tmp_path, monkeypatch):
    root, base = repo
    source = npmrc_commit(root, PUBLIC_NPMRC_BYTES)
    m = module()
    entries = m.read_tree(root, source)
    with pytest.raises(ValueError, match="Forbidden"):
        m.validate_policy(entries, entries)
    original = m.git

    def corrupt(repo, *args):
        if args[:2] == ("cat-file", "blob"):
            return PUBLIC_NPMRC_BYTES + b"# synthetic mismatch\n"
        return original(repo, *args)

    monkeypatch.setattr(m, "git", corrupt)
    with pytest.raises(ValueError, match="integrity"):
        m.prepare(root, source, base, tmp_path / "out")
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("mode", ["100755", "120000", "160000"])
def test_public_npmrc_requires_nonexecutable_regular_mode(repo, tmp_path, mode):
    root, base = repo
    source = npmrc_commit(root, PUBLIC_NPMRC_BYTES)
    sha = (
        base
        if mode == "160000"
        else git(root, "rev-parse", source + ":" + PUBLIC_NPMRC_PATH)
    )
    git(root, "update-index", "--cacheinfo", f"{mode},{sha},{PUBLIC_NPMRC_PATH}")
    git(root, "commit", "-qm", "mode fixture")
    with pytest.raises(ValueError, match="Forbidden|Unsupported"):
        module().prepare(root, git(root, "rev-parse", "HEAD"), base, tmp_path / "out")


@pytest.mark.parametrize(
    "name",
    [
        "clients/../clients/mobile/.npmrc",
        "clients//mobile/.npmrc",
        "clients/mobile/./.npmrc",
        "/clients/mobile/.npmrc",
        "clients\\mobile\\.npmrc",
    ],
)
def test_public_npmrc_does_not_normalize_paths(monkeypatch, name):
    m = module()
    raw = (
        b"100644 blob "
        + m.object_sha("blob", PUBLIC_NPMRC_BYTES).encode()
        + b"\t"
        + name.encode()
        + b"\0"
    )
    monkeypatch.setattr(m, "git", lambda *args: raw)
    with pytest.raises(ValueError, match="Unsafe"):
        m.read_tree("unused", "a" * 40)


def test_forbidden_inventory_precedes_public_npmrc_content(repo, tmp_path, monkeypatch):
    root, base = repo
    npmrc_commit(root, PUBLIC_NPMRC_BYTES)
    source = npmrc_commit(root, b"synthetic", "forbidden/.env")
    m = module()
    original = m.git

    def guarded(repo, *args):
        assert "cat-file" not in args
        return original(repo, *args)

    monkeypatch.setattr(m, "git", guarded)
    with pytest.raises(ValueError, match="Forbidden"):
        m.prepare(root, source, base, tmp_path / "out")


def test_safe_baseline_public_npmrc_can_be_explicitly_deleted(repo, tmp_path):
    root, _ = repo
    base = npmrc_commit(root, PUBLIC_NPMRC_BYTES)
    (root / PUBLIC_NPMRC_PATH).unlink()
    source = commit(root)
    result = module().prepare(root, source, base, tmp_path / "out")
    assert result["changes"]["deleted"] == [PUBLIC_NPMRC_PATH]
    assert result["policy_exceptions"] == []
    assert not (tmp_path / "out" / PUBLIC_NPMRC_PATH).exists()


def test_missing_public_npmrc_blob_fails_closed(repo, tmp_path):
    root, base = repo
    source = npmrc_commit(root, PUBLIC_NPMRC_BYTES)
    sha = git(root, "rev-parse", source + ":" + PUBLIC_NPMRC_PATH)
    (root / ".git/objects" / sha[:2] / sha[2:]).unlink()
    with pytest.raises(subprocess.CalledProcessError):
        module().prepare(root, source, base, tmp_path / "out")
    assert not (tmp_path / "out").exists()
