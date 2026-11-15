"""Transaction acknowledgement logic with an in-memory connection boundary."""

import pytest

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("response", [{"result": []}, {"result": [{"status": "OK"}]}])
async def test_missing_transaction_ack_is_unknown(monkeypatch, response):
    from contextlib import asynccontextmanager

    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import NoteCommitOutcomeUnknown

    class Connection:
        async def query_raw(self, *args):
            return response

    @asynccontextmanager
    async def connection():
        yield Connection()

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(NoteCommitOutcomeUnknown):
        await repo._transaction("RETURN 1;", {})
