"""Explicit selected imports with durable receipts and local recovery checkpoints.

A provider call is never automatically replayed. A completed local snapshot can
be reconciled after a process restart/DB acknowledgement loss without refetching.
"""

import asyncio
import hashlib
import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from api.web_discovery_contracts import (
    WebIdempotencyConflict,
    WebImportRequest,
    WebImportResponse,
)
from api.web_discovery_provider import SNAPSHOT_BYTES, FirecrawlProvider, public_web_url
from open_notebook.exceptions import (
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    NotFoundError,
    OpenNotebookError,
    RateLimitError,
)
from open_notebook.utils.url_validation import validate_url

CHECKPOINT_BYTES = SNAPSHOT_BYTES * 6 + 16384


def _digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _ensure_native_source(notebook_id, source_id, title, url):
    from open_notebook.database.repository import (
        ensure_record_id,
        repo_query,
        repo_relate,
    )
    from open_notebook.domain.notebook import Notebook, Source

    await Notebook.get(notebook_id)
    try:
        await Source.get(source_id)
    except NotFoundError:
        timestamp = datetime.now(timezone.utc)
        await repo_query(
            "CREATE $source CONTENT $data;",
            {
                "source": ensure_record_id(source_id),
                "data": {
                    "title": title,
                    "topics": [],
                    "asset": {"url": url},
                    "created": timestamp,
                    "updated": timestamp,
                },
            },
        )
    relations = await repo_query(
        "SELECT id FROM reference WHERE in=$source AND out=$notebook;",
        {
            "source": ensure_record_id(source_id),
            "notebook": ensure_record_id(notebook_id),
        },
    )
    if not relations:
        await repo_relate(source_id, "reference", notebook_id)


async def _native_source_available(notebook_id, source_id):
    from open_notebook.database.repository import ensure_record_id, repo_query
    from open_notebook.domain.notebook import Source

    try:
        await Source.get(source_id)
    except NotFoundError:
        return False
    return bool(
        await repo_query(
            "SELECT id FROM reference WHERE in=$source AND out=$notebook;",
            {
                "source": ensure_record_id(source_id),
                "notebook": ensure_record_id(notebook_id),
            },
        )
    )


class WebDiscoveryService:
    def __init__(
        self,
        *,
        store=None,
        provider=None,
        evidence=None,
        submit=None,
        ensure_source=None,
        source_available=None,
        validate=None,
        data_root=None,
    ):
        from api.evidence_service import EvidenceService
        from api.personal_service import submit_job
        from api.personal_store import get_store

        self.store = store or get_store()
        self.provider = provider or FirecrawlProvider()
        self.evidence = evidence or EvidenceService(store=self.store)
        self.submit = submit or submit_job
        self.ensure_source = ensure_source or _ensure_native_source
        self.source_available = source_available or _native_source_available
        self.validate = validate or validate_url
        self.data_root = Path(data_root or self.evidence.data_root)

    def _snapshot_path(self, identity):
        return self.data_root / "web-imports" / f"{_digest(identity)}.json"

    def _write_checkpoint(self, identity, value):
        path = self._snapshot_path(identity)
        if path.parent.is_symlink() or not path.parent.resolve().is_relative_to(
            self.data_root.resolve()
        ):
            raise ExternalServiceError("WEB_IMPORT_OUTCOME_UNKNOWN")
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{uuid4().hex}.tmp")
        try:
            encoded = json.dumps(value, ensure_ascii=False).encode()
            if len(encoded) > CHECKPOINT_BYTES:
                raise InvalidInputError("WEB_RESPONSE_TOO_LARGE")
            with temporary.open("xb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)

    def _read_checkpoint(self, identity, url):
        path = self._snapshot_path(identity)
        if path.parent.is_symlink() or not path.parent.resolve().is_relative_to(
            self.data_root.resolve()
        ):
            raise ExternalServiceError("WEB_IMPORT_OUTCOME_UNKNOWN")
        if not path.is_file():
            return None
        try:
            if (
                not path.resolve().is_relative_to(self.data_root.resolve())
                or path.parent.is_symlink()
            ):
                raise ValueError
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > CHECKPOINT_BYTES:
                    raise ValueError
                encoded = handle.read(CHECKPOINT_BYTES + 1)
                if len(encoded) > CHECKPOINT_BYTES:
                    raise ValueError
            value = json.loads(encoded)
            if not isinstance(value, dict) or any(
                not isinstance(value.get(key), str)
                for key in (
                    "url",
                    "content",
                    "sha256",
                    "retrieved_at",
                    "title",
                    "snippet",
                )
            ):
                raise ValueError
            if (
                len(value["content"].encode()) > SNAPSHOT_BYTES
                or len(value["title"]) > 500
                or len(value["snippet"]) > 2000
            ):
                raise ValueError
            if datetime.fromisoformat(value["retrieved_at"]).tzinfo is None:
                raise ValueError
            if value["url"] != url or _digest(value["content"]) != value["sha256"]:
                raise ValueError
            return value
        except (OSError, ValueError, KeyError, TypeError):
            raise ExternalServiceError("WEB_IMPORT_OUTCOME_UNKNOWN") from None

    @staticmethod
    def _prior_error(receipt):
        code = receipt.get("error", "WEB_PROVIDER_ERROR")
        classes = {
            "ConfigurationError": ConfigurationError,
            "RateLimitError": RateLimitError,
            "NetworkError": NetworkError,
            "InvalidInputError": InvalidInputError,
        }
        raise classes.get(receipt.get("error_type"), ExternalServiceError)(code)

    async def _cached_response(self, notebook_id, result):
        version = await self.store.get("version", result["source_version_id"])
        if (
            not version
            or version.get("source_id") != result["source_id"]
            or version.get("notebook_id") != notebook_id
            or not await self.source_available(notebook_id, result["source_id"])
        ):
            raise InvalidInputError("WEB_IMPORTED_SOURCE_UNAVAILABLE")
        return WebImportResponse(**result)

    async def import_source(
        self, notebook_id: str, request: WebImportRequest
    ) -> WebImportResponse:
        url = public_web_url(request.url)
        # Required shared URL validation; selected URLs are never HTTP targets.
        try:
            await self.validate(url, "web-import")
        except ValueError:
            raise InvalidInputError("WEB_INVALID_URL") from None
        request_hash = _digest(
            request.model_dump(exclude={"idempotency_key"}) | {"url": url}
        )
        request_id = "web-request:" + _digest([notebook_id, request.idempotency_key])
        url_id = "web-url:" + _digest([notebook_id, url])
        async with self.store.project_lock("web-claim:" + notebook_id):
            receipt = await self.store.get("import_report", request_id)
            if receipt:
                if receipt["request_hash"] != request_hash:
                    raise WebIdempotencyConflict()
                if receipt.get("result") and receipt["result"].get("state") != "saved":
                    return await self._cached_response(notebook_id, receipt["result"])
                if receipt.get("state") == "failed":
                    self._prior_error(receipt)
            existing = await self.store.get("import_report", url_id)
            saved = bool(
                existing and existing.get("result", {}).get("state") == "saved"
            )
            if existing is not None and saved:
                await self._cached_response(notebook_id, existing["result"])
            if existing and existing.get("result") and not saved:
                response = await self._cached_response(
                    notebook_id, existing["result"] | {"state": "already_imported"}
                )
                await self.store.put(
                    "import_report",
                    request_id,
                    {
                        "import_report_id": request_id,
                        "request_hash": request_hash,
                        "notebook_id": notebook_id,
                        "state": "completed",
                        "result": response.model_dump(),
                    },
                )
                return response
            resume = saved or bool(
                existing and existing.get("state") in {"fetching", "outcome_unknown"}
            )
            if (
                existing is not None
                and resume
                and not saved
                and existing.get("request_id") != request_id
            ):
                # A browser restart can lose the original key. A durable local
                # checkpoint may be finished under a new key, but never refetched.
                if await asyncio.to_thread(self._read_checkpoint, url_id, url) is None:
                    raise InvalidInputError(
                        "WEB_IMPORT_OUTCOME_UNKNOWN"
                        if existing.get("state") == "outcome_unknown"
                        else "WEB_IMPORT_IN_PROGRESS"
                    )
            if receipt is None:
                receipt = {
                    "import_report_id": request_id,
                    "notebook_id": notebook_id,
                    "request_hash": request_hash,
                    "state": "fetching",
                    "url_id": url_id,
                    "created_at": _now(),
                }
                await self.store.put(
                    "import_report", request_id, receipt, create_only=True
                )
            if not resume:
                create_only = existing is None
                existing = {
                    "import_report_id": url_id,
                    "notebook_id": notebook_id,
                    "request_id": request_id,
                    "state": "fetching",
                    "url": url,
                    "title": request.title,
                    "snippet": request.snippet,
                    "created_at": _now(),
                }
                # Commit the dispatch receipt before a potentially billable call.
                await self.store.put(
                    "import_report", url_id, existing, create_only=create_only
                )

        if existing is None:
            # Never fabricate a missing dispatch receipt or refetch on resume.
            raise ExternalServiceError("WEB_IMPORT_OUTCOME_UNKNOWN")

        checkpoint = await asyncio.to_thread(self._read_checkpoint, url_id, url)
        if checkpoint is None:
            if resume:
                age = (
                    datetime.now(timezone.utc)
                    - datetime.fromisoformat(existing["created_at"])
                ).total_seconds()
                raise InvalidInputError(
                    "WEB_IMPORT_IN_PROGRESS"
                    if age < 45 and existing.get("state") != "outcome_unknown"
                    else "WEB_IMPORT_OUTCOME_UNKNOWN"
                )
            try:
                text = await self.provider.scrape(url)
                checkpoint = {
                    "url": url,
                    "content": text,
                    "sha256": _digest(text),
                    "retrieved_at": _now(),
                    "title": request.title,
                    "snippet": request.snippet,
                }
                await asyncio.to_thread(self._write_checkpoint, url_id, checkpoint)
            except OpenNotebookError as exc:
                # An HTTP/config rejection is known; timeout, malformed/oversized
                # success or server failure may already have consumed credits.
                known_rejection = isinstance(exc, (ConfigurationError, RateLimitError))
                failure = {
                    "state": "failed" if known_rejection else "outcome_unknown",
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                }
                await self.store.put("import_report", request_id, receipt | failure)
                await self.store.put("import_report", url_id, existing | failure)
                if known_rejection:
                    raise
                raise ExternalServiceError("WEB_IMPORT_OUTCOME_UNKNOWN") from None
            # Cancellation/unknown failures leave the durable dispatch receipt in
            # place. Never assume no charge occurred or reissue the provider call.

        async with self.store.project_lock("web-finish:" + url_id):
            latest = await self.store.get("import_report", request_id)
            if (
                latest
                and latest.get("result")
                and latest["result"].get("state") != "saved"
            ):
                return await self._cached_response(notebook_id, latest["result"])
            try:
                response = await self._finish(notebook_id, url_id, checkpoint)
                await self.store.put(
                    "import_report",
                    url_id,
                    existing | {"state": "completed", "result": response.model_dump()},
                )
                await self.store.put(
                    "import_report",
                    request_id,
                    receipt | {"state": "completed", "result": response.model_dump()},
                )
                return response
            except OpenNotebookError:
                raise
            except Exception:
                # Bytes, source and receipts survive; same-key replay reconciles.
                raise ExternalServiceError("WEB_IMPORT_OUTCOME_UNKNOWN") from None

    async def _finish(self, notebook_id, url_id, checkpoint):
        identity = _digest([notebook_id, checkpoint["url"]])
        source_id = "source:web_" + identity
        version_id = "sv_web_" + identity
        job_id = "job_web_" + identity
        version = await self.store.get("version", version_id)
        if version is not None and not await self.source_available(
            notebook_id, source_id
        ):
            raise InvalidInputError("WEB_IMPORTED_SOURCE_UNAVAILABLE")
        await self.ensure_source(
            notebook_id, source_id, checkpoint["title"], checkpoint["url"]
        )
        if version is None:
            # This heading records provenance as data, never instructions. It
            # survives portable exports that conservatively remove URL fields.
            content = f"Source URL: {checkpoint['url']}\nRetrieved: {checkpoint['retrieved_at']}\nProvider: Firecrawl\nFormat: retrieved Markdown snapshot, not original page bytes\n\n---\n\n{checkpoint['content']}"
            version = await self.evidence.ingest(
                notebook_id,
                source_id,
                checkpoint["title"],
                content.encode(),
                mime_type="text/markdown",
                filename="web-snapshot.md",
                origin="web_snapshot",
                original_status="missing",
                provenance={
                    "kind": "web",
                    "source_url": checkpoint["url"],
                    "retrieved_at": checkpoint["retrieved_at"],
                    "provider": "firecrawl",
                    "search_result_title": checkpoint["title"],
                    "search_result_snippet": checkpoint["snippet"],
                },
                source_version_id=version_id,
                preserve_on_error=True,
            )
        else:
            # A DB acknowledgement may have been lost after the version commit.
            await self.evidence.resolve_file(version_id)
        job = await self.store.get("job", job_id)
        if job is None:
            job = {
                "job_id": job_id,
                "notebook_id": notebook_id,
                "source_id": source_id,
                "source_version_id": version["source_version_id"],
                "operation": "extract_evidence",
                "state": "queued",
                "submission_state": "not_submitted",
                "created_at": _now(),
                "attempts": 0,
            }
            await self.store.put("job", job_id, job, create_only=True)
        response = WebImportResponse(
            state="queued",
            source_id=source_id,
            source_version_id=version["source_version_id"],
            job_id=job_id,
            url=checkpoint["url"],
        )
        if not job.get("worker_job_id"):
            try:
                async with self.store.project_lock(notebook_id):
                    current = await self.store.get("job", job_id) or job
                    if current.get("state") in {"running", "succeeded"}:
                        return response
                    if current.get("state") == "cancelled_local":
                        response.state = "saved"
                        response.warning = "WEB_EXTRACTION_NOT_QUEUED"
                        return response
                    job = current | {"state": "queued", "error": None}
                    await self.store.put("job", job_id, job)
                worker_id = await self.submit(
                    "extract_evidence",
                    {
                        "source_version_id": version["source_version_id"],
                        "job_id": job_id,
                    },
                )
                async with self.store.project_lock(notebook_id):
                    current = await self.store.get("job", job_id) or job
                    await self.store.put(
                        "job", job_id, current | {"worker_job_id": worker_id}
                    )
            except Exception:
                async with self.store.project_lock(notebook_id):
                    current = await self.store.get("job", job_id) or job
                    if current.get("state") in {"running", "succeeded"}:
                        return response
                    response.state = "saved"
                    response.warning = "WEB_EXTRACTION_NOT_QUEUED"
                    if current.get("state") != "cancelled_local":
                        await self.store.put(
                            "job",
                            job_id,
                            current
                            | {
                                "state": "failed",
                                "error": {
                                    "code": response.warning,
                                    "message": response.warning,
                                },
                            },
                        )
        return response
