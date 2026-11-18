"""Shared synthetic podcast command and episode model inputs."""

from unittest.mock import Mock

from commands.podcast_commands import (
    PodcastGenerationInput,
)


def make_episode_profile(speaker_config="speaker_profile:from_episode"):
    profile = Mock()
    profile.name = "Test Episode Profile"
    profile.speaker_config = speaker_config
    return profile


def make_input(speaker_profile=None):
    return PodcastGenerationInput(
        episode_profile="Test Episode Profile",
        speaker_profile=speaker_profile,
        episode_name="Test Episode",
        content="test content",
    )
