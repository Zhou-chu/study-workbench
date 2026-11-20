"""Offline storage-boundary contracts; fake RPCs do not prove SurrealQL execution."""

import hashlib
import importlib
import json
from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock

import pytest

from open_notebook.domain.evidence_retrieval import EmbeddingProfile


def profile(**changes):
    return EmbeddingProfile(
        profile_id="chosen",
        model_id="model:pinned",
        provider="ollama",
        model_name="explicit",
        revision="r1",
        endpoint="http://127.0.0.1:11434",
        credential_binding_id="credential:pinned",
        dimension=2,
        document_prefix="",
        query_prefix="",
        preprocessing_revision="evidence-identity-v1",
        max_input_bytes=1000,
        cosine_min_score=0.4,
        destination_descriptor_version="v1",
        **changes,
    )


class FakeDatabase:
    def __init__(self):
        self.calls = []
        self.notebook = True
        self.members = {"source:one", "source:two"}
        self.versions = {
            "v1": {
                "source_version_id": "v1",
                "source_id": "source:one",
                "notebook_id": "notebook:allowed",
                "status": "ready",
                "current_extraction_id": "ex1",
            },
            "v2": {
                "source_version_id": "v2",
                "source_id": "source:two",
                "notebook_id": "notebook:allowed",
                "status": "partial",
                "current_extraction_id": "ex2",
            },
        }
        self.extractions: dict[str, dict[str, Any]] = {
            f"ex{i}": {
                "extraction_id": f"ex{i}",
                "source_version_id": f"v{i}",
                "notebook_id": "notebook:allowed",
                "status": "ready",
                "parser_name": "utf8",
                "parser_version": "1",
                "schema_version": 1,
                "evidence_ids": [f"ev{i}"],
            }
            for i in (1, 2)
        }
        self.epochs = {}
        self.manifests = []
        self.vectors = []
        self.attempts = {}
        self.raw_override = ...
        self.metadata_count = None
        self.cleanup_fails = False
        self.drift_payload = False
        self.payload_returned = []

    async def query(self, sql, params=None):
        params = params or {}
        self.calls.append((sql, deepcopy(params)))
        if "scope-notebook" in sql:
            return [{"id": "notebook:allowed"}] if self.notebook else []
        if "scope-versions" in sql:
            return [
                {
                    **deepcopy(v),
                    "id": f"v1_version:{hashlib.sha256(k.encode()).hexdigest()}",
                }
                for k, v in self.versions.items()
                if k in params["version_ids"]
            ]
        if "scope-extractions" in sql:
            return [
                {
                    **deepcopy(v),
                    "id": f"v1_extraction:{hashlib.sha256(k.encode()).hexdigest()}",
                }
                for k, v in self.extractions.items()
                if k in params["extraction_ids"]
            ]
        if "scope-membership" in sql:
            return [{"in": s, "out": "notebook:allowed"} for s in self.members]
        if "scope-epochs" in sql:
            return [
                {"version_id": k, "scope_epoch": v}
                for k, v in self.epochs.items()
                if k in params["version_ids"]
            ]
        if "index-manifests" in sql:
            return deepcopy(self.manifests)
        if "vector-count" in sql:
            return [
                {
                    "count": self.metadata_count
                    if self.metadata_count is not None
                    else len(self.vectors)
                }
            ]
        if "vector-shapes" in sql:
            return [
                {
                    **{k: v for k, v in r.items() if k != "vector"},
                    "vector_elements": len(r["vector"]),
                }
                for r in deepcopy(self.vectors)
            ]
        if "vector-payload" in sql:
            rows = deepcopy(self.vectors)
            if self.drift_payload:
                rows[0]["vector"] = [1.0, 0.0, 0.0]
            if "array::slice" in sql:
                for row in rows:
                    row["vector_elements"] = len(row["vector"])
                    row["vector"] = row["vector"][: params["dimension"]]
            self.payload_returned = deepcopy(rows)
            return rows
        if "publication-rows" in sql:
            return deepcopy(self.vectors)
        if "canonical-evidence" in sql:
            return [
                {
                    "id": f"v1_evidence:{hashlib.sha256(eid.encode()).hexdigest()}",
                    "evidence_id": eid,
                    "version_id": vid,
                    "extraction_id": ext["extraction_id"],
                    "notebook_id": "notebook:allowed",
                    "quote_hash": "a" * 64,
                }
                for vid in params["version_ids"]
                for ext in [
                    self.extractions[self.versions[vid]["current_extraction_id"]]
                ]
                for eid in ext["evidence_ids"]
            ]
        if "invalidate-versions" in sql:
            return [
                {"version_id": v["source_version_id"], "notebook_id": v["notebook_id"]}
                for v in self.versions.values()
                if (
                    not params.get("source_id") or v["source_id"] == params["source_id"]
                )
                and (
                    not params.get("notebook_id")
                    or v["notebook_id"] == params["notebook_id"]
                )
            ]
        if "delete-staging" in sql:
            return []
        if "delete-vectors" in sql:
            if self.cleanup_fails:
                raise RuntimeError("fixture cleanup failure")
            return []
        raise AssertionError("Unexpected fake query: " + sql)

    async def query_raw(self, sql, params):
        self.calls.append((sql, deepcopy(params)))
        if self.raw_override is not ...:
            return (
                self.raw_override(params)
                if callable(self.raw_override)
                else self.raw_override
            )
        if "epoch-invalidate" in sql:
            for vid in params["version_ids"]:
                self.epochs[vid] = self.epochs.get(vid, 0) + 1
        if "attempt-cancel" in sql:
            self.attempts[params["attempt_id"]] = True
        if "attempt-register" in sql:
            if self.attempts.get(params["attempt_id"]):
                return {
                    "result": [
                        {"status": "ERR", "result": "ATTEMPT_CANCELLED"},
                        {
                            "status": "OK",
                            "result": params.get("receipt", {"ack": True}),
                        },
                    ]
                }
            self.attempts.setdefault(params["attempt_id"], False)
        if "manifest-publish" in sql:
            if self.attempts.get(params["attempt_id"]):
                return {
                    "result": [
                        {"status": "ERR", "result": "ATTEMPT_CANCELLED"},
                        {
                            "status": "OK",
                            "result": params.get("receipt", {"ack": True}),
                        },
                    ]
                }
            if any(
                self.epochs.get(e["version_id"], 0) != e["scope_epoch"]
                for e in params["entries"]
            ):
                return {
                    "result": [
                        {"status": "ERR", "result": "SCOPE_CHANGED"},
                        {
                            "status": "OK",
                            "result": params.get("receipt", {"ack": True}),
                        },
                    ]
                }
            self.manifests = deepcopy(params["manifests"])
        return {
            "result": [
                {"status": "OK", "result": params.get("receipt", {"ack": True})},
                {"status": "OK", "result": params.get("receipt", {"ack": True})},
            ]
        }


@pytest.fixture
def repository(monkeypatch, tmp_path):
    module = importlib.import_module(
        "open_notebook.database.evidence_embedding_repository"
    )
    fake = FakeDatabase()
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(module, "repo_query", fake.query)

    @asynccontextmanager
    async def connection():
        yield fake

    monkeypatch.setattr(module, "db_connection", connection)
    return module.EvidenceEmbeddingRepository(), fake, module


async def snapshot(repository, ids=None):
    return await repository[0].capture_scope("notebook:allowed", ids or ["v1"])


def vector(snap, p, *, evidence_id="ev1", version_id="v1", **changes):
    entry = next(e for e in snap.entries if e.version_id == version_id)
    row = {
        "notebook_id": snap.notebook_id,
        "version_id": version_id,
        "extraction_id": entry.extraction_id,
        "manifest_hash": entry.manifest_hash,
        "scope_epoch": entry.scope_epoch,
        "namespace": p.fingerprint,
        "dimension": p.dimension,
        "preprocessing_revision": p.preprocessing_revision,
        "attempt_id": "attempt1",
        "evidence_id": evidence_id,
        "quote_hash": "a" * 64,
        "vector": [1.0, 0.0],
        **changes,
    }
    row.setdefault(
        "row_key",
        hashlib.sha256(
            json.dumps(
                [
                    p.fingerprint,
                    p.dimension,
                    p.preprocessing_revision,
                    row["version_id"],
                    row["extraction_id"],
                    row["evidence_id"],
                    row["quote_hash"],
                    row["attempt_id"],
                ],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest(),
    )
    return row


def ready(fake, snap, p):
    fake.manifests = [
        {
            "notebook_id": snap.notebook_id,
            "version_id": e.version_id,
            "extraction_id": e.extraction_id,
            "manifest_hash": e.manifest_hash,
            "scope_epoch": e.scope_epoch,
            "namespace": p.fingerprint,
            "dimension": p.dimension,
            "preprocessing_revision": p.preprocessing_revision,
            "attempt_id": "attempt1",
            "expected_count": len(fake.extractions[e.extraction_id]["evidence_ids"]),
            "vector_manifest_hash": hashlib.sha256(
                json.dumps(
                    sorted(
                        [
                            [eid, "a" * 64]
                            for eid in fake.extractions[e.extraction_id]["evidence_ids"]
                        ]
                    ),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest(),
            "state": "complete",
        }
        for e in snap.entries
    ]


@pytest.mark.asyncio
async def test_all_metadata_checked_before_first_evidence_read(repository):
    repo, fake, _ = repository
    fake.versions["v2"]["notebook_id"] = "notebook:foreign"
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.capture_scope("notebook:allowed", ["v1", "v2"])
    assert not any(
        "canonical-evidence" in q or "vector-payload" in q for q, _ in fake.calls
    )
    assert all(
        "payload FROM" not in q and "blocks" not in q and "quote" not in q
        for q, _ in fake.calls
    )


@pytest.mark.asyncio
async def test_vector_query_binds_notebook_versions_extractions_namespace_attempt(
    repository,
):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.vectors = [vector(snap, p)]
    assert await repo.scoped_vectors(snap, p) == fake.vectors
    q, params = next((q, v) for q, v in fake.calls if "vector-payload" in q)
    assert params["notebook_id"] == "notebook:allowed"
    assert params["namespace"] == p.fingerprint
    assert params["bindings"][0][0] == "v1"
    assert params["bindings"][0][1] == "ex1"
    assert params["bindings"][0][2] == "attempt1"
    assert "WHERE" in q and "$bindings" in q and "LIMIT" in q


@pytest.mark.asyncio
async def test_staging_is_invisible(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    fake.vectors = [vector(snap, p)]
    with pytest.raises(Exception, match="INDEX_NOT_READY"):
        await repo.scoped_vectors(snap, p)
    assert not any("vector-payload" in q for q, _ in fake.calls)


@pytest.mark.asyncio
async def test_publish_cas_rejects_changed_epoch(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    fake.vectors = [vector(snap, p)]
    await repo.register_attempt("attempt1", snap, p)
    await repo.invalidate("notebook:allowed", ["v1"], "reparse")
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.publish("attempt1", snap, p, 1)
    assert fake.manifests == []


@pytest.mark.asyncio
async def test_source_unlink_revokes_retained_versions(repository):
    repo, fake, _ = repository
    snap = await snapshot(repository)
    await repo.invalidate_source("source:one", notebook_id="notebook:allowed")
    fake.members.remove("source:one")
    assert "v1" in fake.versions
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.assert_scope(snap)
    operations = [q for q, _ in fake.calls]
    assert next(i for i, q in enumerate(operations) if "epoch-invalidate" in q) < next(
        i for i, q in enumerate(operations) if "delete-vectors" in q
    )


@pytest.mark.asyncio
async def test_delete_failure_cannot_reenable_vectors(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.cleanup_fails = True
    await repo.invalidate("notebook:allowed", ["v1"], "delete")
    assert fake.epochs["v1"] == 1
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.scoped_vectors(snap, p)


@pytest.mark.asyncio
@pytest.mark.parametrize("count,dimension", [(5001, 2), (1000, 4096)])
async def test_cap_checked_before_vector_payload_read(repository, count, dimension):
    repo, fake, _ = repository
    fake.extractions["ex1"]["evidence_ids"] = [f"ev{i}" for i in range(count)]
    snap = await snapshot(repository)
    data = profile().model_dump(exclude_computed_fields=True)
    data["dimension"] = dimension
    p = EmbeddingProfile(**data)
    ready(fake, snap, p)
    fake.manifests[0]["expected_count"] = count
    fake.metadata_count = count
    with pytest.raises(Exception, match="SCOPE_TOO_LARGE"):
        await repo.scoped_vectors(snap, p)
    assert not any("vector-payload" in q for q, _ in fake.calls)


@pytest.mark.asyncio
async def test_parameter_values_never_interpolated(repository):
    repo, fake, _ = repository
    attack = "v1'; SELECT foreign_quote; --"
    fake.versions[attack] = {**fake.versions.pop("v1"), "source_version_id": attack}
    fake.extractions["ex1"]["source_version_id"] = attack
    await repo.capture_scope("notebook:allowed", [attack])
    assert all(attack not in q for q, _ in fake.calls)


@pytest.mark.asyncio
async def test_foreign_row_injection_rejects_without_content_leak(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.vectors = [
        vector(snap, p, notebook_id="notebook:foreign", quote="foreign_quote")
    ]
    with pytest.raises(Exception, match="INDEX_INTEGRITY") as caught:
        await repo.scoped_vectors(snap, p)
    assert "foreign_quote" not in str(caught.value)


@pytest.mark.asyncio
async def test_cancellation_fences_attempt_only_and_retains_last_good(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    old = deepcopy(fake.manifests)
    await repo.cancel_attempt("rebuild")
    assert fake.epochs == {}
    assert (await repo.status(snap, p))["state"] == "ready"
    assert fake.manifests == old
    with pytest.raises(Exception, match="ATTEMPT_CANCELLED"):
        await repo.register_attempt("rebuild", snap, p)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"result": []},
        {"result": [{"status": "OK"}]},
        {
            "result": [
                {"status": "OK", "result": {"ack": True}},
                {"status": "ERR", "result": "foreign_quote"},
            ]
        },
    ],
)
async def test_atomic_write_checks_all_acknowledgements_without_payload_errors(
    repository, response
):
    repo, fake, _ = repository
    snap = await snapshot(repository)
    fake.raw_override = response
    with pytest.raises(Exception) as caught:
        await repo.register_attempt("attempt1", snap, profile())
    assert "foreign_quote" not in str(caught.value)


@pytest.mark.asyncio
async def test_incomplete_or_changed_quote_hash_cannot_publish(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    fake.vectors = [vector(snap, p, quote_hash="c" * 64)]
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.publish("attempt1", snap, p, 1)
    assert fake.manifests == []


@pytest.mark.asyncio
async def test_publish_binds_count_hash_and_uncancelled_fence_atomically(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    fake.vectors = [vector(snap, p)]
    await repo.register_attempt("attempt1", snap, p)
    result = await repo.publish("attempt1", snap, p, 1)
    assert result["state"] == "ready"
    q, params = next((q, v) for q, v in fake.calls if "manifest-publish" in q)
    assert "BEGIN TRANSACTION" in q and "COMMIT TRANSACTION" in q
    assert "cancelled" in q and "scope_epoch" in q
    assert params["manifests"][0]["expected_count"] == 1
    assert len(params["manifests"][0]["vector_manifest_hash"]) == 64
    assert "quote" not in params["manifests"][0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    ["notebook_missing", "source_unlinked", "extraction_foreign", "version_unready"],
)
async def test_every_selected_metadata_failure_precedes_hash_and_vector_reads(
    repository, change
):
    repo, fake, _ = repository
    if change == "notebook_missing":
        fake.notebook = False
    elif change == "source_unlinked":
        fake.members.remove("source:two")
    elif change == "extraction_foreign":
        fake.extractions["ex2"]["source_version_id"] = "foreign"
    else:
        fake.versions["v2"]["status"] = "running"
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.capture_scope("notebook:allowed", ["v1", "v2"])
    assert not any(
        "canonical-evidence" in q or "vector-payload" in q for q, _ in fake.calls
    )


@pytest.mark.asyncio
async def test_scope_digest_binds_ordered_canonical_quote_hashes(repository):
    repo, fake, _ = repository
    old = await snapshot(repository)
    original_query = fake.query

    async def changed_hash(sql, params=None):
        rows = await original_query(sql, params)
        if "canonical-evidence" in sql:
            rows[0]["quote_hash"] = "c" * 64
        return rows

    repo.query = changed_hash
    new = await repo.capture_scope("notebook:allowed", ["v1"])
    assert old.entries[0].manifest_hash != new.entries[0].manifest_hash
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.assert_scope(old)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad", [[0.0, 0.0], [float("nan"), 0.0], [1.0], [True, 0.0], [2.0, 0.0]]
)
async def test_write_batch_rejects_invalid_vectors_before_storage(repository, bad):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.write_batch("attempt1", snap, p, [vector(snap, p, vector=bad)])
    assert not any("vector-write" in q for q, _ in fake.calls)


@pytest.mark.asyncio
async def test_write_batch_binds_canonical_hashes_scope_and_attempt_guard(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    await repo.register_attempt("attempt1", snap, p)
    await repo.write_batch("attempt1", snap, p, [vector(snap, p)])
    q, params = next((q, v) for q, v in fake.calls if "vector-write" in q)
    assert "ATTEMPT_NOT_REGISTERED" in q and "ATTEMPT_CANCELLED" in q
    assert "quote_hash != $evidence.quote_hash" in q
    assert params["rows"][0]["id"].table_name == "evidence_embedding_vector"
    assert params["entries"][0]["canonical"][0]["quote_hash"] == "a" * 64
    assert all("quote" not in row and "blocks" not in row for row in params["rows"])


@pytest.mark.asyncio
async def test_published_attempt_is_sealed_and_cleanup_only_targets_revoked_epochs(
    repository,
):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    fake.vectors = [vector(snap, p)]
    await repo.register_attempt("attempt1", snap, p)
    await repo.publish("attempt1", snap, p, 1)
    publish_sql = next(q for q, _ in fake.calls if "manifest-publish" in q)
    assert "published = true" in publish_sql
    await repo.invalidate("notebook:allowed", ["v1"], "delete")
    cleanup_sql = next(q for q, _ in fake.calls if "delete-vectors" in q)
    assert "scope_epoch <" in cleanup_sql and "$scope_target" in cleanup_sql


@pytest.mark.asyncio
async def test_vector_payload_sql_limit_always_obeys_element_budget(repository):
    repo, fake, _ = repository
    data = profile().model_dump(exclude_computed_fields=True)
    data["dimension"] = 4096
    p = EmbeddingProfile(**data)
    snap = await snapshot(repository)
    ready(fake, snap, p)
    fake.vectors = [vector(snap, p, vector=[1.0] + [0.0] * 4095)]
    await repo.scoped_vectors(snap, p)
    _, params = next((q, v) for q, v in fake.calls if "vector-payload" in q)
    assert params["payload_limit"] * p.dimension <= 2_000_000


@pytest.mark.asyncio
async def test_complete_manifest_requires_canonical_count_and_hash(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.manifests[0]["vector_manifest_hash"] = "f" * 64
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.status(snap, p)


@pytest.mark.asyncio
async def test_locked_source_revocation_is_atomic_for_inactive_retained_versions_without_project_locks(
    repository, monkeypatch
):
    repo, fake, module = repository
    snap, p = await snapshot(repository), profile()
    fake.vectors = [vector(snap, p)]
    await repo.register_attempt("attempt1", snap, p)
    fake.versions["v2"].update(source_id="source:one", notebook_id="notebook:unlinked")

    def no_nested_lock(*args, **kwargs):
        raise AssertionError(
            "Must not acquire another project lock under notebook barrier"
        )

    with monkeypatch.context() as patch:
        patch.setattr(module, "project_lock", no_nested_lock)
        await repo.invalidate_source_locked("source:one")
    assert fake.epochs["v1"] == fake.epochs["v2"] == 1
    revocations = [(q, v) for q, v in fake.calls if "epoch-invalidate" in q]
    assert len(revocations) == 1
    assert {s["notebook_id"] for s in revocations[0][1]["scopes"]} == {
        "notebook:allowed",
        "notebook:unlinked",
    }
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.publish("attempt1", snap, p, 1)
    assert fake.manifests == []


@pytest.mark.asyncio
async def test_returned_vector_row_key_is_checked_not_trusted(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.vectors = [vector(snap, p, row_key="foreign-row-key")]
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.scoped_vectors(snap, p)


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("scope_epoch", False), ("dimension", True)])
async def test_vector_numeric_identity_rejects_booleans(repository, field, value):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    if field == "dimension":
        data = p.model_dump(exclude_computed_fields=True)
        data["dimension"] = 1
        p = EmbeddingProfile(**data)
    ready(fake, snap, p)
    fake.vectors = [
        vector(
            snap, p, vector=[1.0] if p.dimension == 1 else [1.0, 0.0], **{field: value}
        )
    ]
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.scoped_vectors(snap, p)


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("scope_epoch", False), ("dimension", True)])
async def test_complete_manifest_numeric_identity_is_strict(repository, field, value):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    if field == "dimension":
        data = p.model_dump(exclude_computed_fields=True)
        data["dimension"] = 1
        p = EmbeddingProfile(**data)
    ready(fake, snap, p)
    fake.manifests[0][field] = value
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.status(snap, p)


@pytest.mark.asyncio
async def test_direct_source_deletion_barrier_holds_project_locks_through_cleanup(
    repository, monkeypatch
):
    repo, fake, module = repository
    held = set()

    @asynccontextmanager
    async def locked(project):
        held.add(project)
        try:
            yield
        finally:
            held.remove(project)

    monkeypatch.setattr(module, "project_lock", locked)
    async with repo.source_deletion_barrier("source:one"):
        assert held == {"notebook:allowed"}
        assert fake.epochs["v1"] == 1
    assert held == set()


@pytest.mark.asyncio
async def test_fresh_capture_cannot_enter_direct_delete_revocation_cleanup_gap(
    repository,
):
    """Real shared-root flock, fake DB: no distributed-lock claim is made."""
    import asyncio

    repo, fake, _ = repository
    started = asyncio.Event()

    async def fresh_capture():
        started.set()
        return await repo.capture_scope("notebook:allowed", ["v1"])

    async with repo.source_deletion_barrier("source:one"):
        task = asyncio.create_task(fresh_capture())
        await started.wait()
        done, pending = await asyncio.wait({task}, timeout=0.03)
        assert not done and task in pending
        # Native reference removal is still inside the supported shared-root
        # barrier; the waiter must never capture the new epoch in between.
        fake.members.remove("source:one")
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await task


@pytest.mark.asyncio
async def test_actual_vector_shape_is_checked_before_any_payload_read(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.vectors = [vector(snap, p, vector=[1.0, 0.0, 0.0])]
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.scoped_vectors(snap, p)
    assert not any("vector-payload" in q for q, _ in fake.calls)
    shape_sql, shape_params = next(
        (q, v) for q, v in fake.calls if "vector-shapes" in q
    )
    assert "array::len(vector)" in shape_sql
    assert shape_params["notebook_id"] == snap.notebook_id
    assert shape_params["bindings"][0][:3] == ["v1", "ex1", "attempt1"]


@pytest.mark.asyncio
async def test_payload_projection_bounds_shape_drift_and_rejects_truncation(repository):
    repo, fake, _ = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.vectors = [vector(snap, p)]
    fake.drift_payload = True
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.scoped_vectors(snap, p)
    sql, params = next((q, v) for q, v in fake.calls if "vector-payload" in q)
    assert "array::slice(vector, 0, $dimension)" in sql
    assert "array::len(vector)" in sql and "vector_elements" in sql
    assert len(fake.payload_returned[0]["vector"]) <= params["dimension"]
    assert fake.payload_returned[0]["vector_elements"] == 3
    assert params["payload_limit"] * params["dimension"] <= 2_000_000


# Task 2 review round 1: receipts, physical identity, sanitized reads, corruption.
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "pre_only",
        "post_only",
        "wrong_post",
        "wrong_operation",
        "extra_ok",
        "mixed_abort",
        "lone_error",
        "wrong_abort_suffix",
        "nonstring_abort",
    ],
)
async def test_commit_requires_complete_operation_bound_receipts(repository, case):
    repo, fake, _ = repository
    snap = await snapshot(repository)

    def response(params):
        receipt = params.get("receipt", {"ack": True})
        ok = {"status": "OK", "result": receipt}
        err = {"status": "ERR", "result": "SCOPE_CHANGED"}
        cases = {
            "pre_only": [ok],
            "post_only": [{"status": "OK", "result": None}, ok],
            "wrong_post": [
                ok,
                {"status": "OK", "result": {"operation": "wrong", "token": "wrong"}},
            ],
            "wrong_operation": [
                {
                    "status": "OK",
                    "result": {**receipt, "operation": "not_this_operation"},
                }
            ]
            * 2,
            "extra_ok": [ok, ok, ok],
            "mixed_abort": [ok, err, ok],
            "lone_error": [err],
            "wrong_abort_suffix": [err, {"status": "OK", "result": None}],
            "nonstring_abort": [{"status": "ERR", "result": {"private": "body"}}, ok],
        }
        return {"result": cases[case]}

    fake.raw_override = response
    with pytest.raises(Exception, match="INDEX_COMMIT_UNKNOWN"):
        await repo.register_attempt("attempt1", snap, profile())


@pytest.mark.asyncio
async def test_commit_success_binds_distinct_call_receipts_before_and_after_commit(
    repository,
):
    repo, fake, _ = repository
    snap = await snapshot(repository)
    await repo.register_attempt("attempt1", snap, profile())
    await repo.cancel_attempt("attempt2")
    calls = [(q, p) for q, p in fake.calls if "BEGIN TRANSACTION" in q]
    for sql, params in calls:
        assert "RETURN $receipt;\nCOMMIT TRANSACTION;\nRETURN $receipt;" in sql
        assert params["receipt"]["operation"] in {"register_attempt", "cancel_attempt"}
        assert len(params["receipt"]["token"]) == 32
    assert calls[0][1]["receipt"] != calls[1][1]["receipt"]


@pytest.mark.asyncio
@pytest.mark.parametrize("known", [True, False])
async def test_only_complete_abort_envelope_is_definitive(repository, known):
    repo, fake, _ = repository
    snap = await snapshot(repository)
    fake.raw_override = lambda params: {
        "result": [
            {
                "status": "ERR",
                "result": "SCOPE_CHANGED" if known else "SYNTHETIC_PRIVATE_DB_BODY",
            },
            {"status": "OK", "result": params.get("receipt", {"ack": True})},
        ]
    }
    with pytest.raises(
        Exception, match="SCOPE_CHANGED" if known else "INDEX_COMMIT_REJECTED"
    ) as caught:
        await repo.register_attempt("attempt1", snap, profile())
    assert "SYNTHETIC_PRIVATE_DB_BODY" not in str(caught.value)


@pytest.mark.asyncio
async def test_unknown_revocation_cannot_start_vector_or_native_cleanup(
    repository, monkeypatch, tmp_path
):
    repo, fake, module = repository
    fake.raw_override = {"result": [{"status": "OK", "result": {"ack": True}}]}
    with pytest.raises(Exception, match="INDEX_COMMIT_UNKNOWN"):
        await repo.invalidate("notebook:allowed", ["v1"], "delete")
    assert not any("delete-vectors" in q for q, _ in fake.calls)

    from open_notebook.domain import notebook as domain

    file = tmp_path / "original.txt"
    file.write_text("original")
    native = AsyncMock()
    monkeypatch.setattr(domain, "repo_query", fake.query)
    monkeypatch.setattr(domain.Source.__bases__[0], "delete", native)
    with pytest.raises(Exception, match="INDEX_COMMIT_UNKNOWN"):
        await domain.Source(
            id="source:one", title="one", asset=domain.Asset(file_path=str(file))
        ).delete()
    assert file.read_text() == "original"
    native.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,tag,logical",
    [
        ("version", "scope-versions", "source_version_id"),
        ("extraction", "scope-extractions", "extraction_id"),
        ("evidence", "canonical-evidence", "evidence_id"),
    ],
)
async def test_metadata_requires_canonical_physical_identity(
    repository, kind, tag, logical
):
    repo, fake, _ = repository
    original = fake.query

    async def rogue(sql, params=None):
        rows = await original(sql, params)
        if tag in sql:
            rows[0]["id"] = f"v1_{kind}:unrelated_physical_record"
        return rows

    repo.query = rogue
    with pytest.raises(Exception, match="INDEX_INTEGRITY|SCOPE_CHANGED"):
        await repo.capture_scope("notebook:allowed", ["v1"])


@pytest.mark.asyncio
@pytest.mark.parametrize("tag", ["scope-versions", "scope-extractions"])
async def test_selected_metadata_payloads_cannot_be_swapped_between_physical_records(
    repository, tag
):
    repo, fake, _ = repository
    original = fake.query

    async def swapped(sql, params=None):
        rows = await original(sql, params)
        if tag in sql:
            first_id, second_id = rows[0].get("id"), rows[1].get("id")
            rows = [{**rows[1], "id": first_id}, {**rows[0], "id": second_id}]
        return rows

    repo.query = swapped
    with pytest.raises(Exception, match="SCOPE_CHANGED"):
        await repo.capture_scope("notebook:allowed", ["v1", "v2"])


@pytest.mark.asyncio
async def test_canonical_query_binds_hashed_targets_and_projects_only_metadata(
    repository,
):
    from api.personal_store import record_key

    repo, fake, _ = repository
    await snapshot(repository)
    for tag, kind, identities in [
        ("scope-versions", "version", ["v1"]),
        ("scope-extractions", "extraction", ["ex1"]),
        ("canonical-evidence", "evidence", ["ev1"]),
    ]:
        sql, params = next((q, p) for q, p in fake.calls if tag in q)
        assert {str(t) for t in params["targets"]} == {
            record_key(kind, logical) for logical in identities
        }
        assert "SELECT id," in sql
        assert (
            "blocks" not in sql
            and "quote AS" not in sql
            and "SELECT payload FROM" not in sql
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation,tag",
    [
        ("capture", "scope-notebook"),
        ("status", "index-manifests"),
        ("vectors", "vector-count"),
        ("vectors", "vector-shapes"),
        ("vectors", "vector-payload"),
        ("invalidate", "invalidate-versions"),
    ],
)
async def test_all_query_failures_have_typed_sanitized_boundary(
    repository, operation, tag
):
    from open_notebook.exceptions import DatabaseOperationError

    repo, fake, module = repository
    snap, p = await snapshot(repository), profile()
    ready(fake, snap, p)
    fake.vectors = [vector(snap, p)]
    marker = "SYNTHETIC_PRIVATE_DB_BODY"

    async def fail(sql, params=None):
        if tag in sql:
            raise RuntimeError(marker)
        return await fake.query(sql, params)

    guarded = module.EvidenceEmbeddingRepository(query=fail)
    with pytest.raises(DatabaseOperationError) as caught:
        if operation == "capture":
            await guarded.capture_scope("notebook:allowed", ["v1"])
        elif operation == "status":
            await guarded.status(snap, p)
        elif operation == "vectors":
            await guarded.scoped_vectors(snap, p)
        else:
            await guarded.invalidate_source("source:one")
    assert marker not in str(caught.value)
    assert caught.value.__cause__ is None and caught.value.__context__ is None


@pytest.mark.asyncio
async def test_query_boundary_preserves_cancellation_and_known_safe_domain_errors(
    repository,
):
    import asyncio

    repo, _, module = repository
    cancellation = asyncio.CancelledError()
    for error in (cancellation,):
        guarded = module.EvidenceEmbeddingRepository(query=AsyncMock(side_effect=error))
        with pytest.raises(asyncio.CancelledError) as cancelled:
            await guarded.capture_scope("notebook:allowed", ["v1"])
        assert cancelled.value is error
    try:
        module._fail("SCOPE_CHANGED")
    except Exception as error:
        known = error
    guarded = module.EvidenceEmbeddingRepository(query=AsyncMock(side_effect=known))
    with pytest.raises(type(known)) as caught:
        await guarded.capture_scope("notebook:allowed", ["v1"])
    assert type(caught.value) is type(known)
    assert str(caught.value) == str(known)
    assert caught.value is not known
    assert caught.value.__cause__ is None and caught.value.__context__ is None


@pytest.mark.asyncio
@pytest.mark.parametrize("count,dimension", [(5001, 2), (489, 4096)])
async def test_actual_count_mismatch_is_integrity_even_above_row_or_element_caps(
    repository, count, dimension
):
    repo, fake, _ = repository
    snap = await snapshot(repository)
    data = profile().model_dump(exclude_computed_fields=True)
    data["dimension"] = dimension
    p = EmbeddingProfile(**data)
    ready(fake, snap, p)
    fake.metadata_count = count
    with pytest.raises(Exception, match="INDEX_INTEGRITY"):
        await repo.scoped_vectors(snap, p)
    assert not any("vector-payload" in q for q, _ in fake.calls)
