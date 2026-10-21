"""Pinned SDK behavior mapped through public namespaces, without any network."""

from contextlib import asynccontextmanager
from types import SimpleNamespace as NS

import pytest

from open_notebook.integrations.notebooklm.contracts import (
    AudioRequest,
    BridgeAskRequest,
    BridgeError,
    CreateNotebookRequest,
    FetchTextRequest,
    UploadSourceRequest,
)
from open_notebook.integrations.notebooklm.sdk_adapter import (
    SDKNotebookLMBridge,
    sdk_client,
)


def make_bridge(tmp_path, client):
    path = tmp_path / "storage.json"
    path.write_text("{}")

    @asynccontextmanager
    async def factory(path):
        yield client

    return SDKNotebookLMBridge(path, factory)


@pytest.mark.asyncio
async def test_pinned_config_disables_hidden_mutation_retries(monkeypatch, tmp_path):
    from notebooklm import NotebookLMClient

    @asynccontextmanager
    async def construct(**kwargs):
        config = kwargs["config"]
        assert config.backend.kind == "web"
        assert config.retry.rate_limit_max_retries == 0
        assert config.retry.server_error_max_retries == 0
        yield "client"

    monkeypatch.setattr(NotebookLMClient, "from_storage", construct)
    async with sdk_client(tmp_path / "storage.json") as client:
        assert client == "client"


@pytest.mark.asyncio
async def test_lists_are_paged_but_not_falsely_complete(tmp_path):
    async def notebooks():
        return [NS(id=str(i), title=f"Book {i}") for i in range(57)]

    bridge = make_bridge(tmp_path, NS(notebooks=NS(list=notebooks)))
    first = await bridge.list_notebooks()
    second = await bridge.list_notebooks(first.next_cursor)
    assert len(first.items) == 50
    assert len(second.items) == 7
    assert second.next_cursor is None
    assert second.listing_complete is False
    assert "recent" in second.completeness_note.lower()


@pytest.mark.asyncio
async def test_strict_source_list_preserves_ready_status(tmp_path):
    async def sources(notebook_id, *, strict):
        assert strict is True
        assert notebook_id == "nb"
        return [NS(id="a", title="A", status=2, is_ready=True, revision_id="r1")]

    bridge = make_bridge(tmp_path, NS(sources=NS(list=sources)))
    page = await bridge.list_sources("nb")
    assert page.items[0].status == "ready"
    assert page.items[0].original_available is False


@pytest.mark.asyncio
async def test_chat_blocks_before_network_when_isolation_unverified(tmp_path):
    bridge = make_bridge(tmp_path, NS())
    with pytest.raises(BridgeError, match="isolation") as caught:
        await bridge.ask(
            BridgeAskRequest(
                remote_notebook_id="nb",
                message="q",
                remote_source_ids=["b"],
                scope_hash="b",
            )
        )
    assert caught.value.code == "SCOPE_ISOLATION_UNAVAILABLE"


@pytest.mark.asyncio
async def test_sdk_creation_and_upload_ids_are_preserved(tmp_path):
    async def create(title):
        assert title == "Explicit"
        return NS(id="new-nb")

    async def upload(nb, path, *, mime_type, title, wait):
        assert (nb, mime_type, title, wait) == ("nb", "text/plain", "File", False)
        return NS(id="new-source", is_ready=False)

    bridge = make_bridge(
        tmp_path, NS(notebooks=NS(create=create), sources=NS(add_file=upload))
    )
    assert (
        await bridge.create_notebook(CreateNotebookRequest(title="Explicit"))
    ).remote_id == "new-nb"
    result = await bridge.upload_source(
        UploadSourceRequest(
            remote_notebook_id="nb",
            source_version_id="sv",
            file_path="/trusted/file",
            mime_type="text/plain",
            title="File",
        )
    )
    assert result.remote_id == "new-source"
    assert result.status == "processing"


@pytest.mark.asyncio
async def test_submission_timeout_is_unknown_not_retryable(tmp_path):
    async def create(title):
        raise TimeoutError("potential credential-containing message must not escape")

    bridge = make_bridge(tmp_path, NS(notebooks=NS(create=create)))
    with pytest.raises(BridgeError) as caught:
        await bridge.create_notebook(CreateNotebookRequest(title="Title"))
    assert caught.value.submission_state == "unknown"
    assert "credential" not in str(caught.value)


@pytest.mark.asyncio
async def test_audio_has_exact_nonempty_scope_and_single_poll(tmp_path):
    async def generate(nb, *, source_ids, language):
        assert (nb, source_ids, language) == ("nb", ["selected"], "zh")
        return NS(task_id="audio-1", status="pending")

    async def poll(nb, task):
        assert (nb, task) == ("nb", "audio-1")
        return NS(task_id=task, status="in_progress")

    bridge = make_bridge(
        tmp_path, NS(artifacts=NS(generate_audio=generate, poll_status=poll))
    )
    result = await bridge.generate_audio(
        AudioRequest(remote_notebook_id="nb", remote_source_ids=["selected"])
    )
    assert result.remote_id == "audio-1"
    artifact = await bridge.get_artifact("nb", result.remote_id)
    assert artifact.status == "processing"


@pytest.mark.asyncio
async def test_fulltext_is_not_original_backup(tmp_path):
    async def fulltext(nb, source, *, output_format):
        assert output_format == "text"
        return NS(source_id=source, title="Extracted", content="真实原文")

    bridge = make_bridge(tmp_path, NS(sources=NS(get_fulltext=fulltext)))
    result = await bridge.fetch_source_text(
        FetchTextRequest(remote_notebook_id="nb", remote_source_id="a")
    )
    assert result.content == "真实原文"
    assert result.original_status == "missing"


@pytest.mark.asyncio
@pytest.mark.parametrize("loss", ["expired", "missing", "read_error"])
async def test_capabilities_do_not_reuse_verified_availability_after_connection_loss(
    tmp_path, loss
):
    failure: Exception | None = None

    async def notebooks():
        if failure is not None:
            raise failure
        return []

    bridge = make_bridge(tmp_path, NS(notebooks=NS(list=notebooks)))
    assert (await bridge.verify_connection()).state == "connected"
    before = {c.name: c for c in (await bridge.capabilities()).operations}
    assert before["list_notebooks"].support == "available"

    if loss == "missing":
        bridge.storage_path.unlink()
    elif loss == "expired":
        failure = BridgeError("NEEDS_REAUTH", "Expired")
    else:
        failure = TimeoutError("Unavailable")
    await bridge.verify_connection()

    after = {c.name: c for c in (await bridge.capabilities()).operations}
    assert after["list_notebooks"].support == "temporarily_unavailable"
    assert after["list_notebooks"].reason == bridge.connection_status().reason
    assert (
        after["list_notebooks"].last_verified_at
        == before["list_notebooks"].last_verified_at
    )
    assert after["ask"].support == "unsupported"
    assert "SCOPE_ISOLATION_UNAVAILABLE" in after["ask"].reason

    failure = None
    bridge.storage_path.write_text("{}")
    assert (await bridge.verify_connection()).state == "connected"
    restored = {c.name: c for c in (await bridge.capabilities()).operations}
    assert restored["list_notebooks"].support == "available"
    assert restored["ask"].support == "unsupported"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_kind", ["timeout", "schema_shape", "schema_item"])
async def test_failed_direct_read_revokes_current_availability(tmp_path, failure_kind):
    failed = False

    async def notebooks():
        if not failed:
            return [NS(id="nb", title="Notebook")]
        if failure_kind == "timeout":
            raise TimeoutError("private remote detail")
        if failure_kind == "schema_shape":
            return {"unexpected": "response"}
        return [NS(title="missing identity")]

    bridge = make_bridge(tmp_path, NS(notebooks=NS(list=notebooks)))
    await bridge.verify_connection()
    verified_at = (await bridge.capabilities()).operations[0].last_verified_at
    failed = True
    with pytest.raises(BridgeError):
        await bridge.list_notebooks()
    status = bridge.connection_status()
    assert status.state == "unavailable"
    assert status.reason == (
        "REMOTE_UNAVAILABLE" if failure_kind == "timeout" else "REMOTE_SCHEMA_CHANGED"
    )
    caps = {c.name: c for c in (await bridge.capabilities()).operations}
    assert caps["list_notebooks"].support == "temporarily_unavailable"
    assert caps["list_notebooks"].last_verified_at == verified_at
    assert caps["ask"].support == "unsupported"
    failed = False
    await bridge.verify_connection()
    assert (await bridge.capabilities()).operations[0].support == "available"


@pytest.mark.asyncio
async def test_replaced_profile_does_not_restore_historical_capabilities(tmp_path):
    async def notebooks():
        return []

    bridge = make_bridge(tmp_path, NS(notebooks=NS(list=notebooks)))
    await bridge.verify_connection()
    bridge.storage_path.unlink()
    await bridge.verify_connection()
    bridge.storage_path.write_text("{}")
    caps = {c.name: c for c in (await bridge.capabilities()).operations}
    assert caps["list_notebooks"].support == "temporarily_unavailable"
    assert caps["list_notebooks"].reason == "PROFILE_MISSING"
    await bridge.verify_connection()
    assert (await bridge.capabilities()).operations[0].support == "available"


@pytest.mark.asyncio
async def test_fresh_worker_profile_is_unverified_not_known_unavailable(tmp_path):
    # A new worker has no local observation; the service owns durable connection
    # admission. Do not turn the default disconnected state into a known failure.
    bridge = make_bridge(tmp_path, NS())
    caps = {c.name: c for c in (await bridge.capabilities()).operations}
    assert caps["generate_audio"].support == "unverified"
    assert caps["generate_audio"].last_verified_at is None


@pytest.mark.asyncio
async def test_audio_quota_does_not_revoke_authenticated_read_capability(tmp_path):
    async def notebooks():
        return []

    from notebooklm.exceptions import RateLimitError

    async def generate(*args, **kwargs):
        raise RateLimitError("private remote quota detail", retry_after=60)

    bridge = make_bridge(
        tmp_path,
        NS(notebooks=NS(list=notebooks), artifacts=NS(generate_audio=generate)),
    )
    await bridge.verify_connection()
    with pytest.raises(BridgeError) as caught:
        await bridge.generate_audio(
            AudioRequest(remote_notebook_id="nb", remote_source_ids=["a"])
        )
    assert caught.value.code == "QUOTA_LIMIT"
    assert bridge.connection_status().state == "connected"
    caps = {c.name: c for c in (await bridge.capabilities()).operations}
    assert caps["list_notebooks"].support == "available"
    assert (await bridge.list_notebooks()).items == []
