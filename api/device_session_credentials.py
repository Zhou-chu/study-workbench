"""Strict startup configuration; file reads are bounded and off the event loop."""

import asyncio
import os
import stat
from collections.abc import Mapping

from api.device_session_models import AuthError

MAX_PASSWORD_BYTES = 4096


class StrictPasswordProvider:
    def __init__(
        self, *, password: str | None = None, password_file: str | None = None
    ):
        self._password = password
        # None means absent. Even a configured empty path must fail closed.
        self._password_file = password_file

    @classmethod
    def from_environment(
        cls, environment: Mapping[str, str]
    ) -> "StrictPasswordProvider":
        return cls(
            password=environment.get("OPEN_NOTEBOOK_PASSWORD"),
            password_file=environment.get("OPEN_NOTEBOOK_PASSWORD_FILE"),
        )

    def _read_file(self) -> str:
        assert self._password_file is not None  # read() selects the file branch.
        fd = os.open(self._password_file, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError("not regular")
            with os.fdopen(fd, "rb", closefd=False) as handle:
                value = handle.read(MAX_PASSWORD_BYTES + 1)
            if len(value) > MAX_PASSWORD_BYTES:
                raise ValueError("too large")
            return value.decode("utf-8").strip()
        finally:
            os.close(fd)

    async def read(self) -> str:
        try:
            value = (
                await asyncio.to_thread(self._read_file)
                if self._password_file is not None
                else self._password
            )
            if not value or len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
                raise ValueError("unavailable")
            return value
        except Exception:
            raise AuthError("AUTH_UNAVAILABLE") from None
