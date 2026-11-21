"""Transformation editing and execution without API transport, storage or model I/O."""

import asyncio
from dataclasses import dataclass
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.models import (
    DefaultPromptUpdate,
    TransformationCreate,
    TransformationExecuteRequest,
    TransformationUpdate,
)
from api.routers import transformations as routes
from open_notebook.domain.transformation import DefaultPrompts, Transformation
from open_notebook.exceptions import DatabaseOperationError, IncompleteGenerationError

pytestmark = pytest.mark.asyncio
ID = "transformation:sample"
OLD_MODEL = "model:original"
NEW_MODEL = "model:selected"


@dataclass
class Boundaries:
    get: AsyncMock
    get_all: AsyncMock
    model_get: AsyncMock
    save: AsyncMock
    delete: AsyncMock
    generate: AsyncMock
    prompts: AsyncMock
    store_prompt: AsyncMock


@pytest.fixture
def io(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    data = Transformation(
        id=ID,
        name="summarize",
        title="摘要",
        description="Original description",
        prompt="Summarize",
        apply_default=True,
        model_id=OLD_MODEL,
    )

    async def make_id(item: Transformation) -> None:
        if item.id is None:
            item.id = ID

    save = AsyncMock(side_effect=make_id)

    async def save_boundary(item: Transformation) -> None:
        await save(item)

    b = Boundaries(
        get=AsyncMock(return_value=data),
        get_all=AsyncMock(return_value=[data]),
        model_get=AsyncMock(return_value=object()),
        save=save,
        delete=AsyncMock(),
        generate=AsyncMock(return_value={"output": "生成摘要"}),
        prompts=AsyncMock(
            return_value=DefaultPrompts(transformation_instructions=None)
        ),
        store_prompt=AsyncMock(),
    )
    for target, name, value in (
        (Transformation, "get", b.get),
        (Transformation, "get_all", b.get_all),
        (Transformation, "save", save_boundary),
        (Transformation, "delete", b.delete),
        (routes.Model, "get", b.model_get),
        (routes.transformation_graph, "ainvoke", b.generate),
        (DefaultPrompts, "get_instance", b.prompts),
        (DefaultPrompts, "update", b.store_prompt),
    ):
        monkeypatch.setattr(target, name, value)
    return b


async def test_list_and_detail_project_the_saved_transformation(io: Boundaries) -> None:
    (listed,) = await routes.get_transformations()
    detail = await routes.get_transformation(ID)
    assert (
        detail.model_dump()
        == listed.model_dump()
        == {
            "id": ID,
            "name": "summarize",
            "title": "摘要",
            "description": "Original description",
            "prompt": "Summarize",
            "apply_default": True,
            "model_id": OLD_MODEL,
            "created": "None",
            "updated": "None",
        }
    )
    io.get_all.assert_awaited_once_with(order_by="name asc")
    io.save.assert_not_awaited()


def create_request(model_id: str | None = None) -> TransformationCreate:
    return TransformationCreate(
        name="outline",
        title="提纲",
        description="",
        prompt="请生成提纲",
        model_id=model_id,
    )


@pytest.mark.parametrize("model_id", [None, NEW_MODEL])
async def test_create_persists_supplied_prompt_and_optional_model(
    io: Boundaries, model_id: str | None
) -> None:
    result = await routes.create_transformation(create_request(model_id))
    assert (result.id, result.name, result.title, result.prompt, result.model_id) == (
        ID,
        "outline",
        "提纲",
        "请生成提纲",
        model_id,
    )
    assert result.apply_default is False and result.description == ""
    io.save.assert_awaited_once()
    if model_id is None:
        io.model_get.assert_not_awaited()
    else:
        io.model_get.assert_awaited_once_with(model_id)


@pytest.mark.parametrize(
    ("patch", "description", "model", "lookup"),
    [
        ({}, "Original description", OLD_MODEL, None),
        ({"description": None}, "", OLD_MODEL, None),
        ({"description": ""}, "", OLD_MODEL, None),
        ({"description": "Changed", "model_id": None}, "Changed", None, None),
        ({"model_id": NEW_MODEL}, "Original description", NEW_MODEL, NEW_MODEL),
    ],
)
async def test_edit_distinguishes_omitted_and_explicit_clear(
    io: Boundaries,
    patch: dict[str, str | None],
    description: str,
    model: str | None,
    lookup: str | None,
) -> None:
    item = await routes.update_transformation(ID, TransformationUpdate(**patch))
    assert (item.id, item.description, item.model_id) == (ID, description, model)
    io.save.assert_awaited_once()
    if lookup:
        io.model_get.assert_awaited_once_with(lookup)
    else:
        io.model_get.assert_not_awaited()


async def test_edit_preserves_false_apply_default_and_updates_all_editor_fields(
    io: Boundaries,
) -> None:
    item = await routes.update_transformation(
        ID,
        TransformationUpdate(
            name="notes", title="笔记", prompt="Extract key claims", apply_default=False
        ),
    )
    assert (item.name, item.title, item.prompt, item.apply_default) == (
        "notes",
        "笔记",
        "Extract key claims",
        False,
    )
    assert item.model_id == OLD_MODEL
    io.save.assert_awaited_once()


@pytest.mark.parametrize(
    ("explicit", "stored", "used"),
    [
        (NEW_MODEL, OLD_MODEL, NEW_MODEL),
        (None, OLD_MODEL, OLD_MODEL),
        (None, None, None),
    ],
)
async def test_execution_returns_selected_model_and_exact_graph_output(
    io: Boundaries, explicit: str | None, stored: str | None, used: str | None
) -> None:
    selected = io.get.return_value
    selected.model_id = stored
    request = TransformationExecuteRequest(
        transformation_id=ID, input_text="资料正文", model_id=explicit
    )
    item = await routes.execute_transformation(request)
    assert item.model_dump() == {
        "output": "生成摘要",
        "transformation_id": ID,
        "model_id": used,
    }
    io.generate.assert_awaited_once_with(
        {"input_text": "资料正文", "transformation": selected},
        config={"configurable": {"model_id": used}},
    )
    if used:
        io.model_get.assert_awaited_once_with(used)
    else:
        io.model_get.assert_not_awaited()
    io.save.assert_not_awaited()


@pytest.mark.parametrize("action", ["create", "update", "execute"])
async def test_unknown_model_never_runs_or_persists_transformation(
    io: Boundaries, action: str
) -> None:
    io.model_get.return_value = None
    with pytest.raises(HTTPException) as caught:
        if action == "create":
            await routes.create_transformation(create_request(NEW_MODEL))
        elif action == "update":
            await routes.update_transformation(
                ID, TransformationUpdate(model_id=NEW_MODEL)
            )
        else:
            await routes.execute_transformation(
                TransformationExecuteRequest(
                    transformation_id=ID, input_text="text", model_id=NEW_MODEL
                )
            )
    assert (caught.value.status_code, caught.value.detail) == (404, "Model not found")
    io.save.assert_not_awaited()
    io.generate.assert_not_awaited()


@pytest.mark.parametrize("action", ["detail", "update", "execute", "delete"])
async def test_missing_transformation_stops_before_follow_up_operations(
    io: Boundaries, action: str
) -> None:
    io.get.return_value = None
    with pytest.raises(HTTPException) as caught:
        if action == "detail":
            await routes.get_transformation(ID)
        elif action == "update":
            await routes.update_transformation(
                ID, TransformationUpdate(model_id=NEW_MODEL)
            )
        elif action == "execute":
            await routes.execute_transformation(
                TransformationExecuteRequest(transformation_id=ID, input_text="text")
            )
        else:
            await routes.delete_transformation(ID)
    assert (caught.value.status_code, caught.value.detail) == (
        404,
        "Transformation not found",
    )
    io.model_get.assert_not_awaited()
    io.save.assert_not_awaited()
    io.delete.assert_not_awaited()
    io.generate.assert_not_awaited()


@pytest.mark.parametrize(
    "failure", [IncompleteGenerationError("Incomplete"), asyncio.CancelledError()]
)
async def test_execution_propagates_generation_failure_or_cancellation_without_replay(
    io: Boundaries, failure: BaseException
) -> None:
    io.generate.side_effect = failure
    with pytest.raises(type(failure)) as caught:
        await routes.execute_transformation(
            TransformationExecuteRequest(transformation_id=ID, input_text="text")
        )
    assert caught.value is failure
    io.generate.assert_awaited_once()


@pytest.mark.parametrize("text", [None, "默认说明"])
async def test_default_prompt_returns_literal_saved_text_or_empty_string(
    io: Boundaries, text: str | None
) -> None:
    io.prompts.return_value.transformation_instructions = text
    assert (await routes.get_default_prompt()).transformation_instructions == (
        text or ""
    )
    io.store_prompt.assert_not_awaited()


@pytest.mark.parametrize("text", ["新默认说明", ""])
async def test_default_prompt_update_saves_user_value_including_explicit_clear(
    io: Boundaries, text: str
) -> None:
    item = await routes.update_default_prompt(
        DefaultPromptUpdate(transformation_instructions=text)
    )
    assert item.transformation_instructions == text
    assert io.prompts.return_value.transformation_instructions == text
    io.store_prompt.assert_awaited_once()


async def test_delete_returns_success_after_deletion(io: Boundaries) -> None:
    assert await routes.delete_transformation(ID) == {
        "message": "Transformation deleted successfully"
    }
    io.delete.assert_awaited_once()


async def test_delete_propagates_typed_storage_failure(io: Boundaries) -> None:
    failure = DatabaseOperationError("Synthetic deletion error")
    io.delete.side_effect = failure
    with pytest.raises(DatabaseOperationError) as caught:
        await routes.delete_transformation(ID)
    assert caught.value is failure
