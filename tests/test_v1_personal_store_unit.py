"""Direct logical-unit cases extracted without changing assertions or parameters."""

import pytest


@pytest.mark.asyncio
async def test_store_rejects_unknown_kind_before_database():
    from api.personal_store import PersonalStore

    with pytest.raises(ValueError):
        await PersonalStore().get("credential", "x")


def test_record_identity_stable_and_kind_separated():
    from api.personal_store import record_key

    # Golden SHA256("x") protocol vector: a constant or altered encoding fails.
    digest = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"
    assert record_key("version", "x") == f"v1_version:{digest}"
    assert record_key("evidence", "x") == f"v1_evidence:{digest}"
    assert record_key("version", "y") != f"v1_version:{digest}"
