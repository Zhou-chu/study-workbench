"""
Encryption contract for credential API keys (issue #1317).

Locks the versioned PBKDF2 derivation: new values carry a marker and
decrypt only under PBKDF2, legacy Fernet values and plaintext keep
reading, and a marked value under the wrong key raises instead of
leaking ciphertext shaped like a key.
"""

import base64
import hashlib

import pytest
from encryption_test_fixtures import _legacy_token
from encryption_test_fixtures import enc_key as _enc_key
from encryption_test_fixtures import fast_kdf as _fast_kdf
from pydantic import SecretStr

from open_notebook.utils import encryption as enc
from open_notebook.utils.encryption import decrypt_value, encrypt_value

enc_key = _enc_key
fast_kdf = _fast_kdf


def test_production_iteration_count():
    """The shipped cost parameter matches the agreed hardening level."""
    assert enc.PBKDF2_ITERATIONS == 600_000


def test_kdf_is_pbkdf2_not_sha256(enc_key):
    """The derived key equals PBKDF2-HMAC-SHA256 output, not bare SHA-256."""
    expected = base64.urlsafe_b64encode(
        hashlib.pbkdf2_hmac("sha256", enc_key.encode(), enc.PBKDF2_SALT, 600_000)
    ).decode()
    assert enc.derive_fernet_key(enc_key) == expected
    assert (
        enc.derive_fernet_key(enc_key)
        != base64.urlsafe_b64encode(hashlib.sha256(enc_key.encode()).digest()).decode()
    )


def test_round_trip_new_format(fast_kdf):
    """Encrypt then decrypt returns the original secret, marked at rest."""
    stored = encrypt_value("sk-live-secret")
    assert stored.startswith(enc.PBKDF2_MARKER)
    assert decrypt_value(stored) == "sk-live-secret"


def test_legacy_fernet_fallback(fast_kdf):
    """Ciphertext written by the old derivation still decrypts."""
    assert decrypt_value(_legacy_token("sk-legacy")) == "sk-legacy"


def test_legacy_plaintext_passthrough(fast_kdf):
    """Unencrypted legacy values pass through decryption unchanged."""
    assert decrypt_value("sk-plain-legacy") == "sk-plain-legacy"


def test_marked_value_wrong_key_raises(fast_kdf, monkeypatch):
    """A marked value under the wrong key raises, never returns ciphertext."""
    stored = encrypt_value("sk-live-secret")
    monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "wrong-passphrase")
    monkeypatch.setattr(enc, "_ENCRYPTION_KEY", None)
    monkeypatch.setattr(enc, "_FERNET", None)
    monkeypatch.setattr(enc, "_FERNET_LEGACY", None)
    with pytest.raises(ValueError):
        decrypt_value(stored)


def test_corrupt_marked_value_raises(fast_kdf):
    """Truncated or non-base64 marked payloads raise instead of passing through."""
    with pytest.raises(ValueError):
        decrypt_value(enc.PBKDF2_MARKER + "not-valid-base64!!!")
    with pytest.raises(ValueError):
        decrypt_value(enc.PBKDF2_MARKER + "aGk=")


def test_marker_like_plaintext_is_encrypted(fast_kdf):
    """Marker-like plaintext encrypts normally and round-trips losslessly."""
    plaintext = enc.PBKDF2_MARKER + "looks-like-a-key"
    stored = encrypt_value(plaintext)
    assert stored.startswith(enc.PBKDF2_MARKER)
    assert decrypt_value(stored) == plaintext


def test_corrupt_marked_input_is_not_passed_through(fast_kdf):
    """Corrupt marked input encrypts to a decryptable value, never passthrough."""
    corrupt = enc.PBKDF2_MARKER + "aGk="
    stored = encrypt_value(corrupt)
    assert decrypt_value(stored) == corrupt


def test_double_encrypt_guard(fast_kdf):
    """Encrypting an already-marked value does not double-wrap it."""
    stored = encrypt_value("sk-live-secret")
    assert encrypt_value(stored) == stored


def test_secretstr_shaped_value_round_trip(fast_kdf):
    """Values shaped like domain SecretStr payloads survive the round trip."""
    secret = SecretStr("sk-domain-shape").get_secret_value()
    assert decrypt_value(encrypt_value(secret)) == "sk-domain-shape"


def test_reencrypt_rejects_non_string_values():
    """Non-string stored values are errors, never migrated."""
    from api.credentials_service import _reencrypt_stored_value

    assert _reencrypt_stored_value(12345) == ("error", "unexpected-type")
    assert _reencrypt_stored_value(["sk-list"]) == ("error", "unexpected-type")


# Synthetic vectors captured from unmodified 92f7a3a, never user credentials.
# Literal expectations ensure salt/cost/derivation drift cannot regenerate them.
def test_pbkdf2_production_golden_key(enc_key):
    assert (
        enc.derive_fernet_key(enc_key) == "g2hpCyTpsD3HUcpWVgCu4nOCdMhLqfkgF5jwdu_dIPQ="
    )


@pytest.mark.parametrize(
    "stored",
    [
        "pbkdf2v1:gAAAAABlU_EAwieFwsAB5PDMdwB1f4qZdUINoBmB2Yig1stSun2hviyLlQU9BZUq4veHg6goIcsCgmGIJYuPeSMjx78feOmtDvin5Jx1t8_wl-UZq4IICU-edh8FfC9jrnUuQKSp5wdk",
        "gAAAAABlU_EAcrZ64bQ5pBPJpJKYvJqrGI-U8ojqYd5P58enUFNhLWznB8n1g0Ht7_VVhAfdQD5UwOKgwALPOMEBe2VuME-EaOE1SIbPeE6xJUhk7UpisYwz26PWB-XmINqSv05nnURR",
    ],
)
def test_pre_analyzer_fix_ciphertext_remains_readable(enc_key, stored):
    assert decrypt_value(stored) == "golden credential / compatibility"
