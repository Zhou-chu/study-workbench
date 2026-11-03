"""Lock order: note mutation barrier, sorted project locks, DB transaction.
Export/read takes project locks only. Never reacquire a held lock.
"""

import asyncio
import fcntl
import hashlib
import os
from contextlib import asynccontextmanager
from pathlib import Path


def data_root() -> Path:
    return Path(os.getenv("STUDY_WORKBENCH_DATA_DIR", "data/personal")).resolve()


@asynccontextmanager
async def _project_lock(notebook_id: str, root: Path | None, *, wait: bool):
    folder = (root or data_root()) / ".locks"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (hashlib.sha256(notebook_id.encode()).hexdigest() + ".lock")
    handle = path.open("a+b")
    # Never offload flock to a thread: cancellation must not leak ownership.
    acquired = False
    try:
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                if not wait:
                    yield False
                    return
                await asyncio.sleep(0.01)
        yield True
    finally:
        if acquired:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


@asynccontextmanager
async def project_lock(notebook_id: str, root: Path | None = None):
    async with _project_lock(notebook_id, root, wait=True):
        yield


@asynccontextmanager
async def try_project_lock(notebook_id: str, root: Path | None = None):
    """Probe/acquire the SAME shared lock without waiting for its live owner.

    Holding the returned ownership through reconciliation prevents a new run
    from racing the interrupted-state update. Requires one shared data root;
    this is not a distributed lease or proof about independent filesystems.
    """
    async with _project_lock(notebook_id, root, wait=False) as acquired:
        yield acquired


def note_mutation_lock(root: Path | None = None):
    return project_lock("__note_mutation_barrier__", root)
