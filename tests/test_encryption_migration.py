"""Actual cipher and migration service collaboration over synthetic repository rows."""

import pytest
from encryption_test_fixtures import _legacy_token
from encryption_test_fixtures import enc_key as _enc_key
from encryption_test_fixtures import fast_kdf as _fast_kdf

from open_notebook.utils import encryption as enc
from open_notebook.utils.encryption import decrypt_value, encrypt_value

enc_key = _enc_key
fast_kdf = _fast_kdf


class _FakeDB:
    """In-memory stand-in for the repository layer (no SurrealDB needed)."""

    def __init__(self, credentials, singleton):
        self.credentials = [dict(r) for r in credentials]
        self.singleton = dict(singleton) if singleton is not None else None
        self.updates = []
        self.upserts = []

    async def query(self, query_str, vars=None):
        if "FROM credential" in query_str:
            return [dict(r) for r in self.credentials]
        if "ONLY $record_id" in query_str:
            return [dict(self.singleton)] if self.singleton is not None else []
        raise AssertionError(f"unexpected query: {query_str}")

    async def update(self, table, record_id, data):
        self.updates.append((table, str(record_id), dict(data)))
        for row in self.credentials:
            if str(row.get("id")) == str(record_id):
                row.update(data)
        return []

    async def upsert(self, table, record_id, data):
        self.upserts.append((table, str(record_id), dict(data)))
        if self.singleton is not None:
            self.singleton.update(data)
        return []


@pytest.fixture()
def patch_repo(monkeypatch):
    """Patch the repository boundary; each test supplies its own fake."""
    import open_notebook.database.repository as repo

    def install(fake):
        monkeypatch.setattr(repo, "repo_query", fake.query)
        monkeypatch.setattr(repo, "repo_update", fake.update)
        monkeypatch.setattr(repo, "repo_upsert", fake.upsert)
        return fake

    return install


def _singleton(entries):
    """A raw provider_configs row holding nested credential entries."""
    return {"id": "open_notebook:provider_configs", "credentials": entries}


@pytest.mark.asyncio
async def test_pass_migrates_legacy_rows(patch_repo, fast_kdf):
    """Legacy rows are rewritten marked; verified rows are skipped."""
    from api.credentials_service import migrate_encryption_scheme

    legacy = _legacy_token("sk-legacy")
    marked = encrypt_value("sk-new")
    fake = patch_repo(
        _FakeDB(
            [
                {"id": "credential:one", "api_key": legacy},
                {"id": "credential:two", "api_key": marked},
                {"id": "credential:three", "api_key": None},
                {"id": "credential:four", "api_key": ""},
            ],
            _singleton({}),
        )
    )

    result = await migrate_encryption_scheme()

    assert result["migrated"] == ["credential:one"]
    assert sorted(result["skipped"]) == [
        "credential:four: empty",
        "credential:three: empty",
        "credential:two: already-migrated",
    ]
    assert result["errors"] == []
    rewritten = next(r for r in fake.credentials if r["id"] == "credential:one")
    assert rewritten["api_key"].startswith(enc.PBKDF2_MARKER)
    assert decrypt_value(rewritten["api_key"]) == "sk-legacy"


@pytest.mark.asyncio
async def test_pass_is_fail_closed_per_record(patch_repo, fast_kdf):
    """Corrupt rows are reported and left byte-identical; the pass continues."""
    from api.credentials_service import migrate_encryption_scheme

    corrupt = enc.PBKDF2_MARKER + "aGk="
    before = {"id": "credential:bad", "api_key": corrupt}
    fake = patch_repo(
        _FakeDB(
            [
                dict(before),
                {"id": "credential:good", "api_key": _legacy_token("sk-ok")},
            ],
            _singleton({}),
        )
    )

    result = await migrate_encryption_scheme()

    assert result["migrated"] == ["credential:good"]
    assert len(result["errors"]) == 1
    assert result["errors"][0].startswith("credential:bad:")
    assert "sk-" not in result["errors"][0]
    untouched = next(r for r in fake.credentials if r["id"] == "credential:bad")
    assert untouched["api_key"] == corrupt
    assert [u[1] for u in fake.updates] == ["credential:good"]


@pytest.mark.asyncio
async def test_pass_is_idempotent(patch_repo, fast_kdf):
    """A second run over a migrated corpus changes nothing and errors nothing."""
    from api.credentials_service import migrate_encryption_scheme

    patch_repo(
        _FakeDB(
            [{"id": "credential:one", "api_key": _legacy_token("sk-legacy")}],
            _singleton({}),
        )
    )
    first = await migrate_encryption_scheme()
    assert first["migrated"] == ["credential:one"]

    second = await migrate_encryption_scheme()
    assert second["migrated"] == []
    assert second["errors"] == []
    assert second["skipped"] == ["credential:one: already-migrated"]


@pytest.mark.asyncio
async def test_pass_migrates_singleton_entries(patch_repo, fast_kdf):
    """Nested provider_configs entries migrate in one rewrite; bad ones stay."""
    from api.credentials_service import migrate_encryption_scheme

    fake = patch_repo(
        _FakeDB(
            [],
            _singleton(
                {
                    "openai": [
                        {"name": "Default", "api_key": _legacy_token("sk-nested")},
                        {"name": "Broken", "api_key": enc.PBKDF2_MARKER + "aGk="},
                    ]
                }
            ),
        )
    )
    result = await migrate_encryption_scheme()

    assert result["migrated"] == ["provider_configs/openai/Default"]
    assert len(result["errors"]) == 1
    assert result["errors"][0].startswith("provider_configs/openai/Broken:")
    assert len(fake.upserts) == 1
    entries = fake.upserts[0][2]["credentials"]["openai"]
    assert decrypt_value(entries[0]["api_key"]) == "sk-nested"
    assert entries[1]["api_key"] == enc.PBKDF2_MARKER + "aGk="


@pytest.mark.asyncio
async def test_pass_requires_encryption_key(patch_repo, monkeypatch):
    """Without a configured key the pass fails closed before touching rows."""
    from api.credentials_service import migrate_encryption_scheme

    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE", raising=False)
    monkeypatch.setattr(enc, "_ENCRYPTION_KEY", None)
    monkeypatch.setattr(enc, "_FERNET", None)
    monkeypatch.setattr(enc, "_FERNET_LEGACY", None)
    fake = patch_repo(_FakeDB([{"id": "credential:one", "api_key": "x"}], None))

    with pytest.raises(ValueError):
        await migrate_encryption_scheme()
    assert fake.updates == [] and fake.upserts == []


@pytest.mark.asyncio
async def test_pass_reports_placeholder_rows(patch_repo, fast_kdf):
    """UNDECRYPTABLE markers are reported, never re-encrypted into keys."""
    from api.credentials_service import migrate_encryption_scheme

    fake = patch_repo(
        _FakeDB(
            [{"id": "credential:one", "api_key": "UNDECRYPTABLE"}],
            _singleton({"openai": [{"name": "Default", "api_key": "UNDECRYPTABLE"}]}),
        )
    )
    result = await migrate_encryption_scheme()

    assert result["migrated"] == []
    assert result["errors"] == [
        "credential:one: decrypt-placeholder",
        "provider_configs/openai/Default: decrypt-placeholder",
    ]
    assert fake.credentials[0]["api_key"] == "UNDECRYPTABLE"
    assert fake.updates == [] and fake.upserts == []


@pytest.mark.asyncio
async def test_pass_reports_wrong_key_legacy_row(patch_repo, fast_kdf):
    """A legacy row encrypted under another key fails closed; others migrate."""
    from api.credentials_service import migrate_encryption_scheme

    foreign = _legacy_token("sk-foreign", passphrase="another-passphrase")
    fake = patch_repo(
        _FakeDB(
            [
                {"id": "credential:bad", "api_key": foreign},
                {"id": "credential:good", "api_key": _legacy_token("sk-ok")},
            ],
            _singleton({}),
        )
    )
    result = await migrate_encryption_scheme()

    assert result["migrated"] == ["credential:good"]
    assert result["errors"] == ["credential:bad: undecryptable-legacy"]
    untouched = next(r for r in fake.credentials if r["id"] == "credential:bad")
    assert untouched["api_key"] == foreign


@pytest.mark.asyncio
async def test_pass_reports_malformed_singleton_entries(patch_repo, fast_kdf):
    """Non-list groups and non-dict entries are errors, never silent skips."""
    from api.credentials_service import migrate_encryption_scheme

    fake = patch_repo(
        _FakeDB(
            [],
            _singleton(
                {
                    "openai": "corrupt-group",
                    "anthropic": [
                        None,
                        {
                            "name": "Ok",
                            "api_key": _legacy_token("sk-ok"),
                        },
                    ],
                }
            ),
        )
    )
    result = await migrate_encryption_scheme()

    assert result["migrated"] == ["provider_configs/anthropic/Ok"]
    assert result["errors"] == [
        "provider_configs/openai: unexpected-group-type",
        "provider_configs/anthropic/0: unexpected-entry-type",
    ]
    assert len(fake.upserts) == 1


@pytest.mark.asyncio
async def test_pass_reports_write_failures(patch_repo, fast_kdf, monkeypatch):
    """Failed writes are errors, the pass continues, counts stay truthful."""
    import open_notebook.database.repository as repo
    from api.credentials_service import migrate_encryption_scheme

    patch_repo(
        _FakeDB(
            [{"id": "credential:one", "api_key": _legacy_token("sk-legacy")}],
            _singleton(
                {"openai": [{"name": "Default", "api_key": _legacy_token("sk-n")}]}
            ),
        )
    )

    async def boom_update(table, record_id, data):
        raise RuntimeError("db down")

    async def boom_upsert(table, record_id, data):
        raise RuntimeError("db down")

    monkeypatch.setattr(repo, "repo_update", boom_update)
    monkeypatch.setattr(repo, "repo_upsert", boom_upsert)

    result = await migrate_encryption_scheme()

    assert result["migrated"] == []
    assert result["errors"] == [
        "credential:one: write-failed",
        "provider_configs/openai/Default: write-failed",
    ]
