"""Direct portable root configuration and note revision normalization."""

import pytest

from api.portable_service import PortableService
from open_notebook.exceptions import InvalidInputError


def test_default_constructor_resolves_configured_data_root(tmp_path, monkeypatch):
    configured = tmp_path / "configured-root"
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(configured))
    service = PortableService()
    assert service.root == configured.resolve()


@pytest.mark.parametrize(
    "native,snapshot,wanted", [(None, None, 1), (1, None, 1), (None, 1, 1), (7, 7, 7)]
)
def test_portable_note_revision_normalization(native, snapshot, wanted):
    from api.portable_service import normalize_note_revisions

    notes = [{"id": "note:one"}]
    snapshots = [{"note_id": "note:one"}]
    if native is not None:
        notes[0]["revision"] = native
    if snapshot is not None:
        snapshots[0]["revision"] = snapshot
    normalize_note_revisions(notes, snapshots)
    assert notes[0]["revision"] == snapshots[0]["revision"] == wanted


@pytest.mark.parametrize(
    "native,snapshot",
    [(True, 1), (1.0, 1), ("1", 1), (0, 1), (-1, 1), (7, 6), (None, 7), (7, None)],
)
def test_portable_rejects_bad_or_mismatched_note_revision(native, snapshot):
    from api.portable_service import normalize_note_revisions

    notes = [{"id": "note:one"}]
    snapshots = [{"note_id": "note:one"}]
    if native is not None:
        notes[0]["revision"] = native
    if snapshot is not None:
        snapshots[0]["revision"] = snapshot
    with pytest.raises(InvalidInputError):
        normalize_note_revisions(notes, snapshots)
