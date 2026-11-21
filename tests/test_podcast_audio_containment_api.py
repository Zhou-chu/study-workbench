"""Actual podcast list, stream and deletion HTTP tests over disposable files."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.config import PODCASTS_FOLDER
from open_notebook.podcasts.models import PodcastEpisode


def make_episode(audio_file=None, **overrides):
    defaults = dict(
        id="episode:test123",
        name="Test Episode",
        episode_profile={"name": "default"},
        speaker_profile={"name": "default"},
        briefing="test briefing",
        content="test content",
        audio_file=audio_file,
        command=None,
    )
    defaults.update(overrides)
    return PodcastEpisode(**defaults)


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestStreamEndpointRejectsInvalidAudio:
    def test_returns_403_for_legacy_absolute_audio_file(self, client, tmp_path):
        evil_file = tmp_path / "secret.mp3"
        evil_file.write_bytes(b"not a podcast")
        episode = make_episode(audio_file=str(evil_file))

        with patch(
            "api.routers.podcasts.PodcastService.get_episode",
            new=AsyncMock(return_value=episode),
        ):
            response = client.get("/api/podcasts/episodes/episode:test123/audio")

        assert response.status_code == 403

    def test_returns_403_for_relative_traversal(self, client):
        episode = make_episode(audio_file="../../etc/passwd")

        with patch(
            "api.routers.podcasts.PodcastService.get_episode",
            new=AsyncMock(return_value=episode),
        ):
            response = client.get("/api/podcasts/episodes/episode:test123/audio")

        assert response.status_code == 403

    def test_returns_404_for_missing_audio_inside_root(self, client):
        # Valid relative form (passes containment) but the file doesn't exist.
        episode = make_episode(audio_file="episodes/does-not-exist/out.mp3")

        with patch(
            "api.routers.podcasts.PodcastService.get_episode",
            new=AsyncMock(return_value=episode),
        ):
            response = client.get("/api/podcasts/episodes/episode:test123/audio")

        assert response.status_code == 404
        assert "not found on disk" in response.json()["detail"]

    def test_serves_audio_file_from_relative_path(self, client):
        episode_dir = Path(PODCASTS_FOLDER) / "episodes" / "test-serve-uuid"
        episode_dir.mkdir(parents=True, exist_ok=True)
        audio_path = episode_dir / "out.mp3"
        audio_path.write_bytes(b"fake mp3 bytes")
        try:
            episode = make_episode(audio_file="episodes/test-serve-uuid/out.mp3")
            with patch(
                "api.routers.podcasts.PodcastService.get_episode",
                new=AsyncMock(return_value=episode),
            ):
                response = client.get("/api/podcasts/episodes/episode:test123/audio")

            assert response.status_code == 200
            assert response.content == b"fake mp3 bytes"
        finally:
            audio_path.unlink(missing_ok=True)
            episode_dir.rmdir()


class TestListAndGetOmitAudioUrlWhenInvalid:
    def test_list_episodes_omits_audio_url_for_legacy_absolute_file(
        self, client, tmp_path
    ):
        evil_file = tmp_path / "secret.mp3"
        evil_file.write_bytes(b"not yours")
        episode = make_episode(audio_file=str(evil_file))

        with (
            patch(
                "api.routers.podcasts.PodcastService.list_episodes",
                new=AsyncMock(return_value=[episode]),
            ),
        ):
            response = client.get("/api/podcasts/episodes")

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["audio_url"] is None

    def test_list_episodes_sets_audio_url_for_valid_relative_file(self, client):
        episode_dir = Path(PODCASTS_FOLDER) / "episodes" / "test-list-uuid"
        episode_dir.mkdir(parents=True, exist_ok=True)
        audio_path = episode_dir / "out.mp3"
        audio_path.write_bytes(b"fake mp3 bytes")
        try:
            episode = make_episode(audio_file="episodes/test-list-uuid/out.mp3")
            with patch(
                "api.routers.podcasts.PodcastService.list_episodes",
                new=AsyncMock(return_value=[episode]),
            ):
                response = client.get("/api/podcasts/episodes")

            assert response.status_code == 200
            body = response.json()
            assert body[0]["audio_url"] == (
                "/api/podcasts/episodes/episode:test123/audio"
            )
        finally:
            audio_path.unlink(missing_ok=True)
            episode_dir.rmdir()

    def test_get_episode_omits_audio_url_for_legacy_absolute_file(
        self, client, tmp_path
    ):
        evil_file = tmp_path / "secret.mp3"
        evil_file.write_bytes(b"not yours")
        episode = make_episode(audio_file=str(evil_file))

        with patch(
            "api.routers.podcasts.PodcastService.get_episode",
            new=AsyncMock(return_value=episode),
        ):
            response = client.get("/api/podcasts/episodes/episode:test123")

        assert response.status_code == 200
        assert response.json()["audio_url"] is None


class TestDeleteAndRetryRefuseInvalidUnlink:
    def test_delete_episode_does_not_unlink_legacy_absolute_file(
        self, client, tmp_path
    ):
        evil_file = tmp_path / "secret.mp3"
        evil_file.write_bytes(b"not yours")
        episode = make_episode(audio_file=str(evil_file))

        with (
            patch(
                "api.routers.podcasts.PodcastService.get_episode",
                new=AsyncMock(return_value=episode),
            ),
            patch.object(PodcastEpisode, "delete", new=AsyncMock(return_value=True)),
        ):
            response = client.delete("/api/podcasts/episodes/episode:test123")

        assert response.status_code == 200
        assert evil_file.exists(), "out-of-root file must not be deleted"

    def test_delete_episode_unlinks_relative_in_root_file(self, client):
        episode_dir = Path(PODCASTS_FOLDER) / "episodes" / "test-delete-uuid"
        episode_dir.mkdir(parents=True, exist_ok=True)
        audio_path = episode_dir / "out.mp3"
        audio_path.write_bytes(b"fake mp3 bytes")
        episode = make_episode(audio_file="episodes/test-delete-uuid/out.mp3")

        try:
            with (
                patch(
                    "api.routers.podcasts.PodcastService.get_episode",
                    new=AsyncMock(return_value=episode),
                ),
                patch.object(
                    PodcastEpisode, "delete", new=AsyncMock(return_value=True)
                ),
            ):
                response = client.delete("/api/podcasts/episodes/episode:test123")

            assert response.status_code == 200
            assert not audio_path.exists(), "in-root file should be deleted"
        finally:
            if episode_dir.exists():
                for f in episode_dir.iterdir():
                    f.unlink()
                episode_dir.rmdir()
