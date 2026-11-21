"""Real filesystem audio fixture and missing-file fallback boundary tests."""

import wave

from open_notebook.ai import connection_tester as ct


def test_audio_fallback_is_valid_silent_pcm(monkeypatch, tmp_path):
    monkeypatch.setattr(ct, "_TEST_SPEECH_PATH", str(tmp_path / "absent.mp3"))
    audio = ct._get_test_audio()
    assert audio.name == "test.wav" and audio.tell() == 0
    with wave.open(audio) as wav:
        assert (
            wav.getnchannels(),
            wav.getsampwidth(),
            wav.getframerate(),
            wav.getnframes(),
        ) == (1, 2, 16000, 8000)
        assert wav.readframes(8000) == bytes(16000)


def test_audio_reads_only_supplied_fixture(monkeypatch, tmp_path):
    fixture = tmp_path / "speech.mp3"
    fixture.write_bytes(b"synthetic-audio")
    monkeypatch.setattr(ct, "_TEST_SPEECH_PATH", str(fixture))
    audio = ct._get_test_audio()
    assert audio.name == "test_speech.mp3" and audio.tell() == 0
    assert audio.read() == b"synthetic-audio"
