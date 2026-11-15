"""
Regression tests for ObjectModel._validate_order_by() and its use by
Credential.get_all() (open_notebook/domain/credential.py), which builds its
own query instead of delegating to the base get_all() and previously
interpolated order_by into the SurrealQL unvalidated.
"""

from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.domain.credential import Credential
from open_notebook.exceptions import InvalidInputError


class TestCredentialGetAllRejectsInjection:
    @pytest.mark.asyncio
    async def test_injection_in_order_by_raises_before_querying(self):
        # Must raise on validation - reaching the database with this string
        # (the pre-fix behavior) would execute the injected statement.
        with pytest.raises(InvalidInputError):
            await Credential.get_all(order_by="provider; DROP TABLE credential")


class TestGetNotebooksOrderBy:
    """get_notebooks() routes order_by through _validate_order_by() and keeps
    its stricter field allowlist on top (#1416)."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from api.main import app

        return TestClient(app)

    @pytest.mark.parametrize(
        "order_by,expected",
        [
            ("updated desc", "updated desc"),
            ("name asc", "name asc"),
            ("created", "created"),
            ("  Name   DESC ", "name desc"),
        ],
    )
    def test_valid_values_reach_the_query_normalized(self, client, order_by, expected):
        with patch(
            "api.routers.notebooks.repo_query", new_callable=AsyncMock
        ) as mock_query:
            mock_query.return_value = []
            response = client.get("/api/notebooks", params={"order_by": order_by})

        assert response.status_code == 200
        query = mock_query.call_args.args[0]
        assert f"ORDER BY {expected}\n" in query

    @pytest.mark.parametrize(
        "order_by",
        [
            "updated; DROP TABLE notebook",
            "name) FETCH (SELECT * FROM credential",
            "updated LIMIT 1",
            "name desc extra",
            "archived desc",
            "id",
            "name asc, updated desc",
            "updated sideways",
            "",
        ],
    )
    def test_injection_and_unknown_fields_return_400(self, client, order_by):
        with patch(
            "api.routers.notebooks.repo_query", new_callable=AsyncMock
        ) as mock_query:
            response = client.get("/api/notebooks", params={"order_by": order_by})

        assert response.status_code == 400
        assert "Allowed fields: created, name, updated" in response.json()["detail"]
        mock_query.assert_not_called()
