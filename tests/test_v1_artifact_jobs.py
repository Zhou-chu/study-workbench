import importlib

import pytest
from v1_notebooklm_helpers import FakeBridge, MemoryStore


def service(store=None, bridge=None, **kwargs):
    try:
        cls = importlib.import_module("api.notebooklm_service").NotebookLMService
    except ModuleNotFoundError:
        pytest.fail("Durable NotebookLM jobs not implemented")
    return cls(
        store=store or MemoryStore(),
        bridge=bridge or FakeBridge(),
        enqueue=None,
        **kwargs,
    )


def request(**changes):
    return {
        "remote_notebook_id": "remote",
        "remote_source_ids": ["a"],
        "language": "zh",
        **changes,
    }


@pytest.mark.asyncio
async def test_audio_completion_downloads_verified_asset_without_generating_again(
    tmp_path,
):
    import hashlib
    from pathlib import Path

    from open_notebook.integrations.notebooklm.contracts import DownloadedAsset

    class DownloadBridge(FakeBridge):
        async def download_artifact(self, request):
            assert request.remote_artifact_id == "audio-1"
            path = Path(request.output_path).with_suffix(".mp3")
            path.parent.mkdir(parents=True, exist_ok=True)
            body = b"ID3real audio fixture"
            path.write_bytes(body)
            return DownloadedAsset(
                path=str(path),
                mime_type="audio/mpeg",
                byte_size=len(body),
                sha256=hashlib.sha256(body).hexdigest(),
            )

    bridge = DownloadBridge()
    bridge.artifact_status = "ready"
    app = service(bridge=bridge, data_root=tmp_path)
    job = await app.create_job("notebook:local", "audio", request(), "download-ready")
    await app.run_job(job["job_id"])
    done = await app.poll_job(job["job_id"])
    assert done["state"] == "succeeded"
    assert done["result"]["downloaded"] is True
    asset = done["result"]["artifact"]
    assert asset["file_path"].endswith(".mp3")
    assert (tmp_path / asset["file_path"]).exists()
    assert bridge.audio_calls == 1
