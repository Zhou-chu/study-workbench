"""Static selection contract for historical database fixtures."""

from scripts import historical_database_pytest as runner


def test_selection_is_bounded():
    assert len(runner.TESTS) == 5
    assert all(path.startswith("tests/test_") for path in runner.TESTS)
    assert (
        "::test_real_surreal_sqlite_and_originals_restore_into_fresh_environment"
        in runner.TESTS[3]
    )
