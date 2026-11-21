from pathlib import Path

from scripts.v1 import browser_check


def test_obsolete_ui_contracts_are_not_used():
    source = Path(browser_check.__file__).read_text()
    for stale in (
        "main main",
        "p[title]",
        'name="对话"',
        "classList.add('dark')",
        'get_by_text("StudyWorkbench"',
    ):
        assert stale not in source, stale
    assert "source_version_ids" in source
    assert 'get_by_role("article")' in source
