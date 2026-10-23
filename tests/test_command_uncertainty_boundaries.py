"""Public queue boundaries report uncertainty, never fabricated success."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from api.main import command_submission_unknown_handler
from api.routers import commands, embedding, podcasts, sources
from open_notebook.domain.notebook import Note, Source
from open_notebook.exceptions import CommandSubmissionUnknownError


@pytest.fixture
def app():
    app = FastAPI()
    app.exception_handler(CommandSubmissionUnknownError)(
        command_submission_unknown_handler
    )
    for router in [commands.router, embedding.router, podcasts.router, sources.router]:
        app.include_router(router, prefix="/api")
    return app


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boundary",
    ["generic", "embed_async", "embed_source", "embed_note", "podcast", "insight"],
)
async def test_unknown_boundary_returns_safe_structured_conflict(
    app, monkeypatch, boundary
):
    error = CommandSubmissionUnknownError()
    submit = AsyncMock(side_effect=error)
    expected_resource = None
    if boundary == "generic":
        monkeypatch.setattr(commands.CommandService, "submit_command_job", submit)
        url, body = (
            "/api/commands/jobs",
            {"app": "open_notebook", "command": "fixture", "input": {}},
        )
    elif boundary.startswith("embed"):
        monkeypatch.setattr(
            embedding.model_manager,
            "get_embedding_model",
            AsyncMock(return_value=object()),
        )
        item_type = "note" if boundary == "embed_note" else "source"
        expected_resource = (item_type, item_type + ":fixture")
        if boundary == "embed_async":
            monkeypatch.setattr(embedding.CommandService, "submit_command_job", submit)
        else:
            item = (
                Note(id="note:fixture", content="body")
                if item_type == "note"
                else Source(id="source:fixture", full_text="body")
            )
            monkeypatch.setattr(
                Note if item_type == "note" else Source,
                "get",
                AsyncMock(return_value=item),
            )
            monkeypatch.setattr("open_notebook.domain.notebook.submit_command", submit)
        url, body = (
            "/api/embed",
            {
                "item_id": expected_resource[1],
                "item_type": item_type,
                "async_processing": boundary == "embed_async",
            },
        )
    elif boundary == "podcast":
        # Exercise the service catch/rethrow too, not just a router mock.
        monkeypatch.setattr(
            "api.podcast_service.EpisodeProfile.get_by_name",
            AsyncMock(return_value=object()),
        )
        monkeypatch.setattr(
            "api.podcast_service.SpeakerProfile.resolve",
            AsyncMock(return_value=SimpleNamespace(id="speaker:fixture")),
        )
        monkeypatch.setattr("api.podcast_service.submit_command", submit)
        url, body = (
            "/api/podcasts/generate",
            {
                "episode_profile": "fixture",
                "speaker_profile": "fixture",
                "episode_name": "fixture",
                "content": "body",
            },
        )
    else:
        monkeypatch.setattr(
            sources.Source,
            "get",
            AsyncMock(return_value=Source(id="source:fixture", full_text="body")),
        )
        monkeypatch.setattr(
            sources.Transformation, "get", AsyncMock(return_value=object())
        )
        monkeypatch.setattr(sources, "submit_command", submit)
        url, body = (
            "/api/sources/source:fixture/insights",
            {"transformation_id": "transformation:fixture"},
        )
        expected_resource = ("source", "source:fixture")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://fixture"
    ) as client:
        response = await client.post(url, json=body)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "COMMAND_SUBMISSION_UNKNOWN"
    assert detail["retry_safe"] is False
    assert "job_id" not in detail and "command_id" not in detail
    if expected_resource:
        assert (detail["resource_type"], detail["resource_id"]) == expected_resource
    else:
        assert "resource_id" not in detail
    submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_automatic_note_embedding_still_preserves_saved_content(monkeypatch):
    from open_notebook.database.note_repository import NoteWriteResult

    note = Note(id="note:fixture", content="body")
    commit = AsyncMock(
        return_value=NoteWriteResult(
            native={"id": note.id, "content": "body", "revision": 2}, snapshot=None
        )
    )
    monkeypatch.setattr("open_notebook.database.note_repository.update_note", commit)
    submit = AsyncMock(side_effect=CommandSubmissionUnknownError())
    monkeypatch.setattr("open_notebook.domain.notebook.submit_command", submit)
    assert await note.save() is None
    assert note.content == "body" and note.revision == 2
    commit.assert_awaited_once()
    submit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "unknown", "failure"])
async def test_podcast_retry_never_deletes_previous_episode_or_audio(
    app, monkeypatch, tmp_path, outcome
):
    from unittest.mock import Mock

    audio = tmp_path / "original.wav"
    audio.write_bytes(b"prior audio")
    episode = SimpleNamespace(
        episode_profile={"name": "fixture"},
        speaker_profile={"name": "fixture"},
        name="prior",
        content="body",
        audio_file=str(audio),
        get_job_detail=AsyncMock(return_value={"status": "failed"}),
        delete=AsyncMock(),
    )
    monkeypatch.setattr(
        podcasts.PodcastService, "get_episode", AsyncMock(return_value=episode)
    )
    unlink = Mock(side_effect=lambda *args: audio.unlink())
    monkeypatch.setattr(podcasts, "_delete_episode_audio", unlink)
    submit = AsyncMock(return_value="command:replacement")
    if outcome != "success":
        submit.side_effect = (
            CommandSubmissionUnknownError()
            if outcome == "unknown"
            else ConnectionError("known failure")
        )
    monkeypatch.setattr(podcasts.PodcastService, "submit_generation_job", submit)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://fixture"
    ) as client:
        response = await client.post("/api/podcasts/episodes/episode:prior/retry")
    assert (
        response.status_code
        == {"success": 200, "unknown": 409, "failure": 500}[outcome]
    )
    if outcome == "unknown":
        assert response.json()["detail"]["resource_id"] == "episode:prior"
        assert response.json()["detail"]["resource_type"] == "podcast_episode"
        assert "job_id" not in response.json()["detail"]
    episode.delete.assert_not_awaited()
    unlink.assert_not_called()
    assert audio.read_bytes() == b"prior audio"
    submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_source_creation_uncertainty_response_contains_existing_identity(
    app, monkeypatch
):
    from unittest.mock import Mock

    error = CommandSubmissionUnknownError(source_id="source:retained")
    monkeypatch.setattr(
        sources, "_build_content_state", AsyncMock(return_value={"content": "body"})
    )
    monkeypatch.setattr(
        sources, "_create_source_async_path", AsyncMock(side_effect=error)
    )
    cleanup = Mock()
    monkeypatch.setattr(sources, "_cleanup_uploaded_file", cleanup)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://fixture"
    ) as client:
        response = await client.post(
            "/api/sources/json",
            json={
                "type": "text",
                "content": "body",
                "notebooks": [],
                "async_processing": True,
            },
        )
    assert response.status_code == 409
    assert response.json()["detail"]["resource_id"] == "source:retained"
    assert response.json()["detail"]["resource_type"] == "source"
    assert response.json()["detail"]["retry_safe"] is False
    cleanup.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("visible_id", ["source:retained", None])
@pytest.mark.parametrize("async_processing", [True, False])
async def test_initial_source_save_ack_loss_has_safe_http_contract(
    app, monkeypatch, visible_id, async_processing
):
    async def save_then_lose_ack(source):
        source.id = visible_id
        raise ConnectionError("private database acknowledgement failure")

    monkeypatch.setattr(Source, "save", save_then_lose_ack)
    submit = AsyncMock()
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://fixture"
    ) as client:
        response = await client.post(
            "/api/sources/json",
            json={
                "type": "text",
                "content": "retained draft",
                "async_processing": async_processing,
            },
        )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "COMMAND_SUBMISSION_UNKNOWN"
    assert detail["retry_safe"] is False
    assert "command_id" not in detail and "job_id" not in detail
    if visible_id:
        assert detail["resource_id"] == visible_id
        assert detail["resource_type"] == "source"
    else:
        assert "resource_id" not in detail and "resource_type" not in detail
    assert "private" not in response.text
    submit.assert_not_awaited()
