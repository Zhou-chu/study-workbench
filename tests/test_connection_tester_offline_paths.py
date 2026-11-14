"""Provider probes use fake pinned HTTP and fake model instances, never providers."""

import io
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from open_notebook.ai import connection_tester as ct


@pytest.fixture
def transport(monkeypatch):
    target = SimpleNamespace(
        url="https://192.0.2.1/pinned",
        headers={"Host": "fake.invalid"},
        extensions={"sni_hostname": "fake.invalid"},
    )
    pin = AsyncMock(return_value=target)
    client = SimpleNamespace(get=AsyncMock())
    context = Mock()
    context.__aenter__ = AsyncMock(return_value=client)
    context.__aexit__ = AsyncMock(return_value=False)
    factory = Mock(return_value=context)
    monkeypatch.setattr(ct, "prepare_pinned_http_target", pin)
    monkeypatch.setattr(ct.httpx, "AsyncClient", factory)
    return client, pin, target


async def probe(kind):
    if kind == "azure":
        return await ct._test_azure_connection(
            "https://fake.invalid/", "synthetic", "test-version"
        )
    if kind == "ollama":
        return await ct._test_ollama_connection("https://fake.invalid/")
    return await ct._test_openai_compatible_connection(
        "https://fake.invalid/models/", "synthetic"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["azure", "ollama", "compatible"])
@pytest.mark.parametrize(
    "status,fragment",
    [
        (401, "Invalid API key"),
        (403, "lacks required permissions"),
        (502, "status 502"),
    ],
)
async def test_probe_preserves_http_failure_category(transport, kind, status, fragment):
    client, _, _ = transport
    client.get.return_value = httpx.Response(status)
    success, message = await probe(kind)
    assert success is False
    assert fragment in message


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["azure", "ollama", "compatible"])
@pytest.mark.parametrize("count", [0, 1, 4])
async def test_probe_lists_bounded_names_and_keeps_pinned_request(
    transport, kind, count
):
    client, pin, target = transport
    key, name = ("models", "name") if kind == "ollama" else ("data", "id")
    client.get.return_value = httpx.Response(
        200, json={key: [{name: "one"}, {}, {name: "three"}, {name: "four"}][:count]}
    )
    success, message = await probe(kind)
    assert success is True
    if count:
        assert f"{count} models" in message and "one" in message
        assert "four" not in message
    else:
        assert "no models" in message
    if count == 4:
        assert "unknown" in message and "(+1 more)" in message
    expected_url = {
        "azure": "https://fake.invalid/openai/models?api-version=test-version",
        "ollama": "https://fake.invalid/api/tags",
        "compatible": "https://fake.invalid/models",
    }[kind]
    assert pin.await_args.args[0] == expected_url
    args = client.get.await_args
    assert args.args == (target.url,)
    assert args.kwargs["extensions"] == target.extensions
    assert args.kwargs["headers"]["Host"] == "fake.invalid"
    if kind == "azure":
        assert args.kwargs["headers"]["api-key"] == "synthetic"
    elif kind == "compatible":
        assert args.kwargs["headers"]["Authorization"] == "Bearer synthetic"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["azure", "ollama", "compatible"])
@pytest.mark.parametrize(
    "error,fragment",
    [
        (ValueError("unsafe target"), "unsafe target"),
        (httpx.ConnectError("refused"), "Cannot connect"),
        (httpx.ReadTimeout("slow"), "timed out"),
        (RuntimeError("x" * 200), "Connection error: " + "x" * 100),
    ],
)
async def test_probe_does_not_misreport_transport_or_validation_errors(
    transport, kind, error, fragment
):
    client, _, _ = transport
    client.get.side_effect = error
    success, message = await probe(kind)
    assert success is False
    assert fragment in message
    assert len(message) <= 118


@pytest.mark.asyncio
async def test_azure_missing_configuration_never_resolves_target(
    monkeypatch, transport
):
    for name in [
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_API_VERSION",
    ]:
        monkeypatch.delenv(name, raising=False)
    assert await ct._test_azure_connection() == (False, "No Azure endpoint configured")
    assert await ct._test_azure_connection("https://fake.invalid") == (
        False,
        "No Azure API key configured",
    )
    transport[1].assert_not_awaited()


@pytest.mark.asyncio
async def test_compatible_without_key_does_not_add_authorization(transport):
    transport[0].get.return_value = httpx.Response(200, json={})
    assert (await ct._test_openai_compatible_connection("https://fake.invalid"))[0]
    assert "Authorization" not in transport[0].get.await_args.kwargs["headers"]


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


@pytest.fixture
def model_manager(monkeypatch):
    from open_notebook.ai import models

    getter = AsyncMock()
    monkeypatch.setattr(
        models, "ModelManager", lambda: SimpleNamespace(get_model=getter)
    )
    return getter


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,cls",
    [
        ("language", ct.LanguageModel),
        ("embedding", ct.EmbeddingModel),
        ("text_to_speech", ct.TextToSpeechModel),
        ("speech_to_text", ct.SpeechToTextModel),
    ],
)
async def test_individual_model_rejects_mismatched_instance(model_manager, kind, cls):
    model_manager.return_value = object()
    success, message = await ct.test_individual_model(
        SimpleNamespace(id="fixture", type=kind, provider="openai")
    )
    assert not success and "Model type mismatch" in message


@pytest.mark.asyncio
async def test_missing_and_unsupported_model_are_not_success(model_manager):
    model = SimpleNamespace(id="fixture", type="future", provider="openai")
    model_manager.return_value = None
    assert await ct.test_individual_model(model) == (
        False,
        "Could not create model instance",
    )
    model_manager.return_value = object()
    assert await ct.test_individual_model(model) == (
        False,
        "Unsupported model type: future",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result,expected",
    [([[0.1, 0.2]], "Embedding dimensions: 2"), ([], "Embedding successful")],
)
async def test_embedding_probe_reports_actual_dimension(
    model_manager, result, expected
):
    instance = Mock(spec=ct.EmbeddingModel)
    instance.aembed = AsyncMock(return_value=result)
    model_manager.return_value = instance
    assert await ct.test_individual_model(
        SimpleNamespace(id="fixture", type="embedding", provider="openai")
    ) == (True, expected)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result,expected",
    [
        (SimpleNamespace(text=" hello "), "Transcription: hello"),
        (" raw ", "Transcription: raw"),
        (
            SimpleNamespace(text=" "),
            "Connection successful (test clip produced no transcription)",
        ),
    ],
)
async def test_stt_distinguishes_blank_and_text_outputs(
    monkeypatch, model_manager, result, expected
):
    instance = Mock(spec=ct.SpeechToTextModel)
    instance.atranscribe = AsyncMock(return_value=result)
    model_manager.return_value = instance
    monkeypatch.setattr(ct, "_get_test_audio", lambda: io.BytesIO(b"fixture"))
    assert await ct.test_individual_model(
        SimpleNamespace(id="fixture", type="speech_to_text", provider="openai")
    ) == (True, expected)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,voices,audio,voice,expected",
    [
        (
            "openai",
            {},
            SimpleNamespace(content=b"abc"),
            "alloy",
            "Audio generated: 3 bytes",
        ),
        (
            "custom",
            {"fixture-voice": {}},
            None,
            "fixture-voice",
            "Speech generation successful",
        ),
        ("custom", {}, None, "alloy", "Speech generation successful"),
    ],
)
async def test_tts_selects_voice_and_reports_audio_size(
    model_manager, provider, voices, audio, voice, expected
):
    instance = Mock(spec=ct.TextToSpeechModel)
    instance.available_voices = voices
    instance.agenerate_speech = AsyncMock(return_value=audio)
    model_manager.return_value = instance
    assert await ct.test_individual_model(
        SimpleNamespace(id="fixture", type="text_to_speech", provider=provider)
    ) == (True, expected)
    assert instance.agenerate_speech.await_args.kwargs["voice"] == voice


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content,expected",
    [
        ("hello", "Response: hello"),
        ("", "Response: (empty response)"),
        ("x" * 120, "Response: " + "x" * 100),
    ],
)
async def test_language_probe_reports_bounded_nonstreaming_content(
    model_manager, content, expected
):
    response = Mock(spec=ct.ChatCompletion)
    response.content = content
    instance = Mock(spec=ct.LanguageModel)
    instance.achat_complete = AsyncMock(return_value=response)
    model_manager.return_value = instance
    assert await ct.test_individual_model(
        SimpleNamespace(id="fixture", type="language", provider="openai")
    ) == (True, expected)


@pytest.mark.asyncio
async def test_language_probe_handles_streaming_response_without_reading_it(
    model_manager,
):
    instance = Mock(spec=ct.LanguageModel)
    instance.achat_complete = AsyncMock(return_value=object())
    model_manager.return_value = instance
    assert await ct.test_individual_model(
        SimpleNamespace(id="fixture", type="language", provider="openai")
    ) == (True, "Connection successful (streaming response)")


@pytest.mark.asyncio
async def test_individual_error_does_not_become_success(model_manager):
    model_manager.side_effect = RuntimeError("401 unauthorized")
    success, message = await ct.test_individual_model(
        SimpleNamespace(id="fixture", type="language", provider="openai")
    )
    assert not success and "Invalid API key" in message
