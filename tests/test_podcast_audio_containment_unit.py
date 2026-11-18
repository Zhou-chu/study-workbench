"""Empty podcast values are rejected before resolving any file."""

from open_notebook.podcasts.audio_paths import resolve_contained_audio_path


class TestResolveContainedAudioPath:
    def test_empty_and_none_are_rejected(self):
        assert resolve_contained_audio_path(None) is None
        assert resolve_contained_audio_path("") is None
