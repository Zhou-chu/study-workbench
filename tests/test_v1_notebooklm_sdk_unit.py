"""NotebookLM bridge contracts with SDK context and filesystem replaced."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from open_notebook.integrations.notebooklm.contracts import (
    AudioRequest,
    BridgeError,
    CreateNotebookRequest,
    FetchTextRequest,
    UploadSourceRequest,
)
from open_notebook.integrations.notebooklm.sdk_adapter import (
    SDKNotebookLMBridge,
    _asset_file_operation,
    sdk_client,
)


@pytest.mark.asyncio
async def test_pinned_config_disables_hidden_mutation_retries(monkeypatch):
    from notebooklm import NotebookLMClient

    @asynccontextmanager
    async def construct(**kwargs):
        config = kwargs["config"]
        assert config.backend.kind == "web"
        assert config.retry.rate_limit_max_retries == 0
        assert config.retry.server_error_max_retries == 0
        yield "client"

    monkeypatch.setattr(NotebookLMClient, "from_storage", construct)
    async with sdk_client(Path("unused-synthetic-storage.json")) as client:
        assert client == "client"


@pytest.mark.asyncio
async def test_asset_file_cancel_drains_worker_and_preserves_initial_reason(
    monkeypatch,
):
    entered = asyncio.Event()
    release = asyncio.Event()
    finished = asyncio.Event()

    async def fake_disk(operation, *args):
        entered.set()
        await release.wait()
        try:
            operation(*args)
        finally:
            finished.set()

    def write():
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(asyncio, "to_thread", fake_disk)
    task = asyncio.create_task(_asset_file_operation(write))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel("download cancelled")
        await asyncio.sleep(0)
        task.cancel("additional cancellation during drain")
        await asyncio.sleep(0)
        assert not task.done()
        assert not finished.is_set()
        release.set()
        with pytest.raises(asyncio.CancelledError, match="^download cancelled$"):
            await asyncio.wait_for(task, 1)
        assert finished.is_set()
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)


@pytest.fixture
def sdk_boundary():
    profile = Mock(spec=Path)
    profile.parent = Mock(spec=Path)
    profile.is_file.return_value = True
    profile.is_symlink.return_value = False
    profile.parent.is_symlink.return_value = False
    notebooks = SimpleNamespace(list=AsyncMock(), create=AsyncMock())
    sources = SimpleNamespace(
        list=AsyncMock(), add_file=AsyncMock(), get_fulltext=AsyncMock()
    )
    artifacts = SimpleNamespace(
        list=AsyncMock(), poll_status=AsyncMock(), generate_audio=AsyncMock()
    )
    client = SimpleNamespace(notebooks=notebooks, sources=sources, artifacts=artifacts)
    activity = []

    @asynccontextmanager
    async def factory(path):
        assert path is profile
        activity.append("open")
        try:
            yield client
        finally:
            activity.append("close")

    return SDKNotebookLMBridge(profile, factory), profile, client, activity


@pytest.mark.asyncio
async def test_connection_proof_and_notebook_pagination_keep_distinct_completeness(
    sdk_boundary,
):
    bridge, profile, client, activity = sdk_boundary
    client.notebooks.list.return_value = [
        SimpleNamespace(id=f"n-{n}", title=f"Notebook {n}") for n in range(51)
    ]

    verified = await bridge.verify_connection()
    first = await bridge.list_notebooks()
    second = await bridge.list_notebooks(first.next_cursor)
    assert verified.state == "connected"
    assert verified.last_verified_at
    assert len(first.items) == 50 and first.next_cursor == "50"
    assert [(row.id, row.title) for row in second.items] == [("n-50", "Notebook 50")]
    assert second.next_cursor is None and not second.listing_complete
    assert "recently viewed" in second.completeness_note
    capabilities = {x.name: x for x in (await bridge.capabilities()).operations}
    assert capabilities["list_notebooks"].support == "available"
    assert capabilities["list_notebooks"].last_verified_at
    assert capabilities["list_sources"].support == "unverified"
    assert capabilities["ask"].support == "unsupported"
    assert activity == ["open", "close"] * 3
    profile.chmod.assert_called_with(0o600)
    profile.parent.chmod.assert_called_with(0o700)


@pytest.mark.asyncio
async def test_missing_profile_is_not_opened_and_disconnect_clears_verification(
    sdk_boundary,
):
    bridge, profile, client, activity = sdk_boundary
    client.notebooks.list.return_value = [SimpleNamespace(id="n")]
    assert (await bridge.verify_connection()).state == "connected"
    profile.is_file.return_value = False
    assert (await bridge.verify_connection()).reason == "PROFILE_MISSING"
    capabilities = {x.name: x for x in (await bridge.capabilities()).operations}
    assert capabilities["list_notebooks"].support == "temporarily_unavailable"
    assert capabilities["list_notebooks"].last_verified_at
    assert (await bridge.disconnect()).state == "disconnected"
    capabilities = {x.name: x for x in (await bridge.capabilities()).operations}
    assert capabilities["list_notebooks"].last_verified_at is None
    assert activity == ["open", "close"]
    profile.unlink.assert_called_once_with(missing_ok=True)


@pytest.mark.asyncio
async def test_source_listing_and_text_contracts_preserve_identity_and_status(
    sdk_boundary,
):
    bridge, _, client, activity = sdk_boundary
    client.sources.list.return_value = [
        SimpleNamespace(id="s-1", title=None, is_ready=False),
        SimpleNamespace(id="s-2", title="Notes", is_ready=True, revision_id="r-1"),
    ]
    client.sources.get_fulltext.return_value = SimpleNamespace(
        source_id="s-2", title="Notes", content="First paragraph."
    )
    listed = await bridge.list_sources("n-1")
    fetched = await bridge.fetch_source_text(
        FetchTextRequest(remote_notebook_id="n-1", remote_source_id="s-2")
    )
    assert listed.listing_complete and listed.next_cursor is None
    assert [(r.id, r.title, r.status, r.revision_id) for r in listed.items] == [
        ("s-1", "Untitled source", "processing", None),
        ("s-2", "Notes", "ready", "r-1"),
    ]
    assert (fetched.remote_source_id, fetched.content, fetched.original_status) == (
        "s-2",
        "First paragraph.",
        "missing",
    )
    client.sources.list.assert_awaited_once_with("n-1", strict=True)
    client.sources.get_fulltext.assert_awaited_once_with(
        "n-1", "s-2", output_format="text"
    )
    assert activity == ["open", "close"] * 2


@pytest.mark.asyncio
async def test_sdk_submissions_mapping_and_unknown_artifact_status(sdk_boundary):
    bridge, _, client, _ = sdk_boundary
    client.notebooks.create.return_value = SimpleNamespace(id="n-1")
    client.sources.add_file.return_value = SimpleNamespace(id="s-1", is_ready=False)
    client.artifacts.generate_audio.return_value = SimpleNamespace(
        task_id="a-1", status="queued"
    )
    client.artifacts.list.return_value = [
        SimpleNamespace(
            id="a-1",
            title="Summary",
            kind=SimpleNamespace(value="audio"),
            status_str="completed",
            source_ids=("s-1",),
        ),
    ]
    client.artifacts.poll_status.return_value = SimpleNamespace(status="unfamiliar")
    made = await bridge.create_notebook(CreateNotebookRequest(title="Study notes"))
    uploaded = await bridge.upload_source(
        UploadSourceRequest(
            remote_notebook_id="n-1",
            source_version_id="v-1",
            file_path="unused.txt",
            mime_type="text/plain",
            title="Notes",
        )
    )
    generated = await bridge.generate_audio(
        AudioRequest(remote_notebook_id="n-1", remote_source_ids=["s-1"], language="zh")
    )
    [listed] = await bridge.list_artifacts("n-1")
    polled = await bridge.get_artifact("n-1", "a-1")
    assert [(x.remote_id, x.status) for x in (made, uploaded, generated)] == [
        ("n-1", "ready"),
        ("s-1", "processing"),
        ("a-1", "processing"),
    ]
    assert (listed.title, listed.status, listed.remote_source_ids) == (
        "Summary",
        "ready",
        ["s-1"],
    )
    assert (polled.id, polled.status) == ("a-1", "unknown")
    client.notebooks.create.assert_awaited_once_with("Study notes")
    client.sources.add_file.assert_awaited_once_with(
        "n-1", "unused.txt", mime_type="text/plain", title="Notes", wait=False
    )
    client.artifacts.generate_audio.assert_awaited_once_with(
        "n-1", source_ids=["s-1"], language="zh"
    )


@pytest.mark.asyncio
async def test_invalid_cursor_and_remote_schema_remain_distinct(sdk_boundary):
    bridge, _, client, _ = sdk_boundary
    client.notebooks.list.return_value = []
    with pytest.raises(BridgeError) as bad_cursor:
        await bridge.list_notebooks("-1")
    assert bad_cursor.value.code == "INVALID_CURSOR"
    client.sources.list.return_value = [SimpleNamespace(id="s")]
    with pytest.raises(BridgeError) as bad_schema:
        await bridge.list_sources("n-1")
    assert bad_schema.value.code == "REMOTE_SCHEMA_CHANGED"
    assert bridge.connection_status().state == "unavailable"


@pytest.mark.asyncio
async def test_unconfirmed_remote_mutation_fails_safe_and_is_not_retried(sdk_boundary):
    bridge, _, client, activity = sdk_boundary
    client.notebooks.create.side_effect = TimeoutError("synthetic service failure")
    with pytest.raises(BridgeError) as failure:
        await bridge.create_notebook(CreateNotebookRequest(title="Draft"))
    assert failure.value.code == "REMOTE_UNAVAILABLE"
    assert failure.value.submission_state == "unknown"
    assert "synthetic service failure" not in str(failure.value)
    assert bridge.connection_status().reason == "REMOTE_UNAVAILABLE"
    client.notebooks.create.assert_awaited_once_with("Draft")
    assert activity == ["open", "close"]
