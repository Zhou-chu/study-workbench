"""Direct snapshot policy and in-memory archive input."""

import io
import tarfile

import pytest

from scripts.v1 import prepare_private_snapshot


def module():
    return prepare_private_snapshot


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
