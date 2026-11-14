"""A generation uses only its validated selected profiles, never a bulk reload."""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from commands.podcast_commands import PodcastGenerationInput, generate_podcast_command
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    ["rename", "deleted", "outline_cleared", "transcript_cleared", "voice_cleared"],
)
async def test_selected_snapshot_does_not_reload_changed_profiles(change):
    episode = EpisodeProfile(
        id="episode_profile:selected",
        name="episode",
        speaker_config="speaker_profile:selected",
        outline_llm="model:outline",
        transcript_llm="model:transcript",
        default_briefing="test",
    )
    speaker = SpeakerProfile(
        id="speaker_profile:selected",
        name="speaker",
        voice_model="model:tts",
        speakers=[
            {
                "name": "Host",
                "voice_id": "test",
                "backstory": "test",
                "personality": "test",
            }
        ],
    )
    episode_row, speaker_row = episode.model_dump(), speaker.model_dump()
    if change == "rename":
        episode_row["name"], speaker_row["name"] = "renamed episode", "renamed speaker"
    elif change == "outline_cleared":
        episode_row["outline_llm"] = None
    elif change == "transcript_cleared":
        episode_row["transcript_llm"] = None
    elif change == "voice_cleared":
        speaker_row["voice_model"] = None
    reload_rows = [[], []] if change == "deleted" else [[episode_row], [speaker_row]]

    async def resolve(model_id, **kwargs):
        return "bound-provider", model_id, {"base_url": "https://bound.example.invalid"}

    with (
        patch.object(EpisodeProfile, "get_by_name", AsyncMock(return_value=episode)),
        patch.object(SpeakerProfile, "resolve", AsyncMock(return_value=speaker)),
        patch(
            "open_notebook.podcasts.models._resolve_model_config",
            AsyncMock(side_effect=resolve),
        ),
        patch(
            "commands.podcast_commands._resolve_model_config",
            AsyncMock(side_effect=resolve),
        ),
        patch(
            "commands.podcast_commands.repo_query",
            AsyncMock(side_effect=reload_rows),
            create=True,
        ) as reload,
        patch("commands.podcast_commands.configure") as configure,
        patch("commands.podcast_commands.PodcastEpisode.save", AsyncMock()),
        patch(
            "commands.podcast_commands.build_episode_output_dir",
            return_value=("test", Mock()),
        ),
        patch(
            "commands.podcast_commands.create_podcast",
            AsyncMock(return_value={"transcript": None, "outline": None}),
        ) as generate,
    ):
        result = await generate_podcast_command(
            PodcastGenerationInput(
                episode_profile="episode", episode_name="test", content="test"
            )
        )
    reload.assert_not_awaited()
    assert result.success
    configs = {
        call.args[0]: call.args[1]["profiles"] for call in configure.call_args_list
    }
    assert set(configs["episode_config"]) == {"episode"}
    assert set(configs["speakers_config"]) == {"speaker"}
    ep = configs["episode_config"]["episode"]
    sp = configs["speakers_config"]["speaker"]
    assert ep["speaker_config"] == "speaker"
    assert ep["outline_model"] == "model:outline"
    assert ep["transcript_model"] == "model:transcript"
    assert sp["tts_model"] == "model:tts"
    assert (
        ep["outline_config"]
        == ep["transcript_config"]
        == sp["tts_config"]
        == {"base_url": "https://bound.example.invalid"}
    )
    assert generate.await_args is not None
    assert generate.await_args.kwargs["episode_profile"] == "episode"
    assert generate.await_args.kwargs["speaker_config"] == "speaker"


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["provider", "model"])
async def test_incomplete_resolved_tuple_never_reaches_library_defaults(missing):
    from open_notebook.exceptions import ConfigurationError

    episode = EpisodeProfile(
        name="episode",
        speaker_config="speaker_profile:selected",
        outline_llm="model:outline",
        transcript_llm="model:transcript",
        default_briefing="test",
    )
    speaker = SpeakerProfile(
        name="speaker",
        voice_model="model:tts",
        speakers=[
            {
                "name": "Host",
                "voice_id": "test",
                "backstory": "test",
                "personality": "test",
            }
        ],
    )
    resolved: tuple[str, str, dict] = (
        "" if missing == "provider" else "provider",
        "" if missing == "model" else "model",
        {},
    )
    with (
        patch.object(EpisodeProfile, "get_by_name", AsyncMock(return_value=episode)),
        patch.object(SpeakerProfile, "resolve", AsyncMock(return_value=speaker)),
        patch(
            "open_notebook.podcasts.models._resolve_model_config",
            AsyncMock(return_value=resolved),
        ),
        patch("commands.podcast_commands.configure") as configure,
        patch(
            "commands.podcast_commands.create_podcast",
            AsyncMock(return_value={"transcript": None, "outline": None}),
        ) as generate,
        patch("commands.podcast_commands.PodcastEpisode.save", AsyncMock()),
        patch(
            "commands.podcast_commands.build_episode_output_dir",
            return_value=("test", Mock()),
        ),
        pytest.raises(ConfigurationError, match="incomplete"),
    ):
        await generate_podcast_command(
            PodcastGenerationInput(
                episode_profile="episode", episode_name="test", content="test"
            )
        )
    configure.assert_not_called()
    generate.assert_not_awaited()
