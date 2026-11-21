"""Exact live-link identity and conservative read-only legacy compatibility."""

from typing import Any, Protocol
from uuid import NAMESPACE_URL, uuid5

from open_notebook.exceptions import InvalidInputError


class _LinkReader(Protocol):
    async def get_many(
        self, kind: str, identities: list[str]
    ) -> dict[str, dict[str, Any] | None]: ...


def notebooklm_link_id(notebook_id: str) -> str:
    """Retain the existing link route's deterministic identity."""
    return "link_" + str(uuid5(NAMESPACE_URL, notebook_id))


def _validate(
    value: Any, notebook_id: str, link_id: str, *, canonical: bool
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvalidInputError("NOTEBOOKLM_LINK_INVALID")
    if value.get("notebook_id") != notebook_id:
        raise InvalidInputError("NOTEBOOKLM_LINK_OWNER_MISMATCH")
    if canonical and not all(
        key in value for key in ("link_id", "connection_id", "last_checked_at")
    ):
        raise InvalidInputError("NOTEBOOKLM_LINK_INVALID")
    if "link_id" in value and value["link_id"] != link_id:
        raise InvalidInputError("NOTEBOOKLM_LINK_INVALID")
    if "connection_id" in value and value["connection_id"] != "notebooklm":
        # A provider label, not an account identity or proof of remote access.
        raise InvalidInputError("NOTEBOOKLM_LINK_INVALID")
    target = value.get("remote_notebook_id")
    if not isinstance(target, str) or not target.strip():
        raise InvalidInputError("NOTEBOOKLM_LINK_INVALID")
    return value


def _active(value: dict[str, Any]) -> bool:
    # Strict identity checks: null, 0 and strings must not become live booleans.
    for marker in ("requires_rebind", "restored_history"):
        if marker in value and value[marker] is not False:
            return False
    if "replay_allowed" in value and value["replay_allowed"] is not True:
        return False
    return not any(
        value.get(field) in ("restored_archive", "restored_history")
        for field in ("origin", "verification_origin")
    )


async def read_notebooklm_link(
    store: _LinkReader, notebook_id: str
) -> dict[str, Any] | None:
    """Read only the canonical and notebook-key legacy identities; never history.

    Structural corruption fails closed even on an inactive exact-key row.
    Inactive canonical data blocks legacy resurrection. An active canonical link
    wins only if legacy data is inactive or names the same target. No rows are
    migrated, deleted, reverified or otherwise changed by this projection.
    """
    link_id = notebooklm_link_id(notebook_id)
    # Raw envelopes distinguish an absent row from a corrupt payload:null.
    # This is a bounded exact-identity batch, not a scan of restored links.
    rows = await store.get_many("link", [link_id, notebook_id])
    canonical_row, legacy_row = rows[link_id], rows[notebook_id]
    canonical = (
        _validate(canonical_row.get("payload"), notebook_id, link_id, canonical=True)
        if canonical_row is not None
        else None
    )
    legacy = (
        _validate(legacy_row.get("payload"), notebook_id, link_id, canonical=False)
        if legacy_row is not None
        else None
    )
    if canonical is None:
        return legacy if legacy is not None and _active(legacy) else None
    if not _active(canonical):
        return None
    if (
        legacy is not None
        and _active(legacy)
        and legacy["remote_notebook_id"] != canonical["remote_notebook_id"]
    ):
        raise InvalidInputError("NOTEBOOKLM_LINK_CONFLICT")
    return canonical
