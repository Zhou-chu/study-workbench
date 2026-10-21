import asyncio
import importlib

import pytest
from v1_notebooklm_helpers import FakeBridge, MemoryStore

from open_notebook.integrations.notebooklm.contracts import BridgeError


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
async def test_same_idempotency_key_returns_original_and_conflicts_on_different_request():
    app = service()
    first = await app.create_job("notebook:local", "audio", request(), "same")
    second = await app.create_job("notebook:local", "audio", request(), "same")
    assert first["job_id"] == second["job_id"]
    with pytest.raises(BridgeError) as caught:
        await app.create_job("notebook:local", "audio", request(language="en"), "same")
    assert caught.value.code == "IDEMPOTENCY_CONFLICT"


@pytest.mark.asyncio
async def test_audio_persists_id_releases_slot_and_polls_original_only():
    bridge = FakeBridge()
    app = service(bridge=bridge)
    audio = await app.create_job("notebook:local", "audio", request(), "audio")
    result = await app.run_job(audio["job_id"])
    assert result["state"] == "waiting_remote"
    assert result["submission_state"] == "confirmed"
    assert result["remote_task_id"] == "audio-1"
    assert result["next_poll_at"]
    create = await app.create_job(
        "notebook:other", "create_notebook", {"title": "Other"}, "other"
    )
    assert (await asyncio.wait_for(app.run_job(create["job_id"]), 1))[
        "state"
    ] == "succeeded"
    restarted = service(store=app.store, bridge=bridge)
    await restarted.poll_job(audio["job_id"])
    await restarted.poll_job(audio["job_id"])
    assert bridge.audio_calls == 1
    assert bridge.polls == 2


@pytest.mark.asyncio
async def test_lost_response_is_unknown_and_never_automatically_replayed():
    bridge = FakeBridge()
    bridge.error = BridgeError(
        "REMOTE_UNAVAILABLE", "Lost response", submission_state="unknown"
    )
    app = service(bridge=bridge)
    job = await app.create_job("notebook:local", "audio", request(), "lost")
    result = await app.run_job(job["job_id"])
    assert result["state"] == "submission_unknown"
    bridge.error = None
    restarted = service(store=app.store, bridge=bridge)
    for _ in range(3):
        assert (await restarted.run_job(job["job_id"]))["state"] == "submission_unknown"
    assert bridge.audio_calls == 1


@pytest.mark.asyncio
async def test_worker_crash_after_intent_marks_unknown_on_recovery():
    app = service()
    job = await app.create_job("notebook:local", "audio", request(), "crash")
    job.update(
        state="running",
        submission_state="unknown",
        lease_until="2000-01-01T00:00:00+00:00",
    )
    await app.store.put("job", job["job_id"], job)
    result = await app.run_job(job["job_id"])
    assert result["state"] == "submission_unknown"
    assert app.bridge.audio_calls == 0


@pytest.mark.asyncio
async def test_concurrent_worker_delivery_does_not_duplicate_remote_submission():
    app = service()
    job = await app.create_job("notebook:local", "audio", request(), "concurrent")
    await asyncio.gather(app.run_job(job["job_id"]), app.run_job(job["job_id"]))
    assert app.bridge.audio_calls == 1


@pytest.mark.asyncio
async def test_cancel_explains_remote_may_continue_and_does_not_poll():
    app = service()
    job = await app.create_job("notebook:local", "audio", request(), "cancel")
    await app.run_job(job["job_id"])
    cancelled = await app.cancel_job(job["job_id"])
    assert cancelled["state"] == "cancelled_local"
    assert cancelled["remote_may_continue"] is True
    await app.poll_job(job["job_id"])
    assert app.bridge.polls == 0


@pytest.mark.asyncio
async def test_empty_or_unknown_source_scope_cannot_generate():
    app = service()
    with pytest.raises(BridgeError):
        await app.create_job(
            "notebook:local", "audio", request(remote_source_ids=[]), "empty"
        )
    job = await app.create_job(
        "notebook:local", "audio", request(remote_source_ids=["foreign"]), "foreign"
    )
    result = await app.run_job(job["job_id"])
    assert result["state"] == "failed"
    assert result["submission_state"] == "not_submitted"
    assert app.bridge.audio_calls == 0


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


@pytest.mark.asyncio
async def test_unsupported_audio_capability_blocks_before_submission():
    from open_notebook.integrations.notebooklm.contracts import (
        Capability,
        CapabilityMatrix,
    )

    class Unsupported(FakeBridge):
        async def capabilities(self):
            return CapabilityMatrix(
                operations=[Capability(name="generate_audio", support="unsupported")]
            )

    app = service(bridge=Unsupported())
    job = await app.create_job("notebook:local", "audio", request(), "unsupported")
    result = await app.run_job(job["job_id"])
    assert result["state"] == "failed"
    assert app.bridge.audio_calls == 0


@pytest.mark.asyncio
async def test_cancel_before_remote_submission_prevents_generation():
    started, proceed = asyncio.Event(), asyncio.Event()

    class WaitingBridge(FakeBridge):
        async def verify_connection(self):
            started.set()
            await proceed.wait()
            return await super().verify_connection()

    app = service(bridge=WaitingBridge())
    job = await app.create_job("notebook:local", "audio", request(), "cancel-before")
    task = asyncio.create_task(app.run_job(job["job_id"]))
    await started.wait()
    await app.cancel_job(job["job_id"])
    proceed.set()
    result = await task
    assert result["state"] == "cancelled_local"
    assert app.bridge.audio_calls == 0


@pytest.mark.asyncio
async def test_restored_historical_job_cannot_be_dispatched():
    enqueued = []

    async def enqueue(identity, poll=False):
        enqueued.append(identity)
        return "worker"

    app = service()
    job = await app.create_job("notebook:local", "audio", request(), "restored")
    job.update(replay_allowed=False, restored_history=True)
    await app.store.put("job", job["job_id"], job)
    app.enqueue = enqueue
    await app.dispatch_due_jobs()
    assert not enqueued
    assert (await app.run_job(job["job_id"]))["attempts"] == 0


@pytest.mark.asyncio
async def test_account_slot_also_serializes_short_read_calls():
    active, max_active = 0, 0

    class ReadBridge(FakeBridge):
        async def list_sources(self, remote_notebook_id, cursor=None):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.01)
            active -= 1
            return await super().list_sources(remote_notebook_id, cursor)

    store, bridge = MemoryStore(), ReadBridge()
    first, second = (
        service(store=store, bridge=bridge),
        service(store=store, bridge=bridge),
    )
    await asyncio.gather(first.all_sources("nb"), second.all_sources("nb"))
    assert max_active == 1


@pytest.mark.asyncio
async def test_remote_id_is_durable_before_account_slot_is_released():
    store, bridge = MemoryStore(), FakeBridge()
    app = service(store=store, bridge=bridge)
    job = await app.create_job("notebook:local", "audio", request(), "persist-first")
    result = await app._write(job, lambda: bridge.generate_audio(None))
    assert result.remote_id == "audio-1"
    saved = await app.job(job["job_id"])
    assert saved["remote_task_id"] == "audio-1"
    assert saved["submission_state"] == "confirmed"


@pytest.mark.asyncio
async def test_successful_capability_evidence_survives_worker_instance():
    app = service()
    job = await app.create_job("notebook:local", "audio", request(), "capability")
    await app.run_job(job["job_id"])
    restarted = service(store=app.store)
    matrix = await restarted.capabilities()
    audio = next(c for c in matrix.operations if c.name == "generate_audio")
    assert audio.last_verified_at
    assert audio.support == "available"
