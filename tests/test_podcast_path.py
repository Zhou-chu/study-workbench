"""Real directory creation contract, separate from path-construction units."""

from commands.podcast_commands import build_episode_output_dir


class TestBuildEpisodeOutputDir:
    def test_directory_can_be_created(self, tmp_path):
        """Create the directory on the real filesystem."""
        _, output_dir = build_episode_output_dir(str(tmp_path))
        output_dir.mkdir(parents=True, exist_ok=True)
        assert output_dir.exists()
        assert output_dir.is_dir()
