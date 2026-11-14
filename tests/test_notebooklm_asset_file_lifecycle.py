import asyncio
import threading
from pathlib import Path

import httpx
import pytest

from open_notebook.integrations.notebooklm.sdk_adapter import download_signed_asset


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_count", [0, 1, 2])
async def test_blocked_write_runs_off_loop_and_is_drained_before_cleanup(
    monkeypatch, tmp_path, cancel_count
):
    loop_thread = threading.get_ident()
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    original_open = Path.open
    handles = []

    class HeldFile:
        def __init__(self, handle):
            self.handle = handle
            handles.append(handle)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.handle.close()

        def write(self, chunk):
            assert threading.get_ident() != loop_thread, "file write blocked event loop"
            entered.set()
            assert release.wait(3), "test did not release blocked write"
            result = self.handle.write(chunk)
            finished.set()
            return result

        def __getattr__(self, name):
            return getattr(self.handle, name)

    def open_file(path, *args, **kwargs):
        handle = original_open(path, *args, **kwargs)
        return HeldFile(handle) if ".partial-" in path.name else handle

    monkeypatch.setattr(Path, "open", open_file)
    audio = b"ID3" + b"x" * 64
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, content=audio, headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        task = asyncio.create_task(
            download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100,
                client,
            )
        )
        try:
            # If the old synchronous code already failed, surface its exact assertion.
            for _ in range(100):
                if entered.is_set() or task.done():
                    break
                await asyncio.sleep(0.01)
            if task.done():
                await task
            assert entered.is_set()
            for _ in range(cancel_count):
                task.cancel()
                await asyncio.sleep(0)
            assert not task.done()
            assert not finished.is_set()
            release.set()
            if cancel_count:
                with pytest.raises(asyncio.CancelledError):
                    await task
                assert list(tmp_path.iterdir()) == []
            else:
                result = await task
                assert Path(result.path).read_bytes() == audio
            assert finished.is_set()
            assert handles and all(handle.closed for handle in handles)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["open", "finish", "cleanup"])
async def test_cancellation_drains_open_flush_and_cleanup(monkeypatch, tmp_path, stage):
    from open_notebook.integrations.notebooklm import sdk_adapter

    entered, release = threading.Event(), threading.Event()
    original = getattr(sdk_adapter._AssetFile, stage)
    owned = []

    def held(owner):
        owned.append(owner)
        # Open before blocking proves the cancelled open still closes its handle.
        if stage == "open":
            original(owner)
        entered.set()
        assert release.wait(3)
        if stage != "open":
            original(owner)

    monkeypatch.setattr(sdk_adapter._AssetFile, stage, held)
    # Invalid MIME reaches cleanup without committing a target.
    content_type = "text/plain" if stage == "cleanup" else "audio/mpeg"
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, content=b"ID3audio", headers={"content-type": content_type}
            )
        )
    ) as client:
        task = asyncio.create_task(
            download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100,
                client,
            )
        )
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            task.cancel()
            await asyncio.sleep(0)
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert list(tmp_path.iterdir()) == []
            assert owned and all(owner.handle is None for owner in owned)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("existing", [None, b"ID3audio", b"ID3different"])
async def test_commit_preserves_identity_and_cleans_partial_files(tmp_path, existing):
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    target = tmp_path / "asset.mp3"
    if existing is not None:
        target.write_bytes(existing)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, content=b"ID3audio", headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        call = download_signed_asset(
            "https://usercontent.googleusercontent.com/file",
            tmp_path / "asset",
            100,
            client,
        )
        if existing == b"ID3different":
            with pytest.raises(BridgeError, match="different bytes"):
                await call
            assert target.read_bytes() == existing
        else:
            result = await call
            assert result.path == str(target)
            assert target.read_bytes() == b"ID3audio"
    assert list(tmp_path.iterdir()) == [target]


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["open", "write", "finish", "commit"])
async def test_disk_errors_propagate_without_orphan_files(monkeypatch, tmp_path, stage):
    from open_notebook.integrations.notebooklm import sdk_adapter

    def fail(*args):
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(sdk_adapter._AssetFile, stage, fail)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, content=b"ID3audio", headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        with pytest.raises(OSError, match="synthetic disk failure"):
            await download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100,
                client,
            )
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403])
async def test_download_auth_failure_has_no_retry_or_credential_fallback(
    tmp_path, status
):
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    requests = []

    def response(request):
        requests.append(request)
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        return httpx.Response(status)

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(BridgeError) as error:
            await download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100,
                client,
            )
    assert error.value.code == "ARTIFACT_DOWNLOAD_UNAVAILABLE"
    assert len(requests) == 1
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_streamed_size_limit_without_length_header_cleans_partial(tmp_path):
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    class Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"ID3" + b"x" * 65533
            yield b"x" * 65536

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, stream=Chunks(), headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        with pytest.raises(BridgeError) as error:
            await download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                65536,
                client,
            )
    assert error.value.code == "ARTIFACT_TOO_LARGE"
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_cancel_during_network_stream_closes_file_and_response(tmp_path):
    waiting, closed = asyncio.Event(), asyncio.Event()

    class Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"ID3" + b"x" * 65533
            waiting.set()
            await asyncio.Event().wait()

        async def aclose(self):
            closed.set()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, stream=Chunks(), headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        task = asyncio.create_task(
            download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100000,
                client,
            )
        )
        try:
            await asyncio.wait_for(waiting.wait(), 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert closed.is_set()
            assert list(tmp_path.iterdir()) == []
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_cancel_at_commit_leaves_only_complete_valid_asset(monkeypatch, tmp_path):
    from open_notebook.integrations.notebooklm import sdk_adapter

    committed, release = threading.Event(), threading.Event()
    original = sdk_adapter._AssetFile.commit

    def held(owner, target, expected_sha):
        original(owner, target, expected_sha)
        committed.set()
        assert release.wait(3)

    monkeypatch.setattr(sdk_adapter._AssetFile, "commit", held)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, content=b"ID3audio", headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        task = asyncio.create_task(
            download_signed_asset(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100,
                client,
            )
        )
        try:
            assert await asyncio.to_thread(committed.wait, 2)
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            target = tmp_path / "asset.mp3"
            assert target.read_bytes() == b"ID3audio"
            assert list(tmp_path.iterdir()) == [target]
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
