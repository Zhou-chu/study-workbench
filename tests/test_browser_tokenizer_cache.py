import hashlib
import os

import pytest

from scripts.v1 import local_check


def test_prepared_cache_seed_is_required_and_independent(tmp_path, monkeypatch):
    validate = getattr(local_check, "prepared_tokenizer", None)
    seed = getattr(local_check, "seed_tokenizer", None)
    assert callable(validate) and callable(seed), "prepared tokenizer custody missing"
    monkeypatch.setattr(
        local_check, "TOKENIZER_SHA256", hashlib.sha256(b"fixture").hexdigest()
    )
    source = tmp_path / "prepared"
    source.mkdir()
    file = source / local_check.TOKENIZER_FILE
    file.write_bytes(b"fixture")
    payload = validate(source)
    run = tmp_path / "run"
    run.mkdir()
    destination = seed(run, payload)
    assert destination == run / "upstream-data/tiktoken-cache"
    copied = destination / local_check.TOKENIZER_FILE
    assert copied.read_bytes() == file.read_bytes()
    assert copied.stat().st_ino != file.stat().st_ino
    assert copied.stat().st_nlink == 1
    with pytest.raises(FileExistsError):
        seed(run, payload)


@pytest.mark.parametrize(
    "unsafe", ["missing", "wrong-hash", "symlink", "hardlink", "extra"]
)
def test_prepared_cache_rejects_unsafe(tmp_path, unsafe):
    validate = getattr(local_check, "prepared_tokenizer", None)
    assert callable(validate), "prepared tokenizer custody missing"
    source = tmp_path / "prepared"
    source.mkdir()
    file = source / local_check.TOKENIZER_FILE
    if unsafe != "missing":
        file.write_bytes(b"not genuine")
    if unsafe == "symlink":
        target = tmp_path / "target"
        file.rename(target)
        file.symlink_to(target)
    if unsafe == "hardlink":
        os.link(file, tmp_path / "other")
    if unsafe == "extra":
        (source / "unexpected").write_text("extra")
    with pytest.raises((ValueError, OSError)):
        validate(source)


def test_browser_requires_explicit_cache_before_artifact_or_services(monkeypatch):
    monkeypatch.setattr(
        "sys.argv", ["local_check.py", "--browser", "--artifact", "/missing"]
    )
    monkeypatch.setattr(
        local_check,
        "verify_artifact",
        lambda *_: pytest.fail("verification must not precede missing-cache rejection"),
    )
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2


def test_destination_symlink_and_changed_payload_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(
        local_check, "TOKENIZER_SHA256", hashlib.sha256(b"fixture").hexdigest()
    )
    actual = tmp_path / "actual"
    actual.mkdir()
    linked = tmp_path / "linked"
    linked.symlink_to(actual, target_is_directory=True)
    with pytest.raises(ValueError):
        local_check.seed_tokenizer(linked, b"fixture")
    with pytest.raises(ValueError):
        local_check.seed_tokenizer(actual, b"changed")
    assert not list(actual.iterdir())
