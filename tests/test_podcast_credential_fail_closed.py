"""A selected podcast voice binding cannot be replaced after lookup failure."""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from commands.podcast_commands import PodcastGenerationInput, generate_podcast_command
from open_notebook.ai.models import Model
from open_notebook.domain.credential import Credential
from open_notebook.exceptions import (
    ConfigurationError,
    DatabaseOperationError,
    NotFoundError,
)
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile


@pytest.mark.asyncio
@pytest.mark.parametrize("error_type", [NotFoundError, DatabaseOperationError])
@pytest.mark.parametrize(
    "stage",
    [
        "override",
        "outline_initial",
        "transcript_initial",
        "tts_initial",
    ],
)
async def test_selected_podcast_binding_failure_stops_before_generation(
    error_type, stage
):
    episode = EpisodeProfile(
        name="selected",
        speaker_config="speaker_profile:selected",
        outline_llm="model:outline",
        transcript_llm="model:transcript",
        default_briefing="test briefing",
    )
    speakers = SpeakerProfile(
        id="speaker_profile:selected",
        name="selected",
        voice_model="model:tts",
        speakers=[
            {
                "name": "Speaker",
                "voice_id": "test",
                "backstory": "test",
                "personality": "test",
                "voice_model": "model:override",
            }
        ],
    )
    failure = error_type("lookup failed")
    lookup_counts: dict[str, int] = {}

    async def get_model(model_id):
        name = model_id.split(":")[1]
        return Model(
            id=model_id,
            name=name,
            provider="openai_compatible",
            type="text_to_speech" if name in {"tts", "override"} else "language",
            credential=f"credential:{name}",
        )

    async def get_credential(credential_id):
        name = credential_id.split(":")[1]
        lookup_counts[name] = lookup_counts.get(name, 0) + 1
        target = stage.split("_")[0]
        if name == target and lookup_counts[name] == 1:
            raise failure
        return Credential(
            name=name,
            provider="openai_compatible",
            api_key="fake-key",
            base_url="https://bound.example.invalid",
        )

    with (
        patch.object(EpisodeProfile, "get_by_name", AsyncMock(return_value=episode)),
        patch.object(SpeakerProfile, "resolve", AsyncMock(return_value=speakers)),
        patch.object(Model, "get", AsyncMock(side_effect=get_model)),
        patch.object(Credential, "get", AsyncMock(side_effect=get_credential)),
        patch("commands.podcast_commands.PodcastEpisode.save", AsyncMock()),
        patch("commands.podcast_commands.configure") as configure,
        patch(
            "commands.podcast_commands.build_episode_output_dir",
            return_value=("test", Mock()),
        ),
        patch(
            "commands.podcast_commands.create_podcast",
            AsyncMock(return_value={"transcript": None, "outline": None}),
        ) as generate,
        patch(
            "open_notebook.ai.key_provider.provision_provider_keys", AsyncMock()
        ) as provision,
    ):
        expected = (
            ConfigurationError
            if error_type is NotFoundError
            else DatabaseOperationError
        )
        with pytest.raises(expected) as raised:
            await generate_podcast_command(
                PodcastGenerationInput(
                    episode_profile="selected",
                    episode_name="test",
                    content="test content",
                )
            )
    if error_type is DatabaseOperationError:
        assert raised.value is failure
    else:
        assert raised.value.__cause__ is failure
    configure.assert_not_called()
    generate.assert_not_awaited()
    provision.assert_not_awaited()
