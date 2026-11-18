"""Bounded synthetic encryption passphrase and known legacy cipher fixture."""

import base64
import hashlib

import pytest
from cryptography.fernet import Fernet

from open_notebook.utils import encryption as enc


@pytest.fixture()
def enc_key(monkeypatch):
    """Isolate the module from ambient env and cached keys per test."""
    monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "test-passphrase")
    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE", raising=False)
    monkeypatch.setattr(enc, "_ENCRYPTION_KEY", None)
    monkeypatch.setattr(enc, "_FERNET", None)
    monkeypatch.setattr(enc, "_FERNET_LEGACY", None)
    return "test-passphrase"


@pytest.fixture()
def fast_kdf(monkeypatch, enc_key):
    """Lower the iteration count so the suite stays fast.

    One test asserts the production constant separately.
    """
    monkeypatch.setattr(enc, "PBKDF2_ITERATIONS", 1_000)
    return enc_key


def _legacy_token(secret: str, passphrase: str = "test-passphrase") -> str:
    """Ciphertext as written before #1317 (bare SHA-256 derivation)."""
    derived = hashlib.sha256(passphrase.encode()).digest()
    fernet = Fernet(base64.urlsafe_b64encode(derived))
    return fernet.encrypt(secret.encode()).decode()
