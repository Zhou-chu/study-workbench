"""Credential dispatch through the inherited order-by validation boundary."""

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
