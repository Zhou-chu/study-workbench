"""Unwired credential-envelope candidate for explicit synthetic evaluation only.

No application caller imports this module. Existing encryption.py remains the
production format. Enabling these APIs requires a separate rollout decision.
"""

import base64
import binascii
import hashlib
import secrets

from cryptography.fernet import Fernet, InvalidToken

from .encryption import PBKDF2_MARKER, derive_fernet_key, looks_like_fernet_token

MARKER = "pbkdf2v2:"
ITERATIONS = 600_000
SALT_BYTES = 16
DOMAIN = b"open-notebook-credential-v2\0"
MAX_PLAINTEXT_BYTES = 16_384
MAX_ENVELOPE_CHARS = 24_000


def _canonical_decode(text: str) -> bytes:
    try:
        decoded = base64.b64decode(text.encode("ascii"), altchars=b"-_", validate=True)
    except (ValueError, UnicodeError, binascii.Error) as exc:
        raise ValueError("Invalid candidate envelope encoding") from exc
    if base64.urlsafe_b64encode(decoded).decode("ascii") != text:
        raise ValueError("Noncanonical candidate envelope encoding")
    return decoded


def _parse_v2(value: str) -> tuple[bytes, bytes]:
    parts = value.split(":")
    if len(parts) != 3 or parts[0] != "pbkdf2v2":
        raise ValueError("Invalid candidate envelope")
    salt = _canonical_decode(parts[1])
    token = _canonical_decode(parts[2])
    if len(salt) != SALT_BYTES:
        raise ValueError("Invalid candidate salt length")
    if len(token) < 73 or token[0] != 0x80 or (len(token) - 57) % 16:
        raise ValueError("Invalid candidate token structure")
    return salt, parts[2].encode("ascii")


def _fernet(passphrase: str, salt: bytes) -> Fernet:
    key = hashlib.pbkdf2_hmac(
        "sha256", passphrase.encode("utf-8"), DOMAIN + salt, ITERATIONS, dklen=32
    )
    return Fernet(base64.urlsafe_b64encode(key))


def _validate_input(value: str, passphrase: str) -> None:
    if not isinstance(value, str) or not isinstance(passphrase, str) or not passphrase:
        raise ValueError(
            "Candidate API requires text and an explicit nonempty passphrase"
        )
    if len(value) > MAX_ENVELOPE_CHARS:
        raise ValueError("Candidate envelope exceeds the evaluation limit")


def decrypt_candidate(value: str, *, passphrase: str) -> str:
    """Read v2, historical v1/legacy and unmarked plaintext without writing.

    Recognized/unknown version-like input never downgrades to plaintext. The
    candidate's bounded size policy is new, so rollout requires corpus preflight.
    """
    _validate_input(value, passphrase)
    try:
        if value.startswith(MARKER):
            salt, token = _parse_v2(value)
            return _fernet(passphrase, salt).decrypt(token).decode("utf-8")
        if value.startswith(PBKDF2_MARKER):
            return (
                Fernet(derive_fernet_key(passphrase).encode())
                .decrypt(value[len(PBKDF2_MARKER) :].encode())
                .decode("utf-8")
            )
        if value.startswith("pbkdf2v"):
            raise ValueError("Unsupported candidate envelope version")
        legacy_key = base64.urlsafe_b64encode(
            hashlib.sha256(passphrase.encode()).digest()
        )
        try:
            return Fernet(legacy_key).decrypt(value.encode()).decode("utf-8")
        except InvalidToken:
            if looks_like_fernet_token(value):
                raise ValueError("Legacy ciphertext authentication failed") from None
            return value
    except (InvalidToken, UnicodeError) as exc:
        raise ValueError("Candidate ciphertext authentication failed") from exc


def encrypt_candidate(value: str, *, passphrase: str) -> str:
    """Explicit candidate writer; valid marked input stays unchanged, not migrated.

    This does not change production defaults. Invalid marker-like plaintext is
    encrypted normally, matching the established writer's non-double-wrap policy.
    """
    _validate_input(value, passphrase)
    if value.startswith((MARKER, PBKDF2_MARKER)):
        try:
            decrypt_candidate(value, passphrase=passphrase)
        except ValueError:
            pass
        else:
            return value
    plaintext = value.encode("utf-8")
    if len(plaintext) > MAX_PLAINTEXT_BYTES:
        raise ValueError("Candidate plaintext exceeds the evaluation limit")
    salt = secrets.token_bytes(SALT_BYTES)
    token = _fernet(passphrase, salt).encrypt(plaintext).decode("ascii")
    return MARKER + base64.urlsafe_b64encode(salt).decode("ascii") + ":" + token
