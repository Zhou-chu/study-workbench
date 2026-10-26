"""Live link identity, physical PersonalStore keys and inactive archive boundaries."""

from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from api.notebooklm_service import get_notebooklm_service
from api.personal_service import PersonalService
from api.personal_store import PersonalStore, record_key
from api.routers import evidence, notebooklm
from open_notebook.exceptions import InvalidInputError

NOTEBOOK = "notebook:synthetic"
# Independently checked against the existing route's UUID5/NAMESPACE_URL identity.
LINK = "link_049a5990-9206-58e5-96eb-233512c8f131"
STAMP = "2026-10-26T00:00:00+00:00"
SENTINEL = "private-sentinel-do-not-echo"


def live(**updates):
    return {
        "link_id": LINK,
        "notebook_id": NOTEBOOK,
        "connection_id": "notebooklm",
        "remote_notebook_id": "remote-current",
        "last_checked_at": STAMP,
        "future_metadata": {"opaque": [None, "retained"]},
        **updates,
    }


@pytest.fixture
def physical(monkeypatch):
    """Fake only the SQL/remote boundaries; keep store hashing/envelopes real."""
    rows = {}
    events: list[tuple[str, Any]] = []
    held = []

    async def query(sql, args=None):
        if sql.startswith("UPSERT"):
            events.append(("put", str(args["target"])))
            rows[str(args["target"])] = deepcopy(args["value"])
            return []
        if sql == "SELECT payload FROM $target;":
            events.append(("get", str(args["target"])))
            row = rows.get(str(args["target"]))
            return [deepcopy(row)] if row is not None else []
        if sql == "SELECT id, payload FROM $targets;":
            targets = args["targets"]
            events.append(("get_many", tuple(str(target) for target in targets)))
            return [
                {"id": target, **deepcopy(rows[str(target)])}
                for target in reversed(targets)
                if str(target) in rows
            ]
        if sql.startswith("SELECT payload FROM v1_"):
            kind = sql.split("FROM ")[1].rstrip(";")
            assert kind != "v1_link", "Link reads must never scan historical rows"
            return [deepcopy(v) for k, v in rows.items() if k.startswith(kind + ":")]
        pytest.fail(f"Unexpected SQL: {sql}")

    @asynccontextmanager
    async def lock(identity):
        events.append(("lock", identity))
        held.append(identity)
        try:
            yield
        finally:
            held.pop()
            events.append(("unlock", identity))

    async def get_notebook(identity):
        assert identity == NOTEBOOK
        events.append(("notebook", identity))

        async def sources():
            return []

        return SimpleNamespace(id=identity, name="Synthetic", get_sources=sources)

    async def notes(identity):
        assert identity == NOTEBOOK
        return []

    async def ensure_connection():
        assert not held, "Remote verification must remain outside the project lock"
        events.append(("connection", "notebooklm"))

    async def all_sources(identity):
        assert not held, "Remote verification must remain outside the project lock"
        events.append(("remote", identity))
        return []

    monkeypatch.setattr("api.personal_store.repo_query", query)
    monkeypatch.setattr(notebooklm.Notebook, "get", get_notebook)
    monkeypatch.setattr(
        "open_notebook.database.note_repository.read_project_notes_locked", notes
    )
    monkeypatch.setattr(notebooklm, "now", lambda: STAMP)
    store = PersonalStore()
    monkeypatch.setattr(store, "project_lock", lock)
    service = PersonalService(store=store)
    remote = SimpleNamespace(
        store=store, _ensure_connection=ensure_connection, all_sources=all_sources
    )
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    app = FastAPI()
    app.include_router(notebooklm.router, prefix="/api")
    app.include_router(evidence.router, prefix="/api")
    app.dependency_overrides[get_notebooklm_service] = lambda: remote
    return SimpleNamespace(
        store=store, service=service, remote=remote, rows=rows, events=events, app=app
    )


async def workspace_link(physical):
    before = deepcopy(physical.rows)
    physical.events.clear()
    try:
        return (await physical.service.workspace(NOTEBOOK))["link"]
    finally:
        assert physical.rows == before, "Workspace link resolution must be read-only"
        assert [e for e in physical.events if e[0] == "get_many"] == [
            ("get_many", (record_key("link", LINK), record_key("link", NOTEBOOK)))
        ]
        assert not any(
            e[0] == "get" and e[1].startswith("v1_link:") for e in physical.events
        )


@pytest.mark.asyncio
async def test_actual_link_route_is_visible_through_physical_store_and_workspace_wire(
    physical,
):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=physical.app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/personal/notebooks/{NOTEBOOK}/notebooklm-link",
            json={"remote_notebook_id": "remote-current"},
        )
        assert response.status_code == 200
        record = response.json()
        assert record == {
            "link_id": LINK,
            "notebook_id": NOTEBOOK,
            "connection_id": "notebooklm",
            "remote_notebook_id": "remote-current",
            "last_checked_at": STAMP,
        }
        assert physical.events == [
            ("notebook", NOTEBOOK),
            ("connection", "notebooklm"),
            ("remote", "remote-current"),
            ("lock", NOTEBOOK),
            ("put", record_key("link", LINK)),
            ("unlock", NOTEBOOK),
        ]
        assert physical.rows[record_key("link", LINK)] == {
            "app_id": LINK,
            "payload": record,
        }
        assert record_key("link", NOTEBOOK) not in physical.rows
        record["future_metadata"] = {"opaque": [None, "retained"]}
        await physical.store.put("link", LINK, record)
        before = deepcopy(physical.rows)
        response = await client.get(f"/api/personal/notebooks/{NOTEBOOK}/workspace")
    assert response.status_code == 200
    assert response.json()["link"] == record
    assert physical.rows == before


@pytest.mark.asyncio
async def test_no_link_reads_one_two_identity_batch_and_returns_none(physical):
    assert await workspace_link(physical) is None


@pytest.mark.asyncio
async def test_random_restored_rows_are_never_selected_or_mutated(physical):
    await physical.store.put(
        "link",
        "link_restored-random",
        live(link_id="link_restored-random", requires_rebind=True),
    )
    assert await workspace_link(physical) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("placement", ["canonical", "legacy"])
@pytest.mark.parametrize("payload", [{"payload": None}, {}], ids=["null", "absent"])
async def test_physical_null_or_missing_payload_is_invalid_not_absence(
    physical, placement, payload
):
    identity = LINK if placement == "canonical" else NOTEBOOK
    physical.rows[record_key("link", identity)] = {"app_id": identity, **payload}
    if placement == "canonical":
        await physical.store.put(
            "link", NOTEBOOK, live(remote_notebook_id="remote-old")
        )
    with pytest.raises(InvalidInputError, match="^NOTEBOOKLM_LINK_INVALID$"):
        await workspace_link(physical)


@pytest.mark.asyncio
@pytest.mark.parametrize("placement", ["canonical", "legacy", "both"])
async def test_valid_live_link_is_lossless_and_identical_targets_are_not_a_conflict(
    physical, placement
):
    record = live(requires_rebind=False, restored_history=False, replay_allowed=True)
    legacy = {k: v for k, v in record.items() if k not in ("link_id", "connection_id")}
    if placement in ("canonical", "both"):
        await physical.store.put("link", LINK, record)
    if placement in ("legacy", "both"):
        await physical.store.put("link", NOTEBOOK, legacy)
    assert await workspace_link(physical) == (
        legacy if placement == "legacy" else record
    )


@pytest.mark.asyncio
async def test_active_different_legacy_target_is_a_fixed_conflict(physical):
    await physical.store.put("link", LINK, live())
    await physical.store.put("link", NOTEBOOK, live(remote_notebook_id=SENTINEL))
    with pytest.raises(InvalidInputError, match="^NOTEBOOKLM_LINK_CONFLICT$") as error:
        await workspace_link(physical)
    assert SENTINEL not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("placement", ["canonical", "legacy"])
@pytest.mark.parametrize(
    "update,code",
    [
        ({"notebook_id": SENTINEL}, "NOTEBOOKLM_LINK_OWNER_MISMATCH"),
        ({"notebook_id": None}, "NOTEBOOKLM_LINK_OWNER_MISMATCH"),
        ({"link_id": SENTINEL}, "NOTEBOOKLM_LINK_INVALID"),
        ({"link_id": None}, "NOTEBOOKLM_LINK_INVALID"),
        ({"connection_id": SENTINEL}, "NOTEBOOKLM_LINK_INVALID"),
        ({"connection_id": None}, "NOTEBOOKLM_LINK_INVALID"),
        ({"remote_notebook_id": None}, "NOTEBOOKLM_LINK_INVALID"),
        ({"remote_notebook_id": ""}, "NOTEBOOKLM_LINK_INVALID"),
        ({"remote_notebook_id": "  "}, "NOTEBOOKLM_LINK_INVALID"),
        ({"remote_notebook_id": 7}, "NOTEBOOKLM_LINK_INVALID"),
    ],
)
async def test_bad_keyed_records_fail_closed_without_echoing_values(
    physical, placement, update, code
):
    await physical.store.put(
        "link", LINK if placement == "canonical" else NOTEBOOK, live(**update)
    )
    with pytest.raises(InvalidInputError, match=f"^{code}$") as error:
        await workspace_link(physical)
    assert SENTINEL not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["link_id", "connection_id", "last_checked_at"])
async def test_canonical_record_requires_current_route_fields(physical, field):
    record = live()
    record.pop(field)
    await physical.store.put("link", LINK, record)
    with pytest.raises(InvalidInputError, match="^NOTEBOOKLM_LINK_INVALID$"):
        await workspace_link(physical)


@pytest.mark.asyncio
@pytest.mark.parametrize("placement", ["canonical", "legacy"])
@pytest.mark.parametrize("value", [[], "corrupt", False, 17])
async def test_non_object_payload_is_invalid_not_no_link(physical, placement, value):
    identity = LINK if placement == "canonical" else NOTEBOOK
    physical.rows[record_key("link", identity)] = {"app_id": identity, "payload": value}
    with pytest.raises(InvalidInputError, match="^NOTEBOOKLM_LINK_INVALID$"):
        await workspace_link(physical)


INACTIVE_FALSE_VALUES: tuple[Any, ...] = (True, None, "false", 0, 1, [], {})
INACTIVE_TRUE_VALUES: tuple[Any, ...] = (False, None, "true", 0, 1, [], {})
INACTIVE = (
    [
        {field: value}
        for field in ("requires_rebind", "restored_history")
        for value in INACTIVE_FALSE_VALUES
    ]
    + [{"replay_allowed": value} for value in INACTIVE_TRUE_VALUES]
    + [
        {field: value}
        for field in ("origin", "verification_origin")
        for value in ("restored_archive", "restored_history")
    ]
)


@pytest.mark.asyncio
@pytest.mark.parametrize("marker", INACTIVE)
@pytest.mark.parametrize("placement", ["canonical", "legacy"])
async def test_history_and_non_boolean_activity_markers_never_activate(
    physical, placement, marker
):
    await physical.store.put(
        "link",
        LINK if placement == "canonical" else NOTEBOOK,
        live(mapping_status="verified", remote_status="available", **marker),
    )
    assert await workspace_link(physical) is None


@pytest.mark.asyncio
async def test_inactive_canonical_prevents_legacy_resurrection(physical):
    await physical.store.put("link", LINK, live(requires_rebind=True))
    await physical.store.put("link", NOTEBOOK, live(remote_notebook_id="remote-old"))
    assert await workspace_link(physical) is None


@pytest.mark.asyncio
async def test_active_canonical_ignores_valid_inactive_legacy_target(physical):
    current = live()
    await physical.store.put("link", LINK, current)
    await physical.store.put(
        "link", NOTEBOOK, live(remote_notebook_id="remote-old", requires_rebind=True)
    )
    assert await workspace_link(physical) == current


@pytest.mark.asyncio
async def test_active_canonical_does_not_hide_invalid_legacy_record(physical):
    await physical.store.put("link", LINK, live())
    await physical.store.put(
        "link", NOTEBOOK, live(notebook_id=SENTINEL, requires_rebind=True)
    )
    with pytest.raises(InvalidInputError, match="^NOTEBOOKLM_LINK_OWNER_MISMATCH$"):
        await workspace_link(physical)


@pytest.mark.asyncio
@pytest.mark.parametrize("exact_history", ["canonical", "legacy"])
async def test_explicit_relink_restores_visibility_without_deleting_history(
    physical, exact_history
):
    historical = live(remote_notebook_id="remote-archived", requires_rebind=True)
    historical_id = LINK if exact_history == "canonical" else NOTEBOOK
    await physical.store.put("link", historical_id, historical)
    random_history = live(link_id="link_random-restored", requires_rebind=True)
    await physical.store.put("link", "link_random-restored", random_history)
    assert await workspace_link(physical) is None
    physical.events.clear()
    linked = await notebooklm.link_notebook(
        NOTEBOOK,
        notebooklm.LinkRequest(remote_notebook_id="remote-new"),
        physical.remote,
    )
    assert physical.events == [
        ("notebook", NOTEBOOK),
        ("connection", "notebooklm"),
        ("remote", "remote-new"),
        ("lock", NOTEBOOK),
        ("put", record_key("link", LINK)),
        ("unlock", NOTEBOOK),
    ]
    assert await workspace_link(physical) == linked
    assert await physical.store.get("link", "link_random-restored") == random_history
    if exact_history == "legacy":
        assert await physical.store.get("link", NOTEBOOK) == historical


@pytest.mark.asyncio
@pytest.mark.parametrize("step", ["notebook", "connection", "remote"])
async def test_remote_verification_failure_never_changes_retained_links(
    physical, monkeypatch, step
):
    await physical.store.put("link", LINK, live(requires_rebind=True))
    before = deepcopy(physical.rows)
    physical.events.clear()

    async def fail(*_):
        raise InvalidInputError("synthetic verification failed")

    if step == "notebook":
        monkeypatch.setattr(notebooklm.Notebook, "get", fail)
    else:
        monkeypatch.setattr(
            physical.remote,
            "_ensure_connection" if step == "connection" else "all_sources",
            fail,
        )
    with pytest.raises(InvalidInputError, match="synthetic verification failed"):
        await notebooklm.link_notebook(
            NOTEBOOK,
            notebooklm.LinkRequest(remote_notebook_id="remote-new"),
            physical.remote,
        )
    assert physical.rows == before
    assert all(event[0] not in ("put", "lock") for event in physical.events)
    assert (
        physical.events
        == {
            "notebook": [],
            "connection": [("notebook", NOTEBOOK)],
            "remote": [("notebook", NOTEBOOK), ("connection", "notebooklm")],
        }[step]
    )
