"""Direct retrieval admission before repository/lock/content work."""

import pytest
from test_workbench_hybrid_retrieval import NB
from test_workbench_hybrid_retrieval import h as _h

from open_notebook.exceptions import InvalidInputError

h = _h


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query,kwargs",
    [
        ("", {}),
        ("  ", {}),
        ("x" * 50001, {}),
        ("Solar", {"limit": 0}),
        ("Solar", {"limit": 101}),
        ("Solar", {"limit": True}),
        ("Solar", {"mode": "semantic"}),
        ("Solar", {"mode": "hybrid", "profile_id": None}),
        ("Solar", {"mode": "lexical", "profile_id": "chosen"}),
    ],
)
async def test_invalid_request_combinations_reject_before_any_io(h, query, kwargs):
    args = {"mode": "hybrid", "profile_id": "chosen"}
    args.update(kwargs)
    with pytest.raises(InvalidInputError):
        await h.service.retrieve(query, NB, ["v1"], **args)
    assert h.store.reads == h.provider.calls == h.db.calls == []


@pytest.mark.asyncio
async def test_invalid_unicode_query_is_sanitized_before_io(h):
    with pytest.raises(InvalidInputError, match="RETRIEVAL_QUERY_INVALID"):
        await h.retrieve("\ud800")
    assert h.store.reads == h.provider.calls == h.db.calls == []


@pytest.mark.asyncio
async def test_twenty_source_limit_rejects_before_content_and_model(h):
    with pytest.raises(InvalidInputError, match="SOURCE_LIMIT"):
        await h.retrieve(ids=[f"v{i}" for i in range(21)])
    assert h.store.reads == h.provider.calls == []
