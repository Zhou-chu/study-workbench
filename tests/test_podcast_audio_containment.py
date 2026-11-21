"""
Tests for the podcast audio path choke point (#1030).

`PodcastEpisode.audio_file` stores a path relative to PODCASTS_FOLDER;
`resolve_contained_audio_path()` (open_notebook/podcasts/audio_paths.py) is
the single helper every consumption point (stream, list, get, delete, retry)
uses to join + resolve + contain it. Absolute paths and `file://` URIs are
legacy rows migration 21 could not convert - they are treated as invalid,
preserving the 403/404 behavior #1018's guards gave them.
"""

from open_notebook.podcasts.audio_paths import resolve_contained_audio_path


class TestResolveContainedAudioPath:
    def test_relative_path_inside_root_resolves(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(tmp_path)
        )
        episode_dir = tmp_path / "episodes" / "some-uuid"
        episode_dir.mkdir(parents=True)
        (episode_dir / "final.mp3").write_bytes(b"fake audio")

        resolved = resolve_contained_audio_path("episodes/some-uuid/final.mp3")

        assert resolved == (episode_dir / "final.mp3").resolve()

    def test_dotdot_escape_is_rejected(self, tmp_path, monkeypatch):
        root = tmp_path / "podcasts"
        root.mkdir()
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(root)
        )
        outside = tmp_path / "outside.mp3"
        outside.write_bytes(b"etc passwd style file")

        assert resolve_contained_audio_path("../outside.mp3") is None
        assert resolve_contained_audio_path("episodes/../../outside.mp3") is None

    def test_absolute_path_is_rejected_even_when_inside_root(
        self, tmp_path, monkeypatch
    ):
        """Legacy rows the migration could not convert stay invalid - the DB
        contract after #1030 is relative-only."""
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(tmp_path)
        )
        inside = tmp_path / "episodes" / "u" / "a.mp3"
        inside.parent.mkdir(parents=True)
        inside.write_bytes(b"audio")

        assert resolve_contained_audio_path(str(inside)) is None
        assert resolve_contained_audio_path("/etc/passwd") is None

    def test_file_uri_is_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(tmp_path)
        )
        assert (
            resolve_contained_audio_path("file:///data/podcasts/episodes/x/a.mp3")
            is None
        )

    def test_sibling_directory_with_matching_prefix_is_rejected(
        self, tmp_path, monkeypatch
    ):
        """Regression guard for the startswith-without-separator bug: a
        sibling dir that merely *starts with* the root's name must not be
        reachable."""
        real_root = tmp_path / "podcasts"
        real_root.mkdir()
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(real_root)
        )
        sibling = tmp_path / "podcasts_evil"
        sibling.mkdir()
        (sibling / "secret.mp3").write_bytes(b"not yours")

        assert resolve_contained_audio_path("../podcasts_evil/secret.mp3") is None

    def test_symlink_escape_is_rejected(self, tmp_path, monkeypatch):
        root = tmp_path / "podcasts"
        root.mkdir()
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(root)
        )
        outside = tmp_path / "outside.mp3"
        outside.write_bytes(b"secret")
        (root / "link.mp3").symlink_to(outside)

        assert resolve_contained_audio_path("link.mp3") is None

    def test_root_itself_is_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "open_notebook.podcasts.audio_paths.PODCASTS_FOLDER", str(tmp_path)
        )
        assert resolve_contained_audio_path(".") is None

    def test_real_podcasts_folder_resolves(self):
        """Sanity check against the real (non-monkeypatched) config constant."""
        assert resolve_contained_audio_path("episodes/abc/out.mp3") is not None
        assert resolve_contained_audio_path("../elsewhere.mp3") is None
