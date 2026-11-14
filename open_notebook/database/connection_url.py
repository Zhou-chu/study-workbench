"""Database transport policy; pure validation, never resolve or connect a host."""

import ipaddress
import re
from urllib.parse import urlsplit

from open_notebook.exceptions import ConfigurationError

_INVALID = "SURREAL_URL: invalid database endpoint configuration"
_REMOTE = (
    "SURREAL_URL: remote database transport requires TLS; "
    "SURREAL_INSECURE_ALLOW_URL may explicitly accept one exact plaintext endpoint"
)


def _invalid() -> ConfigurationError:
    return ConfigurationError(_INVALID)


def validate_database_url(value: str, insecure_allow_url: str = "") -> str:
    """Preserve supported SDK URLs; explicit exceptions never bypass syntax checks."""
    if (
        not isinstance(value, str)
        or not value
        or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise _invalid()
    if "\\" in value or "?" in value or "#" in value:
        raise _invalid()
    if value in {"mem://", "memory://"}:
        return value
    # Existing SDK embedded schemes use its embedded engine, not HTTP/WS.
    # Path/storage semantics remain the SDK engine contract, not a TLS guarantee.
    for prefix in ("file://", "surrealkv://"):
        if value.startswith(prefix):
            if not value[len(prefix) :] or "@" in value:
                raise _invalid()
            return value
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        raise _invalid() from None
    if (
        parsed.scheme not in {"ws", "wss", "http", "https"}
        or not value.startswith(parsed.scheme + "://")
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or port == 0
        or parsed.netloc.endswith(":")
        or "%" in host
        or host.endswith(".")
    ):
        raise _invalid()
    authority = parsed.netloc
    if authority.startswith("["):
        authority_pattern = r"\[[0-9a-fA-F:.]+\](?::[0-9]+)?"
    else:
        authority_pattern = r"[a-zA-Z0-9.-]+(?::[0-9]+)?"
    if not re.fullmatch(authority_pattern, authority):
        raise _invalid()
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
        if len(host) > 253 or any(
            not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
            for label in host.split(".")
        ):
            raise _invalid() from None
        if all(char.isdigit() or char == "." for char in host):
            raise _invalid() from None
    loopback = host == "localhost" or (
        address is not None
        and address.is_loopback
        and (address.version == 4 or str(address) == "::1")
    )
    if parsed.scheme in {"wss", "https"} or loopback:
        return value
    if insecure_allow_url == value:
        return value
    raise ConfigurationError(_REMOTE)
