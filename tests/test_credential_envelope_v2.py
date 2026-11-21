"""Synthetic-only candidate envelope tests; no environment credentials or database."""

import base64
import hashlib
import importlib
import importlib.util

import pytest
from cryptography.fernet import Fernet

from open_notebook.utils import encryption as old

PASSPHRASE = "synthetic-candidate-passphrase"


def get_candidate():
    name = "open_notebook.utils.credential_envelope_v2"
    assert importlib.util.find_spec(name) is not None, (
        "explicit candidate API is missing"
    )
    return importlib.import_module(name)


def test_random_salts_and_authenticated_roundtrip():
    candidate = get_candidate()
    values = [
        candidate.encrypt_candidate("密钥 synthetic", passphrase=PASSPHRASE)
        for _ in range(2)
    ]
    assert values[0] != values[1]
    assert values[0].split(":")[1] != values[1].split(":")[1]
    for value in values:
        assert value.startswith("pbkdf2v2:")
        assert (
            candidate.decrypt_candidate(value, passphrase=PASSPHRASE)
            == "密钥 synthetic"
        )
        assert candidate.encrypt_candidate(value, passphrase=PASSPHRASE) == value


def test_fixed_cost_and_independent_v2_derivation():
    candidate = get_candidate()
    assert candidate.ITERATIONS == 600_000
    value = candidate.encrypt_candidate("vector", passphrase=PASSPHRASE)
    marker, salt_text, token = value.split(":")
    salt = base64.urlsafe_b64decode(salt_text)
    assert len(salt) == 16
    key = hashlib.pbkdf2_hmac(
        "sha256",
        PASSPHRASE.encode(),
        b"open-notebook-credential-v2\0" + salt,
        600_000,
        dklen=32,
    )
    assert Fernet(base64.urlsafe_b64encode(key)).decrypt(token.encode()) == b"vector"


def test_mixed_legacy_v1_and_plaintext_without_migration():
    candidate = get_candidate()
    legacy = (
        Fernet(base64.urlsafe_b64encode(hashlib.sha256(PASSPHRASE.encode()).digest()))
        .encrypt(b"legacy")
        .decode()
    )
    v1 = (
        old.PBKDF2_MARKER
        + Fernet(old.derive_fernet_key(PASSPHRASE).encode()).encrypt(b"old").decode()
    )
    for value, expected in [(legacy, "legacy"), (v1, "old"), ("plain", "plain")]:
        assert candidate.decrypt_candidate(value, passphrase=PASSPHRASE) == expected
    assert candidate.encrypt_candidate(v1, passphrase=PASSPHRASE) == v1


@pytest.mark.parametrize("alter", ["salt", "token", "version", "truncate", "wrong-key"])
def test_tampering_never_returns_ciphertext_as_plaintext(alter):
    candidate = get_candidate()
    value = candidate.encrypt_candidate("secret", passphrase=PASSPHRASE)
    marker, salt, token = value.split(":")
    key = PASSPHRASE
    if alter == "salt":
        salt = base64.urlsafe_b64encode(b"x" * 16).decode()
    elif alter == "token":
        token = ("A" if token[0] != "A" else "B") + token[1:]
    elif alter == "version":
        marker = "pbkdf2v3"
    elif alter == "truncate":
        token = token[:-5]
    else:
        key = "wrong synthetic key"
    with pytest.raises(ValueError):
        candidate.decrypt_candidate(":".join([marker, salt, token]), passphrase=key)


@pytest.mark.parametrize(
    "salt",
    [
        "",
        "YQ==",
        "!!!!!!!!!!!!!!!!!!!!!!!!",
        "eHh4eHh4eHh4eHh4eHh4eA",
        "eHh4eHh4eHh4eHh4eHh4eB==",
    ],
)
def test_noncanonical_or_wrong_size_salts_rejected_before_kdf(salt, monkeypatch):
    candidate = get_candidate()

    def forbidden(*args, **kwargs):
        raise AssertionError("KDF reached malformed input")

    monkeypatch.setattr(candidate.hashlib, "pbkdf2_hmac", forbidden)
    with pytest.raises(ValueError):
        candidate.decrypt_candidate(
            "pbkdf2v2:" + salt + ":gAAAAA==", passphrase=PASSPHRASE
        )


def test_limits_unknown_versions_and_bad_tokens_before_kdf(monkeypatch):
    candidate = get_candidate()

    def forbidden(*args, **kwargs):
        raise AssertionError("KDF reached malformed input")

    monkeypatch.setattr(candidate.hashlib, "pbkdf2_hmac", forbidden)
    for value in [
        "pbkdf2v2:" + "x" * 30000,
        "pbkdf2v99:bad",
        "pbkdf2v2:bad",
        "pbkdf2v2:eHh4eHh4eHh4eHh4eHh4eA==:not-token",
    ]:
        with pytest.raises(ValueError):
            candidate.decrypt_candidate(value, passphrase=PASSPHRASE)
    with pytest.raises(ValueError):
        candidate.encrypt_candidate("x" * 16385, passphrase=PASSPHRASE)


def test_marker_like_plaintext_and_empty_values():
    candidate = get_candidate()
    for text in ["", "pbkdf2v2:broken", "pbkdf2v100:ordinary input"]:
        value = candidate.encrypt_candidate(text, passphrase=PASSPHRASE)
        assert candidate.decrypt_candidate(value, passphrase=PASSPHRASE) == text


def test_default_api_stays_v1(monkeypatch):
    get_candidate()
    monkeypatch.setattr(old, "_ENCRYPTION_KEY", PASSPHRASE)
    monkeypatch.setattr(old, "_FERNET", None)
    assert old.encrypt_value("still v1").startswith("pbkdf2v1:")


@pytest.mark.parametrize(
    "value,passphrase,expected",
    [
        (
            "pbkdf2v2:AAECAwQFBgcICQoLDA0ODw==:gAAAAABlU_EAEREREREREREREREREREREcbc8a_6KWJA8sj9VyWk0LRC2qCG5INn5rFZUNym2ABtnOhHuZtSXL3EayvQuiaDZZncF70jwBZB-Y3KBwElefI=",
            PASSPHRASE,
            "synthetic v2 golden",
        ),
        (
            "pbkdf2v1:gAAAAABlU_EAwieFwsAB5PDMdwB1f4qZdUINoBmB2Yig1stSun2hviyLlQU9BZUq4veHg6goIcsCgmGIJYuPeSMjx78feOmtDvin5Jx1t8_wl-UZq4IICU-edh8FfC9jrnUuQKSp5wdk",
            "test-passphrase",
            "golden credential / compatibility",
        ),
        (
            "gAAAAABlU_EAcrZ64bQ5pBPJpJKYvJqrGI-U8ojqYd5P58enUFNhLWznB8n1g0Ht7_VVhAfdQD5UwOKgwALPOMEBe2VuME-EaOE1SIbPeE6xJUhk7UpisYwz26PWB-XmINqSv05nnURR",
            "test-passphrase",
            "golden credential / compatibility",
        ),
    ],
)
def test_literal_golden_corpus(value, passphrase, expected):
    candidate = get_candidate()
    assert candidate.decrypt_candidate(value, passphrase=passphrase) == expected
    with pytest.raises(ValueError):
        candidate.decrypt_candidate(value, passphrase="wrong synthetic passphrase")


def test_exact_plaintext_limit_and_unicode_byte_limit():
    candidate = get_candidate()
    value = candidate.encrypt_candidate("x" * 16384, passphrase=PASSPHRASE)
    assert candidate.decrypt_candidate(value, passphrase=PASSPHRASE) == "x" * 16384
    assert candidate.encrypt_candidate(value, passphrase=PASSPHRASE) == value
    with pytest.raises(ValueError):
        candidate.encrypt_candidate("密" * 5500, passphrase=PASSPHRASE)


@pytest.mark.parametrize(
    "value,passphrase", [(None, PASSPHRASE), ("x", ""), ("x", None)]
)
def test_explicit_input_contract(value, passphrase):
    candidate = get_candidate()
    with pytest.raises(ValueError):
        candidate.encrypt_candidate(value, passphrase=passphrase)
    with pytest.raises(ValueError):
        candidate.decrypt_candidate(value, passphrase=passphrase)
