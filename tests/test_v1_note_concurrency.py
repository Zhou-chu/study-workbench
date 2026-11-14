"""Strict conditional-note public contract (no database/network)."""

import importlib

import pytest
from pydantic import ValidationError


def contracts():
    return importlib.import_module("api.personal_contracts")


@pytest.mark.parametrize("bad", [True, 1.0, "1", 0, -1])
def test_expected_revision_is_strict_positive_integer(bad):
    from api.models import NoteUpdate

    with pytest.raises(ValidationError):
        NoteUpdate(content="draft", expected_revision=bad)


@pytest.mark.parametrize("revision", [None, 1, 7])
def test_personal_update_contract(revision):
    model = contracts().NoteUpdateRequest(content="draft", expected_revision=revision)
    assert model.expected_revision == revision
    assert (
        "expected_revision"
        not in contracts().NoteCreateRequest(content="draft").model_dump()
    )


def test_write_mode_defaults_legacy_and_rejects_invalid(monkeypatch):
    from open_notebook import config

    monkeypatch.delenv("STUDY_WORKBENCH_NOTE_WRITE_MODE", raising=False)
    assert config.get_note_write_mode() == "legacy_single_web"
    monkeypatch.setenv("STUDY_WORKBENCH_NOTE_WRITE_MODE", "typo")
    from open_notebook.exceptions import ConfigurationError

    with pytest.raises(ConfigurationError):
        config.get_note_write_mode()
