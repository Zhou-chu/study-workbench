"""Direct model selection and unavailable credential-store handling."""

from unittest.mock import AsyncMock

import pytest

from api.routers import models as router


def test_provider_store_unavailability_is_not_a_configured_credential(monkeypatch):
    import asyncio

    from open_notebook.domain.credential import Credential

    monkeypatch.setattr(
        Credential, "get_by_provider", AsyncMock(side_effect=RuntimeError("synthetic"))
    )
    assert asyncio.run(router._check_provider_has_credential("openai")) is False


@pytest.mark.parametrize(
    "records,priority,preferences,expected",
    [
        ([], ["openai"], {}, None),
        ([{"id": "a", "provider": "other", "name": "x"}], ["openai"], {}, "a"),
        (
            [
                {"id": "a", "provider": "openai", "name": "ordinary"},
                {"id": "b", "provider": "openai", "name": "preferred"},
            ],
            ["openai"],
            {"openai": ["unavailable", "preferred"]},
            "b",
        ),
        (
            [{"id": "a", "provider": "openai", "name": "ordinary"}],
            ["openai"],
            {"openai": ["unavailable"]},
            "a",
        ),
    ],
)
def test_preferred_model_real_fallback_order(records, priority, preferences, expected):
    result = router._get_preferred_model(records, priority, preferences)
    assert (result["id"] if result else None) == expected


def test_preferred_provider_without_preferences_uses_first():
    first = {"id": "first", "provider": "openai", "name": "a"}
    second = {"id": "second", "provider": "openai", "name": "b"}
    assert router._get_preferred_model([first, second], ["openai"], {}) == first
