"""Direct podcast speaker resolution, schema and dispatch with external I/O doubled."""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from podcast_speaker_profile_fixtures import make_episode_profile, make_input

from commands.podcast_commands import (
    PodcastGenerationInput,
    generate_podcast_command,
)
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile


class TestSpeakerProfileResolution:
    @pytest.mark.asyncio
    async def test_provided_speaker_profile_wins_over_episode_config(self):
        """An explicitly provided speaker_profile is resolved, not the
        episode profile's speaker_config."""
        episode_profile = make_episode_profile(
            speaker_config="speaker_profile:old_speaker"
        )
        speaker_resolve = AsyncMock(return_value=None)

        with (
            patch.object(
                EpisodeProfile,
                "get_by_name",
                new=AsyncMock(return_value=episode_profile),
            ),
            patch.object(SpeakerProfile, "resolve", new=speaker_resolve),
        ):
            with pytest.raises(
                ValueError, match="Speaker profile 'new-name' not found"
            ):
                await generate_podcast_command(make_input(speaker_profile="new-name"))

        speaker_resolve.assert_awaited_once_with("new-name")

    @pytest.mark.asyncio
    async def test_falls_back_to_episode_speaker_config_when_omitted(self):
        """Without an explicit speaker_profile, the episode profile's
        speaker_config (a record ID) is used."""
        episode_profile = make_episode_profile(
            speaker_config="speaker_profile:old_speaker"
        )
        speaker_resolve = AsyncMock(return_value=None)

        with (
            patch.object(
                EpisodeProfile,
                "get_by_name",
                new=AsyncMock(return_value=episode_profile),
            ),
            patch.object(SpeakerProfile, "resolve", new=speaker_resolve),
        ):
            with pytest.raises(
                ValueError,
                match="references a speaker profile that no longer exists",
            ):
                await generate_podcast_command(make_input(speaker_profile=None))

        speaker_resolve.assert_awaited_once_with("speaker_profile:old_speaker")

    @pytest.mark.asyncio
    async def test_orphaned_speaker_config_fails_with_clear_error(self):
        """An episode profile whose speaker reference was orphaned by
        migration 20 (speaker_config is None) fails with a clear message
        instead of trying to resolve None."""
        episode_profile = make_episode_profile(speaker_config=None)
        speaker_resolve = AsyncMock(return_value=None)

        with (
            patch.object(
                EpisodeProfile,
                "get_by_name",
                new=AsyncMock(return_value=episode_profile),
            ),
            patch.object(SpeakerProfile, "resolve", new=speaker_resolve),
        ):
            with pytest.raises(ValueError, match="has no speaker profile configured"):
                await generate_podcast_command(make_input(speaker_profile=None))

        speaker_resolve.assert_not_awaited()

    def test_speaker_profile_is_optional_on_input_model(self):
        """The command contract allows omitting speaker_profile entirely."""
        input_data = PodcastGenerationInput(
            episode_profile="Test Episode Profile",
            episode_name="Test Episode",
            content="test content",
        )
        assert input_data.speaker_profile is None


class TestSpeakerProfileResolve:
    """SpeakerProfile.resolve dispatches record IDs to a direct lookup and
    anything else to the name lookup."""

    @pytest.mark.asyncio
    async def test_resolve_by_record_id_queries_by_id(self):
        with patch(
            "open_notebook.podcasts.models.repo_query", new_callable=AsyncMock
        ) as mock_query:
            mock_query.return_value = [
                {
                    "id": "speaker_profile:abc",
                    "name": "Tech Experts",
                    "speakers": [
                        {
                            "name": "Alex",
                            "voice_id": "v1",
                            "backstory": "b",
                            "personality": "p",
                        }
                    ],
                }
            ]
            profile = await SpeakerProfile.resolve("speaker_profile:abc")

        assert profile is not None
        assert profile.name == "Tech Experts"
        assert mock_query.await_args is not None
        query, params = mock_query.await_args.args
        assert "FROM $id" in query
        assert str(params["id"]) == "speaker_profile:abc"

    @pytest.mark.asyncio
    async def test_resolve_by_record_id_returns_none_when_missing(self):
        with patch(
            "open_notebook.podcasts.models.repo_query", new_callable=AsyncMock
        ) as mock_query:
            mock_query.return_value = []
            profile = await SpeakerProfile.resolve("speaker_profile:gone")

        assert profile is None

    @pytest.mark.asyncio
    async def test_resolve_by_name_delegates_to_get_by_name(self):
        with patch.object(
            SpeakerProfile, "get_by_name", new_callable=AsyncMock
        ) as mock_get_by_name:
            mock_get_by_name.return_value = None
            profile = await SpeakerProfile.resolve("Tech Experts")

        assert profile is None
        mock_get_by_name.assert_awaited_once_with("Tech Experts")


class TestApiBoundaryResolvesNameToRecordId:
    """PodcastService.submit_generation_job accepts the speaker profile by
    NAME (the public API contract) and submits the command with the resolved
    record ID."""

    @pytest.mark.asyncio
    async def test_submit_passes_record_id_to_command(self):
        from api.podcast_service import PodcastService

        episode_profile = Mock()
        episode_profile.name = "Deep Dive"
        speaker_profile = Mock()
        speaker_profile.id = "speaker_profile:abc"
        speaker_profile.name = "Tech Experts"

        with (
            patch(
                "api.podcast_service.EpisodeProfile.get_by_name",
                new=AsyncMock(return_value=episode_profile),
            ),
            patch(
                "api.podcast_service.SpeakerProfile.resolve",
                new=AsyncMock(return_value=speaker_profile),
            ) as mock_resolve,
            patch("api.podcast_service.submit_command") as mock_submit,
        ):
            mock_submit.return_value = "command:job1"
            job_id = await PodcastService.submit_generation_job(
                episode_profile_name="Deep Dive",
                speaker_profile_name="Tech Experts",
                episode_name="Episode 1",
                content="some content",
            )

        assert job_id == "command:job1"
        mock_resolve.assert_awaited_once_with("Tech Experts")
        command_args = mock_submit.call_args.args[2]
        assert command_args["speaker_profile"] == "speaker_profile:abc"
