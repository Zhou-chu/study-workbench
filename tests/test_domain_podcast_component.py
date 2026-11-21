"""Podcast service and context construction with synthetic source and command seams."""

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.podcast_service import PodcastService
from open_notebook.domain.notebook import Notebook, Source, SourceInsight
from open_notebook.podcasts.models import EpisodeProfile, SpeakerProfile


class TestPodcastService:
    """Test suite for podcast service notebook content resolution."""

    @pytest.mark.asyncio
    async def test_submit_generation_job_uses_notebook_context_content(self):
        """Test notebook podcast jobs submit real source content, not model repr."""
        notebook = Notebook(id="notebook:test", name="Test", description="Test")
        sources = [
            Source(
                id="source:first",
                title="First Source",
                full_text="First source full text for submitted podcast content.",
            ),
            Source(
                id="source:second",
                title="Second Source",
                full_text="Second source full text for submitted podcast content.",
            ),
        ]
        submitted_args = {}

        async def fake_get_sources(self, include_full_text=False):
            return sources

        async def fake_get_notes(self, include_content=False):
            return []

        async def fake_get_for_sources(cls, source_ids):
            return {sid: [] for sid in source_ids}

        async def fake_submit_command(app_name, command_name, command_args):
            submitted_args.update(command_args)
            return "command:podcast"

        fake_commands_module = ModuleType("commands.podcast_commands")
        # The real commands/__init__.py runs `from .podcast_commands import
        # generate_podcast_command` when the package is imported, so the fake
        # submodule must expose that name or the package import fails before the
        # patched submit_command is reached.
        # setattr: dynamic module attribute mypy can't know about
        setattr(fake_commands_module, "generate_podcast_command", lambda *a, **k: None)

        with (
            patch.object(
                EpisodeProfile, "get_by_name", new=AsyncMock(return_value=object())
            ),
            patch.object(
                SpeakerProfile,
                "get_by_name",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        id="speaker_profile:speakers", name="Speakers"
                    )
                ),
            ),
            patch.object(Notebook, "get", new=AsyncMock(return_value=notebook)),
            patch.object(Notebook, "get_sources", new=fake_get_sources),
            patch.object(Notebook, "get_notes", new=fake_get_notes),
            patch.object(
                SourceInsight, "get_for_sources", new=classmethod(fake_get_for_sources)
            ),
            patch("api.podcast_service.submit_command", new=fake_submit_command),
            patch.dict(
                sys.modules, {"commands.podcast_commands": fake_commands_module}
            ),
        ):
            job_id = await PodcastService.submit_generation_job(
                episode_profile_name="Episode",
                speaker_profile_name="Speakers",
                episode_name="Episode Name",
                notebook_id="notebook:test",
            )

        assert job_id == "command:podcast"
        content = submitted_args["content"]
        assert "First source full text for submitted podcast content." in content
        assert "Second source full text for submitted podcast content." in content
        assert "Notebook(id=" not in content
