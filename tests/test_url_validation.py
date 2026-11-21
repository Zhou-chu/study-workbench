"""System localhost resolution compatibility; isolated URL guards live separately."""

import pytest

from api.credentials_service import validate_url

pytestmark = pytest.mark.asyncio


class TestUrlValidation:
    """Test suite for URL validation to prevent SSRF attacks."""

    async def test_localhost_allowed_for_self_hosted(self):
        """Localhost should be allowed for self-hosted services."""
        # This is a self-hosted app, localhost is valid for local services
        await validate_url("http://localhost:8000", "openai")
        await validate_url("http://127.0.0.1:8000", "azure")

    async def test_localhost_allowed_for_ollama(self):
        """Localhost should be allowed for Ollama provider."""
        await validate_url("http://localhost:11434", "ollama")
        await validate_url("http://127.0.0.1:11434", "ollama")
