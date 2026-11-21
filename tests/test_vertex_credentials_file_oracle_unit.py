"""Direct classification and generic notice behavior with synthetic exceptions."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from open_notebook.ai.connection_tester import _is_vertex_credentials_file_error
from open_notebook.ai.connection_tester import (
    test_individual_model as run_individual_model_test,
)


class TestIsVertexCredentialsFileError:
    def test_does_not_misclassify_unrelated_errors(self):
        assert (
            _is_vertex_credentials_file_error(ValueError("some other error")) is False
        )
        assert _is_vertex_credentials_file_error(RuntimeError("rate limited")) is False

    def test_does_not_misclassify_network_errors(self):
        # ConnectionError/TimeoutError are OSError subclasses and
        # TransportError is a GoogleAuthError subclass, so without an
        # explicit exclusion a blocked network would surface as "Invalid or
        # inaccessible credentials file" - a false lead. They must fall
        # through to the normal connection-error handling instead.
        from google.auth.exceptions import TransportError

        assert (
            _is_vertex_credentials_file_error(ConnectionError("connection refused"))
            is False
        )
        assert (
            _is_vertex_credentials_file_error(ConnectionRefusedError("refused"))
            is False
        )
        assert _is_vertex_credentials_file_error(TimeoutError("timed out")) is False
        assert (
            _is_vertex_credentials_file_error(TransportError("failed to connect"))
            is False
        )


class TestTestCredentialClosesOracle:
    @pytest.mark.asyncio
    async def test_non_vertex_provider_still_gets_detailed_message(self):
        """Only vertex has this specific file-existence oracle risk - other
        providers should be unaffected by the generic-message guard."""
        from open_notebook.domain.credential import Credential

        cred = MagicMock(spec=Credential)
        cred.provider = "openai"
        cred.to_esperanto_config.return_value = {"api_key": "sk-fake"}

        from api.credentials_service import test_credential

        with (
            patch(
                "open_notebook.domain.credential.Credential.get",
                new=AsyncMock(return_value=cred),
            ),
            patch(
                "esperanto.factory.AIFactory.create_language",
                side_effect=FileNotFoundError("unrelated file issue"),
            ),
        ):
            result = await test_credential("credential:test")

        assert result["message"] != "Invalid or inaccessible credentials file"


class TestIndividualModelClosesOracle:
    @pytest.mark.asyncio
    async def test_non_vertex_provider_still_gets_detailed_message(self):
        model = MagicMock(id="model:openai1", provider="openai", type="language")

        manager_instance = MagicMock()
        manager_instance.get_model = AsyncMock(
            side_effect=FileNotFoundError("unrelated file issue")
        )

        with patch(
            "open_notebook.ai.models.ModelManager", return_value=manager_instance
        ):
            success, message = await run_individual_model_test(model)

        assert message != "Invalid or inaccessible credentials file"
