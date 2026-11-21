"""Canonical digest and relative artifact path validation."""

from spa_artifact_check_support import checker


def test_canonical_and_safe_paths():
    check = checker()
    assert check.digest({"a": 1, "b": 2}) == check.digest({"b": 2, "a": 1})
    for path in (
        "../private",
        "/abs",
        "a//b",
        "a/./b",
        "a\\b",
        ".env",
        "secrets/token",
        "node_modules/x",
        "x.pem",
    ):
        try:
            check.safe_path(path)
        except ValueError:
            pass
        else:
            raise AssertionError("Unsafe path accepted")
