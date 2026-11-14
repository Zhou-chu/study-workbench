"""Direct service failure and truncation units; API cases remain separate."""

from unittest.mock import AsyncMock, patch

import pytest

SECRET = "connection to db-primary-7f3a.internal:5432 refused: password authentication failed"


class TestPodcastServiceDoesNotLeakExceptionText:
    @pytest.mark.asyncio
    async def test_get_job_status_failure_returns_generic_message(self):
        from fastapi import HTTPException

        from api.podcast_service import PodcastService

        with patch(
            "api.podcast_service.get_command_status",
            new=AsyncMock(side_effect=RuntimeError(SECRET)),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await PodcastService.get_job_status("command:abc123")

        assert exc_info.value.status_code == 500
        assert SECRET not in exc_info.value.detail
        assert exc_info.value.detail == "Failed to get job status"

    @pytest.mark.asyncio
    async def test_list_episodes_failure_returns_generic_message(self):
        from fastapi import HTTPException

        from api.podcast_service import PodcastService
        from open_notebook.podcasts.models import PodcastEpisode

        with patch.object(
            PodcastEpisode,
            "get_all",
            new=AsyncMock(side_effect=RuntimeError(SECRET)),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await PodcastService.list_episodes()

        assert exc_info.value.status_code == 500
        assert SECRET not in exc_info.value.detail
        assert exc_info.value.detail == "Failed to list episodes"

    @pytest.mark.asyncio
    async def test_get_episode_failure_returns_generic_not_found(self):
        from fastapi import HTTPException

        from api.podcast_service import PodcastService
        from open_notebook.podcasts.models import PodcastEpisode

        with patch.object(
            PodcastEpisode, "get", new=AsyncMock(side_effect=RuntimeError(SECRET))
        ):
            with pytest.raises(HTTPException) as exc_info:
                await PodcastService.get_episode("episode:missing")

        assert exc_info.value.status_code == 404
        assert SECRET not in exc_info.value.detail
        assert exc_info.value.detail == "Episode not found"

    @pytest.mark.asyncio
    async def test_submit_generation_job_failure_returns_generic_message(self):
        from fastapi import HTTPException

        from api.podcast_service import PodcastService

        with patch(
            "api.podcast_service.EpisodeProfile.get_by_name",
            new=AsyncMock(side_effect=RuntimeError(SECRET)),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await PodcastService.submit_generation_job(
                    episode_profile_name="default",
                    speaker_profile_name="default",
                    episode_name="Test Episode",
                    content="some content",
                )

        assert exc_info.value.status_code == 500
        assert SECRET not in exc_info.value.detail
        assert exc_info.value.detail == "Failed to submit podcast generation job"


class TestTruncateErrorHelper:
    """`_truncate_error` caps client-facing error text surfaced by the source
    status and sync-processing paths (#1136)."""

    def test_none_passes_through(self):
        from api.routers.sources import _truncate_error

        assert _truncate_error(None) is None

    def test_empty_string_passes_through(self):
        from api.routers.sources import _truncate_error

        assert _truncate_error("") == ""

    def test_short_message_unchanged(self):
        from api.routers.sources import _truncate_error

        assert _truncate_error("boom") == "boom"

    def test_message_at_limit_unchanged(self):
        from api.routers.sources import _truncate_error

        msg = "x" * 200
        assert _truncate_error(msg) == msg

    def test_long_message_truncated_with_ellipsis(self):
        from api.routers.sources import _truncate_error

        result = _truncate_error(SECRET + "x" * 500)
        assert result is not None
        # capped at limit + the single-character ellipsis
        assert len(result) == 201
        assert result.endswith("…")
        assert result.startswith(SECRET[:50])

    def test_custom_limit(self):
        from api.routers.sources import _truncate_error

        assert _truncate_error("abcdefghij", limit=4) == "abcd…"
