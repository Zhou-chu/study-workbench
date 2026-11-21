"""In-memory persistence boundary for personal service tests."""

from contextlib import asynccontextmanager
from copy import deepcopy


class MemoryStore:
    def __init__(self):
        self.data = {}

    async def get(self, k, i):
        return deepcopy(self.data.get((k, i)))

    async def get_many(self, kind, identities):
        return {
            identity: {"payload": deepcopy(self.data[(kind, identity)])}
            if (kind, identity) in self.data
            else None
            for identity in identities
        }

    async def put(self, k, i, v, create_only=False):
        self.data[k, i] = deepcopy(v)
        return v

    async def list(self, k, notebook_id=None, **kw):
        if notebook_id is not None:
            kw["notebook_id"] = notebook_id
        return [
            deepcopy(v)
            for (kind, _), v in self.data.items()
            if kind == k and all(v.get(a) == b for a, b in kw.items())
        ]

    @asynccontextmanager
    async def project_lock(self, i):
        yield
