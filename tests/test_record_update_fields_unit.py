"""RecordModel persistence payload units with all repository I/O doubled."""

import warnings
from typing import ClassVar
from unittest.mock import AsyncMock

import pytest
from pydantic.warnings import PydanticDeprecatedSince211
from surrealdb import RecordID

from open_notebook.domain import base


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", [[], [{"value": 9, "ignored": "not a model field"}]])
async def test_update_uses_concrete_class_fields_without_instance_deprecation(
    monkeypatch, stored
):
    class Parent(base.RecordModel):
        record_id: ClassVar[str] = "test:field-payload"
        inherited: str = "parent"

    class Child(Parent):
        table_name: ClassVar[str] = "test_records"
        value: int = 3
        optional: str | None = None

    monkeypatch.setattr(base.RecordModel, "_instances", {})
    upsert = AsyncMock()
    query = AsyncMock(return_value=stored)
    monkeypatch.setattr(base, "repo_upsert", upsert)
    monkeypatch.setattr(base, "repo_query", query)
    model = Child()
    with warnings.catch_warnings():
        warnings.simplefilter("error", PydanticDeprecatedSince211)
        result = await model.update()
    assert result is model
    upsert.assert_awaited_once_with(
        "test_records",
        "test:field-payload",
        {"inherited": "parent", "value": 3, "optional": None},
    )
    assert query.await_count == 1
    assert query.await_args.args[0] == "SELECT * FROM $record_id"
    assert query.await_args.args[1]["record_id"] == RecordID("test", "field-payload")
    assert model.value == (9 if stored else 3)
    assert not hasattr(model, "ignored")
