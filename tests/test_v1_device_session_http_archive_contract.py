"""Auth persistence tables are excluded from the personal archive contract."""


def test_auth_tables_are_not_personal_archive_kinds():
    from api.personal_store import KINDS
    from api.portable_service import PERSONAL_KINDS

    auth_tables = {"auth_session", "auth_access", "auth_session_guard"}
    assert auth_tables.isdisjoint(KINDS)
    assert auth_tables.isdisjoint(PERSONAL_KINDS)
