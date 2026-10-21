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
async def project_lock(notebook_id: str, root: Path | None = None):
    folder = (root or data_root()) / ".locks"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (hashlib.sha256(notebook_id.encode()).hexdigest() + ".lock")
    handle = path.open("a+b")
    # A polling nonblocking lock avoids leaking a lock held by a cancelled
    # to_thread operation. No remote call or worker wait lives inside this lock.
    try:
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                await asyncio.sleep(0.01)
        yield
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def note_mutation_lock(root: Path | None = None):
    return project_lock("__note_mutation_barrier__", root)
