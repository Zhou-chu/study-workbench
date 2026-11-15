from unittest.mock import AsyncMock, patch

import pytest


class TestGetDefaultModelFallback:
    """get_default_model must fall back to the chat model for the three text
    optional slots (transformation, tools, large_context) when unset (#1098).
    """

    def _defaults(self):
        from unittest.mock import MagicMock

        defaults = MagicMock()
        defaults.default_chat_model = "model:chat"
        defaults.default_transformation_model = None
        defaults.default_tools_model = None
        defaults.large_context_model = None
        defaults.default_text_to_speech_model = None
        defaults.default_speech_to_text_model = None
        defaults.default_embedding_model = "model:embed"
        return defaults

    @pytest.mark.asyncio
    @pytest.mark.parametrize("model_type", ["transformation", "tools", "large_context"])
    async def test_text_optional_slots_fall_back_to_chat(self, model_type):
        from open_notebook.ai.models import model_manager

        defaults = self._defaults()
        with (
            patch.object(
                model_manager, "get_defaults", new=AsyncMock(return_value=defaults)
            ),
            patch.object(
                model_manager, "get_model", new=AsyncMock(return_value="chat-model-obj")
            ) as mock_get_model,
        ):
            result = await model_manager.get_default_model(model_type)

        assert result == "chat-model-obj"
        mock_get_model.assert_awaited_once()
        assert mock_get_model.await_args is not None
        assert mock_get_model.await_args.args[0] == "model:chat"

    @pytest.mark.asyncio
    async def test_audio_slots_do_not_fall_back(self):
        from open_notebook.ai.models import model_manager

        defaults = self._defaults()
        with (
            patch.object(
                model_manager, "get_defaults", new=AsyncMock(return_value=defaults)
            ),
            patch.object(
                model_manager, "get_model", new=AsyncMock(return_value="obj")
            ) as mock_get_model,
        ):
            tts = await model_manager.get_default_model("text_to_speech")
            stt = await model_manager.get_default_model("speech_to_text")

        assert tts is None
        assert stt is None
        mock_get_model.assert_not_awaited()
