import importlib
from pathlib import Path

import httpx
import pytest

from open_notebook.integrations.notebooklm.contracts import BridgeError


def downloader():
    module = importlib.import_module(
        "open_notebook.integrations.notebooklm.sdk_adapter"
    )
    function = getattr(module, "download_signed_asset", None)
    assert function, "Bounded verified-identity audio downloader is not implemented"
    return function


@pytest.mark.asyncio
async def test_download_bounds_stream_and_uses_real_mime(tmp_path):
    audio = b"ID3" + b"\x00" * 64
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200, content=audio, headers={"content-type": "audio/mpeg"}
            )
        )
    ) as client:
        result = await downloader()(
            "https://usercontent.googleusercontent.com/file",
            tmp_path / "asset",
            100,
            client,
        )
    assert result.byte_size == len(audio)
    assert result.mime_type == "audio/mpeg"
    assert Path(result.path).suffix == ".mp3"
    assert Path(result.path).read_bytes() == audio


@pytest.mark.asyncio
async def test_download_rejects_private_redirect_and_leaves_no_file(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                302, headers={"location": "http://127.0.0.1/private"}
            )
        )
    ) as client:
        with pytest.raises(BridgeError):
            await downloader()(
                "https://usercontent.googleusercontent.com/file",
                tmp_path / "asset",
                100,
                client,
            )
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
async def test_oversized_and_non_audio_content_are_not_committed(tmp_path):
    for payload in (b"ID3" + b"x" * 100, b"<html>Not audio</html>"):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda req: httpx.Response(
                    200, content=payload, headers={"content-type": "audio/mpeg"}
                )
            )
        ) as client:
            with pytest.raises(BridgeError):
                await downloader()(
                    "https://usercontent.googleusercontent.com/file",
                    tmp_path / "asset",
                    80,
                    client,
                )
        assert not list(tmp_path.iterdir())
