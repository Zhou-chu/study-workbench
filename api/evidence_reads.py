"""Explicit, read-only reuse for a single evidence-detail response.

This is not a transaction or atomic snapshot. Each identity intentionally reuses
its first read, even if a concurrent writer changes it during the request. The
context must never be retained by a service or used for mutation workflows.
Query size is bounded; total response/context memory still scales with evidence.
"""

from copy import deepcopy

from api.personal_store import record_key


class EvidenceReadContext:
    def __init__(self, store):
        self.store = store
        self._rows = {}

    async def get(self, kind, identity):
        # Validate before hashing the cache key, matching scalar store errors for
        # unhashable, empty, overlong, or otherwise invalid identities.
        record_key(kind, identity)
        key = (kind, identity)
        if key not in self._rows:
            self._rows[key] = {
                "payload": deepcopy(await self.store.get(kind, identity))
            }
        row = self._rows[key]
        return deepcopy(row["payload"]) if row is not None else None

    async def prefetch(self, kind, identities):
        pending: dict[str, None] = {}
        for identity in identities:
            try:
                record_key(kind, identity)
            except ValueError:
                # Consume the valid prefix first; a prior missing record must
                # still win over this malformed ID at its original position.
                break
            if (kind, identity) not in self._rows:
                pending[identity] = None
        if pending:
            rows = await self.store.get_many(kind, list(pending))
            self._rows.update(((kind, identity), row) for identity, row in rows.items())
