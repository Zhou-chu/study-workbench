"""Static availability contract for the installed audio check entry point."""

from audio_playback_lifecycle_fixtures import audio as _audio

audio = _audio


def test_owned_context_available(audio):
    assert callable(getattr(audio, "owned_audio_context", None))
