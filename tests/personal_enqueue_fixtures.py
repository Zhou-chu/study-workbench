"""Non-collected synthetic fixtures shared by isolated and integration cases."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy


class MemoryStore:
    """Local-only store double with independent snapshots and real exclusion."""

    def __init__(self):
        self.data = {}
        self.writes = []
        self.locks = {}
        self.lock_waiting = asyncio.Event()

    async def get(self, kind, identity):
        return deepcopy(self.data.get((kind, identity)))

    async def put(self, kind, identity, value, create_only=False):
        key = (kind, identity)
        if create_only and key in self.data:
            raise ValueError("Record already exists")
        self.data[key] = deepcopy(value)
        self.writes.append((key, deepcopy(value), create_only))
        return deepcopy(value)

    async def delete(self, kind, identity):
        self.data.pop((kind, identity), None)

    @asynccontextmanager
    async def project_lock(self, notebook_id):
        lock = self.locks.setdefault(notebook_id, asyncio.Lock())
        if lock.locked():
            self.lock_waiting.set()
        async with lock:
            yield
