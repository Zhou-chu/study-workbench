"""Response fields may be null but must not disappear from the wire contract."""

import pytest
from pydantic import ValidationError

from api.models import NoteResponse, SourceListResponse, SourceResponse

CASES = [
    (
        NoteResponse,
        {
            "revision": 1,
            "id": "note:fixture",
            "created": "2026-01-01",
            "updated": "2026-01-01",
        },
        {"title": "Title", "content": "Body", "note_type": "human"},
    ),
    (
        SourceResponse,
        {
            "id": "source:fixture",
            "embedded": False,
            "embedded_chunks": 0,
            "created": "2026-01-01",
            "updated": "2026-01-01",
        },
        {
            "title": "Title",
            "topics": ["topic"],
            "asset": {"file_path": None, "url": "https://example.invalid/fixture"},
            "full_text": "Text",
        },
    ),
    (
        SourceListResponse,
        {
            "id": "source:fixture",
            "embedded": False,
            "embedded_chunks": 0,
            "insights_count": 0,
            "created": "2026-01-01",
            "updated": "2026-01-01",
        },
        {
            "title": "Title",
            "topics": ["topic"],
            "asset": {"file_path": None, "url": "https://example.invalid/fixture"},
        },
    ),
]


@pytest.mark.parametrize("model,required,nullable", CASES)
def test_schema_requires_nullable_keys_without_a_default(model, required, nullable):
    schema = model.model_json_schema()
    assert set(schema["required"]) == required.keys() | nullable.keys()
    for field in nullable:
        assert model.model_fields[field].is_required()
        assert {"type": "null"} in schema["properties"][field]["anyOf"]
        assert "default" not in schema["properties"][field]
    assert "command_id" not in schema["required"]
    assert schema["properties"]["command_id"]["default"] is None


@pytest.mark.parametrize("model,required,nullable", CASES)
def test_explicit_null_keys_survive_response_serialization(model, required, nullable):
    payload = required | dict.fromkeys(nullable)
    value = model.model_validate(payload)
    assert value.model_dump(exclude_unset=True) == payload
    assert value.command_id is None


@pytest.mark.parametrize("model,required,nullable", CASES)
def test_nonnull_response_values_survive_serialization(model, required, nullable):
    payload = required | nullable
    assert model.model_validate(payload).model_dump(exclude_unset=True) == payload


@pytest.mark.parametrize(
    "model,required,nullable,missing",
    [
        (model, required, nullable, field)
        for model, required, nullable in CASES
        for field in nullable
    ],
)
def test_missing_nullable_response_field_is_rejected(
    model, required, nullable, missing
):
    payload = required | dict.fromkeys(nullable)
    del payload[missing]
    with pytest.raises(ValidationError) as caught:
        model.model_validate(payload)
    assert [(error["loc"], error["type"]) for error in caught.value.errors()] == [
        ((missing,), "missing")
    ]
