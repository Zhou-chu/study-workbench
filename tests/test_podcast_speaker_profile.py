"""
Regression tests for issues #1044 and #630.

#1044: generate_podcast_command must honor the speaker_profile parameter
instead of always re-deriving the speaker from episode_profile.speaker_config.

#630: episode_profile.speaker_config references the speaker profile by
record ID (migration 20) instead of by name, so renaming a speaker profile
no longer breaks episode profiles. The command resolves either form via
SpeakerProfile.resolve, and the API boundary (PodcastService) resolves the
user-facing name to a record ID before submitting the job.

No database is available in tests: profile lookups are mocked. Command tests
let the command fail at a deterministic early exit (speaker not found) so the
assertion is purely about WHICH speaker profile reference was resolved.
"""

from unittest.mock import AsyncMock, patch

import pytest
from podcast_speaker_profile_fixtures import make_input

from commands.podcast_commands import (
    generate_podcast_command,
)
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile


class TestOrphanedProfileDoesNotPoisonConfig:
    """One orphaned episode profile (speaker_config=None after migration 20)
    must not fail podcast-creator's validation of the whole episode config,
    and the profile dicts handed to podcast-creator must carry speaker NAMES
    (its contract), not record IDs."""

    @pytest.mark.asyncio
    async def test_orphan_dropped_and_ids_rewritten_to_names(self, tmp_path):
        episode_profile = EpisodeProfile(
            id="episode_profile:ep1",
            name="Test Episode Profile",
            speaker_config="speaker_profile:sp1",
            outline_llm="model:llm",
            transcript_llm="model:llm",
            default_briefing="brief",
            num_segments=3,
        )
        speaker_profile = SpeakerProfile(
            id="speaker_profile:sp1",
            name="Tech Experts",
            voice_model="model:tts",
            speakers=[
                {
                    "name": "Alex",
                    "voice_id": "v1",
                    "backstory": "b",
                    "personality": "p",
                }
            ],
        )

        episode_rows = [
            {
                "id": "episode_profile:ep1",
                "name": "Test Episode Profile",
                "speaker_config": "speaker_profile:sp1",
                "default_briefing": "brief",
                "num_segments": 3,
            },
            {
                # Orphaned by migration 20: referenced speaker no longer exists
                "id": "episode_profile:ep2",
                "name": "Orphaned Profile",
                "speaker_config": None,
                "default_briefing": "brief",
                "num_segments": 3,
            },
        ]
        speaker_rows = [{"id": "speaker_profile:sp1", "name": "Tech Experts"}]

        async def fake_repo_query(query, *args, **kwargs):
            if "episode_profile" in query:
                return episode_rows
            return speaker_rows

        configure_calls = {}

        def fake_configure(key, value):
            configure_calls[key] = value

        resolved: tuple = ("openai", "model-name", {})

        with (
            patch.object(
                EpisodeProfile,
                "get_by_name",
                new=AsyncMock(return_value=episode_profile),
            ),
            patch.object(
                SpeakerProfile,
                "resolve",
                new=AsyncMock(return_value=speaker_profile),
            ),
            patch(
                "open_notebook.podcasts.models._resolve_model_config",
                new=AsyncMock(return_value=resolved),
            ),
            patch(
                "commands.podcast_commands._resolve_model_config",
                new=AsyncMock(return_value=resolved),
            ),
            patch(
                "commands.podcast_commands.repo_query", new=fake_repo_query, create=True
            ),
            patch("commands.podcast_commands.configure", new=fake_configure),
            patch(
                "commands.podcast_commands.create_podcast",
                new=AsyncMock(
                    return_value={
                        "final_output_file_path": str(
                            tmp_path / "episodes" / "ep-dir" / "out.mp3"
                        ),
                        "transcript": {},
                        "outline": {},
                    }
                ),
            ),
            # audio_file is stored relative to PODCASTS_FOLDER and validated
            # at write time (#1030), so the fake output path must live under
            # the (patched) podcasts root.
            patch(
                "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER",
                str(tmp_path),
            ),
            patch(
                "commands.podcast_commands.build_episode_output_dir",
                new=lambda *args: ("ep-dir", tmp_path / "ep-dir"),
            ),
            patch(
                "open_notebook.podcasts.models.PodcastEpisode.save",
                new=AsyncMock(),
            ),
        ):
            result = await generate_podcast_command(make_input())

        assert result.success is True
        # The stored/reported audio path is relative to PODCASTS_FOLDER (#1030)
        assert result.audio_file_path == "episodes/ep-dir/out.mp3"
        episode_config = configure_calls["episode_config"]["profiles"]
        # Orphaned profile removed instead of poisoning validation
        assert "Orphaned Profile" not in episode_config
        # Record ID rewritten to the speaker profile NAME for podcast-creator
        assert (
            episode_config["Test Episode Profile"]["speaker_config"] == "Tech Experts"
        )


class TestUnconfiguredSpeakerProfileDoesNotPoisonConfig:
    """A speaker profile without a voice model (the seeded ones ship that way)
    must not fail podcast-creator's validation of the whole speakers config
    when generating with a different, complete profile (#1450)."""

    @pytest.mark.asyncio
    async def test_unconfigured_profile_dropped_selected_kept(self, tmp_path):
        episode_profile = EpisodeProfile(
            id="episode_profile:ep1",
            name="Test Episode Profile",
            speaker_config="speaker_profile:sp1",
            outline_llm="model:llm",
            transcript_llm="model:llm",
            default_briefing="brief",
            num_segments=3,
        )
        speaker = {
            "name": "Alex",
            "voice_id": "v1",
            "backstory": "b",
            "personality": "p",
        }
        speaker_profile = SpeakerProfile(
            id="speaker_profile:sp1",
            name="Tech Experts",
            voice_model="model:tts",
            speakers=[speaker],
        )
        episode_rows = [
            {
                "id": "episode_profile:ep1",
                "name": "Test Episode Profile",
                "speaker_config": "speaker_profile:sp1",
                "default_briefing": "brief",
                "num_segments": 3,
            },
        ]
        speaker_rows = [
            {
                "id": "speaker_profile:sp1",
                "name": "Tech Experts",
                "voice_model": "model:tts",
                "speakers": [dict(speaker)],
            },
            {
                # Seeded profile nobody configured yet
                "id": "speaker_profile:sp2",
                "name": "business_panel",
                "voice_model": None,
                "speakers": [dict(speaker)],
            },
        ]

        async def fake_repo_query(query, *args, **kwargs):
            if "episode_profile" in query:
                return episode_rows
            return speaker_rows

        configure_calls = {}

        def fake_configure(key, value):
            configure_calls[key] = value

        resolved: tuple = ("openai", "model-name", {})

        with (
            patch.object(
                EpisodeProfile,
                "get_by_name",
                new=AsyncMock(return_value=episode_profile),
            ),
            patch.object(
                SpeakerProfile, "resolve", new=AsyncMock(return_value=speaker_profile)
            ),
            patch(
                "open_notebook.podcasts.models._resolve_model_config",
                new=AsyncMock(return_value=resolved),
            ),
            patch(
                "commands.podcast_commands._resolve_model_config",
                new=AsyncMock(return_value=resolved),
            ),
            patch(
                "commands.podcast_commands.repo_query", new=fake_repo_query, create=True
            ),
            patch("commands.podcast_commands.configure", new=fake_configure),
            patch(
                "commands.podcast_commands.create_podcast",
                new=AsyncMock(
                    return_value={
                        "final_output_file_path": str(
                            tmp_path / "episodes" / "ep-dir" / "out.mp3"
                        ),
                        "transcript": {},
                        "outline": {},
                    }
                ),
            ),
            patch("open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(tmp_path)),
            patch(
                "commands.podcast_commands.build_episode_output_dir",
                new=lambda *args: ("ep-dir", tmp_path / "ep-dir"),
            ),
            patch("open_notebook.podcasts.models.PodcastEpisode.save", new=AsyncMock()),
        ):
            result = await generate_podcast_command(make_input())

        assert result.success is True
        speakers_config = configure_calls["speakers_config"]["profiles"]
        assert "business_panel" not in speakers_config
        assert speakers_config["Tech Experts"]["tts_provider"] == "openai"

        # The whole config passes podcast-creator's own validation.
        from podcast_creator.speakers import SpeakerConfig

        SpeakerConfig(profiles=speakers_config)
