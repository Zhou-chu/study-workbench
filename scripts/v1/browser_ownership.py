"""Exclusive Linux child custody for trusted local acceptance, not a sandbox."""

import ctypes
import os
import signal
import threading
import time
from pathlib import Path


def _subreaper(value=None):
    libc = ctypes.CDLL(None, use_errno=True)
    if value is None:
        result = ctypes.c_int()
        status = libc.prctl(37, ctypes.byref(result), 0, 0, 0)
        value = result.value
    else:
        status = libc.prctl(36, int(value), 0, 0, 0)
    if status != 0:
        raise OSError(ctypes.get_errno(), "Child custody unavailable")
    return value


def _children():
    # Some kernels omit task/*/children. Read only process identity metadata;
    # never infer custody from name/group. pidfd waitid validates actual children.
    result = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
        except (FileNotFoundError, ProcessLookupError):
            continue
        if int(fields[1]) == os.getpid():
            result.append(int(entry.name))
    return result


def _empty():
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError:
        return True
    return False


class BrowserSubreaper:
    """Caller must be the only child creator/reaper until successful exit.

    Registered leaders must be stopped/reaped first. Remaining adopted children
    are signalled only through retained pidfds, never discovered by process name.
    """

    def __init__(self, *, grace=1.0, timeout=15.0):
        self.grace = grace
        self.timeout = timeout
        self.entered = False

    def __enter__(self):
        if (
            threading.active_count() != 1
            or len(list(Path("/proc/self/task").iterdir())) != 1
        ):
            raise RuntimeError("Child custody requires a single thread")
        if (
            signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL
            or _subreaper()
            or not _empty()
        ):
            raise RuntimeError("Child custody requires exclusive empty ownership")
        _subreaper(True)
        self.entered = True
        return self

    def __exit__(self, *exc_info):
        if not self.entered:
            return
        deadline = time.monotonic() + self.timeout
        pinned = {}
        try:
            while not _empty():
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        "Owned descendant cleanup uncertain; custody retained"
                    )
                for pid in _children():
                    if pid in pinned:
                        continue
                    fd = os.pidfd_open(pid)
                    try:
                        fields = (
                            Path(f"/proc/{pid}/stat")
                            .read_text()
                            .rsplit(")", 1)[1]
                            .split()
                        )
                        if int(fields[1]) != os.getpid():
                            raise RuntimeError("Descendant ownership changed")
                        os.waitid(os.P_PIDFD, fd, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                        signal.pidfd_send_signal(fd, signal.SIGTERM)
                        pinned[pid] = (fd, time.monotonic(), False)
                    except BaseException:
                        os.close(fd)
                        raise
                for pid, (fd, started, killed) in list(pinned.items()):
                    state = os.waitid(
                        os.P_PIDFD, fd, os.WEXITED | os.WNOHANG | os.WNOWAIT
                    )
                    if state is not None:
                        os.waitid(os.P_PIDFD, fd, os.WEXITED)
                        os.close(fd)
                        del pinned[pid]
                    elif not killed and time.monotonic() - started >= self.grace:
                        signal.pidfd_send_signal(fd, signal.SIGKILL)
                        pinned[pid] = (fd, started, True)
                time.sleep(0.01)
            _subreaper(False)
            self.entered = False
        finally:
            for fd, started, killed in pinned.values():
                os.close(fd)
