"""Real password-file and thread boundary contracts, not unit coverage."""

import pytest
from device_session_core_fixtures import error, setup

from api.device_session_credentials import StrictPasswordProvider


@pytest.mark.asyncio
async def test_strict_file_change_failure_recovery_barrier(tmp_path):
    path = tmp_path / "test-password"
    path.write_text(" synthetic\n")
    provider = StrictPasswordProvider(password="fallback", password_file=str(path))
    svc, store, _ = setup(provider)
    a = await svc.create_session("synthetic", "a")
    path.unlink()
    await error("AUTH_UNAVAILABLE", svc.authenticate_access(a.access_token))
    await error("AUTH_UNAVAILABLE", svc.create_session("fallback", "a"))
    path.write_text("synthetic")
    await error("AUTH_REQUIRED", svc.authenticate_access(a.access_token))
    b = await svc.create_session("synthetic", "b")
    path.write_text("changed")
    store.fail = True
    await error("AUTH_UNAVAILABLE", svc.authenticate_access(b.access_token))
    store.fail = False
    c = await svc.create_session("changed", "c")
    assert c.session_id != b.session_id
    await error("AUTH_REQUIRED", svc.authenticate_access(b.access_token))


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [b"", b" \n", b"\xff", b"x" * 4097])
async def test_file_invalid_never_falls_back(tmp_path, content):
    path = tmp_path / "test-password"
    path.write_bytes(content)
    provider = StrictPasswordProvider(password="fallback", password_file=str(path))
    await error("AUTH_UNAVAILABLE", provider.read())


@pytest.mark.asyncio
async def test_file_read_off_event_loop_and_environment_snapshot(tmp_path):
    import threading

    class ThreadCheckedProvider(StrictPasswordProvider):
        def _read_file(self):
            assert threading.current_thread() is not threading.main_thread()
            return super()._read_file()

    path = tmp_path / "synthetic-secret"
    path.write_text(" temporary\n")
    assert await ThreadCheckedProvider(password_file=str(path)).read() == "temporary"
    environment = {"OPEN_NOTEBOOK_PASSWORD": "original"}
    provider = StrictPasswordProvider.from_environment(environment)
    environment["OPEN_NOTEBOOK_PASSWORD"] = "changed"
    assert await provider.read() == "original"
    await error(
        "AUTH_UNAVAILABLE",
        StrictPasswordProvider(password="fallback", password_file="").read(),
    )
    await error(
        "AUTH_UNAVAILABLE", StrictPasswordProvider(password_file=str(tmp_path)).read()
    )


@pytest.mark.asyncio
async def test_same_mtime_content_change_invalidates_and_failed_barrier_retries(
    tmp_path,
):
    import os

    path = tmp_path / "synthetic-secret"
    path.write_text("original")
    svc, store, _ = setup(StrictPasswordProvider(password_file=str(path)))
    first = await svc.create_session("original", "one")
    old_stat = path.stat()
    path.write_text("modified")
    os.utime(path, ns=(old_stat.st_atime_ns, old_stat.st_mtime_ns))
    store.fail = True
    await error("AUTH_UNAVAILABLE", svc.create_session("modified", "two"))
    await error("AUTH_UNAVAILABLE", svc.create_session("modified", "two"))
    store.fail = False
    await svc.create_session("modified", "two")
    assert store.sessions[first.session_id].revoked_at is not None
    await error("AUTH_REQUIRED", svc.authenticate_access(first.access_token))
