"""Direct policy and synthetic Git inventory parser arguments."""

import pytest

from scripts.v1 import prepare_canonical_publication


def module():
    return prepare_canonical_publication


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
