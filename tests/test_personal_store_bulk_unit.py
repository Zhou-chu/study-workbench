"""Direct PersonalStore bulk-read behavior with an in-memory SQL boundary.

No router, EvidenceService, filesystem, database or network is exercised.
"""

import hashlib
from copy import deepcopy

import pytest

from api.personal_store import PersonalStore


def physical(kind, identity):
    return f"v1_{kind}:" + hashlib.sha256(identity.encode()).hexdigest()


class PhysicalQueries:
    def __init__(self):
        self.rows = {}
        self.calls = []

    def put(self, kind, identity, payload):
        key = physical(kind, identity)
        self.rows[key] = {
            "id": key,
            "app_id": "untrusted",
            "payload": deepcopy(payload),
        }

    async def query(self, sql, variables=None):
        variables = variables or {}
        self.calls.append((sql, deepcopy(variables)))
        if sql == "SELECT payload FROM $target;":
            row = self.rows.get(str(variables["target"]))
            return (
                [
                    {
                        key: deepcopy(value)
                        for key, value in row.items()
                        if key == "payload"
                    }
                ]
                if row
                else []
            )
        assert sql == "SELECT id, payload FROM $targets;"
        targets = variables["targets"]
        assert 0 < len(targets) <= 128
        assert len({str(target) for target in targets}) == len(targets)
        return [
            {
                key: deepcopy(value)
                for key, value in self.rows[str(target)].items()
                if key in ("id", "payload")
            }
            for target in reversed(targets)
            if str(target) in self.rows
        ]


@pytest.fixture
def reader(monkeypatch):
    import api.personal_store as store_module

    queries = PhysicalQueries()
    monkeypatch.setattr(store_module, "repo_query", queries.query)
    return queries, None


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 1, 128, 129, 257])
async def test_store_bulk_read_bounds_queries_and_keeps_raw_missing_values(
    reader, count
):
    queries, _ = reader
    identities = [f"ev_{index}" for index in range(count)]
    if count:
        queries.put("evidence", identities[0], {"evidence_id": "spoof"})
    values = await PersonalStore().get_many("evidence", identities + identities)
    assert list(values) == identities
    if count:
        assert values[identities[0]] == {
            "id": physical("evidence", identities[0]),
            "payload": {"evidence_id": "spoof"},
        }
        assert all(values[identity] is None for identity in identities[1:])
    assert len(queries.calls) == (count + 127) // 128


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,identities",
    [("credential", []), ("evidence", [None]), ("evidence", ["x" * 513])],
)
async def test_store_bulk_rejects_invalid_inputs_without_query(
    reader, kind, identities
):
    queries, _ = reader
    with pytest.raises(ValueError):
        await PersonalStore().get_many(kind, identities)
    assert queries.calls == []
