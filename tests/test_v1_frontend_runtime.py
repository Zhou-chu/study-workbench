"""Pure local synthetic filesystem tests; no build/services/browser required."""

import os

import pytest

from scripts.v1 import frontend_runtime as module


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    (artifact / "server.js").write_bytes(b"public synthetic bytes")
    run = tmp_path / "run"
    run.mkdir(mode=0o700)
    calls = []

    def verify(src, tree):
        calls.append((src, tree))
        assert (tree / "server.js").read_bytes() == b"public synthetic bytes"
        return {"build_id": "synthetic"}

    monkeypatch.setattr(module, "verify_artifact", verify)
    return source, artifact, run, calls


def test_independent_bytes_and_complete_verification(fixture):
    source, artifact, run, calls = fixture
    (artifact / "server.js").chmod(0o755)
    copies = module.FrontendRuntimeCopies(run)
    runtime, identity = copies.create(source, artifact)
    assert identity == {"build_id": "synthetic"}
    assert [p for _, p in calls] == [artifact, runtime, artifact]
    assert (runtime / "server.js").stat().st_ino != (
        artifact / "server.js"
    ).stat().st_ino
    assert (runtime / "server.js").stat().st_nlink == 1
    assert (runtime / "server.js").stat().st_mode & 0o111 == 0o111
    (runtime / "server.js").write_text("runtime route cache")
    assert (artifact / "server.js").read_bytes() == b"public synthetic bytes"
    copies.remove_after_drain()
    assert not runtime.exists() and artifact.exists()


def test_internal_dependency_link_preserved(fixture):
    source, artifact, run, _ = fixture
    package = artifact / "node_modules/pkg"
    package.mkdir(parents=True)
    (package / "bin.js").write_text("fixture")
    binary = artifact / "node_modules/.bin"
    binary.mkdir()
    (binary / "fixture").symlink_to("../pkg/bin.js")
    copies = module.FrontendRuntimeCopies(run)
    runtime, _ = copies.create(source, artifact)
    assert os.readlink(runtime / "node_modules/.bin/fixture") == "../pkg/bin.js"
    assert (runtime / "node_modules/.bin/fixture").resolve().is_relative_to(runtime)
    copies.remove_after_drain()


@pytest.mark.parametrize(
    "kind", ["external", "absolute", "nondependency", "hardlink", "fifo"]
)
def test_rejects_unsafe_entries_retains_partial_for_drain(fixture, kind):
    source, artifact, run, _ = fixture
    (artifact / "node_modules").mkdir()
    target = artifact / "node_modules/bad"
    if kind == "external":
        target.symlink_to("../../source")
    elif kind == "absolute":
        target.symlink_to(artifact / "server.js")
    elif kind == "nondependency":
        (artifact / "bad").symlink_to("server.js")
    elif kind == "hardlink":
        os.link(artifact / "server.js", target)
    else:
        os.mkfifo(target)
    copies = module.FrontendRuntimeCopies(run)
    with pytest.raises(ValueError):
        copies.create(source, artifact)
    assert len(copies.copies) == 1 and copies.copies[0][0].exists()
    copies.remove_after_drain()
    assert artifact.exists()


def test_overlap_and_symlink_parent_rejected(fixture):
    source, artifact, run, _ = fixture
    copies = module.FrontendRuntimeCopies(run)
    with pytest.raises(ValueError, match="overlap"):
        copies.create(run, artifact)
    link = run.parent / "alias"
    link.symlink_to(run, target_is_directory=True)
    with pytest.raises(ValueError, match="links"):
        module.FrontendRuntimeCopies(link)


def test_failed_verifier_preserves_copy(fixture, monkeypatch):
    source, artifact, run, calls = fixture
    copies = module.FrontendRuntimeCopies(run)

    def fail_second(src, tree):
        calls.append(tree)
        if len(calls) == 2:
            raise RuntimeError("mismatch")
        return {"build_id": "synthetic"}

    monkeypatch.setattr(module, "verify_artifact", fail_second)
    with pytest.raises(RuntimeError, match="mismatch"):
        copies.create(source, artifact)
    assert copies.copies[0][0].exists()
    copies.remove_after_drain()


def test_replaced_copy_never_deleted(fixture):
    source, artifact, run, _ = fixture
    copies = module.FrontendRuntimeCopies(run)
    runtime, _ = copies.create(source, artifact)
    retained = run / "retained"
    runtime.rename(retained)
    runtime.mkdir()
    sentinel = runtime / "foreign"
    sentinel.write_text("do not remove")
    with pytest.raises(RuntimeError, match="replaced"):
        copies.remove_after_drain()
    assert sentinel.exists() and retained.exists()


def test_private_run_required(fixture):
    _, _, run, _ = fixture
    run.chmod(0o755)
    with pytest.raises(ValueError, match="private"):
        module.FrontendRuntimeCopies(run)


def test_replaced_parent_never_deleted(fixture):
    source, artifact, run, _ = fixture
    copies = module.FrontendRuntimeCopies(run)
    copies.create(source, artifact)
    retained = run.parent / "retained-run"
    run.rename(retained)
    run.mkdir(mode=0o700)
    with pytest.raises(RuntimeError, match="parent was replaced"):
        copies.remove_after_drain()
    assert retained.exists() and run.exists()


def test_original_changed_after_copy_fails(fixture, monkeypatch):
    source, artifact, run, _ = fixture
    calls = []

    def verify(src, path):
        calls.append(path)
        return {"build_id": "changed" if len(calls) == 3 else "synthetic"}

    monkeypatch.setattr(module, "verify_artifact", verify)
    copies = module.FrontendRuntimeCopies(run)
    with pytest.raises(RuntimeError, match="Authoritative"):
        copies.create(source, artifact)
    assert copies.copies[0][0].exists()
    copies.remove_after_drain()
