"""Immutable original storage and bounded, model-free evidence extraction."""

import asyncio
import hashlib
import importlib.metadata
import multiprocessing
import os
import re
import unicodedata
import weakref
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from open_notebook.domain.evidence import (
    EvidenceCitation,
    EvidenceRecord,
    Extraction,
    SourceVersion,
)
from open_notebook.exceptions import (
    InvalidInputError,
    NotFoundError,
    UploadCommitUnknownError,
)

_PARSE_SLOTS: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, asyncio.Semaphore
] = weakref.WeakKeyDictionary()


def _parse_slots():
    loop = asyncio.get_running_loop()
    if loop not in _PARSE_SLOTS:
        _PARSE_SLOTS[loop] = asyncio.Semaphore(
            max(1, int(os.getenv("STUDY_WORKBENCH_EXTRACT_CONCURRENCY", "2")))
        )
    return _PARSE_SLOTS[loop]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _sha(data: bytes):
    return hashlib.sha256(data).hexdigest()


def _parse_original(path, mime_type, page_limit, text_limit):
    """Runs in a disposable process so a malformed PDF cannot hold a worker forever."""
    if mime_type == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(path, strict=False)
        if reader.is_encrypted:
            raise ValueError("ENCRYPTED_PDF: decrypt the PDF before uploading")
        if len(reader.pages) > page_limit:
            raise ValueError(f"PAGE_LIMIT: PDF exceeds {page_limit} pages")
        blocks: list[dict[str, Any]] = []
        warnings: list[str] = []
        total = 0
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            total += len(text)
            if total > text_limit:
                raise ValueError("TEXT_LIMIT: extracted text exceeds configured limit")
            if not text.strip():
                warnings.append(
                    f"NEEDS_OCR: PDF page {index + 1} has no extractable text"
                )
            blocks.append(
                {"block_id": f"page_{index:04d}", "page_index": index, "text": text}
            )
        nonempty = sum(bool(b["text"].strip()) for b in blocks)
        return {
            "blocks": blocks,
            "page_count": len(blocks),
            "warnings": warnings,
            "status": "ready"
            if nonempty == len(blocks) and nonempty
            else ("partial" if nonempty else "needs_ocr"),
        }
    return parse_text_bytes(Path(path).read_bytes(), text_limit)


def parse_text_bytes(data, text_limit):
    """Shared UTF-8 interpretation, including BOM and empty-text behavior."""
    text = data.decode("utf-8-sig")
    if len(text) > text_limit:
        raise ValueError("TEXT_LIMIT: extracted text exceeds configured limit")
    return {
        "blocks": [{"block_id": "document", "page_index": None, "text": text}],
        "page_count": None,
        "warnings": [] if text.strip() else ["EMPTY_TEXT: no searchable text"],
        "status": "ready" if text.strip() else "empty",
    }


def _parser_process(connection, args):
    try:
        connection.send({"ok": _parse_original(*args)})
    except Exception as exc:
        connection.send({"error": str(exc)[:500]})
    finally:
        connection.close()


def _bounded_parse(path, mime_type, page_limit, timeout, text_limit):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(
        target=_parser_process,
        args=(send, (str(path), mime_type, page_limit, text_limit)),
        daemon=True,
    )
    process.start()
    send.close()
    try:
        if not receive.poll(timeout):
            raise InvalidInputError(f"EXTRACTION_TIMEOUT: exceeded {timeout:g} seconds")
        try:
            response = receive.recv()
        except EOFError as exc:
            raise InvalidInputError(
                "EXTRACTION_FAILED: parser stopped unexpectedly"
            ) from exc
        if "error" in response:
            raise InvalidInputError(f"EXTRACTION_FAILED: {response['error']}")
        return response["ok"]
    finally:
        receive.close()
        if process.is_alive():
            process.terminate()
        process.join(timeout=2)
        if process.is_alive():
            process.kill()
            process.join(timeout=2)
        process.close()


def _paragraphs(text, max_chars=1600):
    # Every offset is into the untouched extraction block, never normalized search text.
    for match in re.finditer(r"\S(?:.*?\S)?(?=\s*(?:\n\s*\n|\Z))", text, re.DOTALL):
        start, end = match.span()
        while start < end:
            stop = min(end, start + max_chars)
            yield start, stop, text[start:stop]
            start = stop


def _terms(text):
    normalized = unicodedata.normalize("NFKC", text).casefold()
    terms = set(re.findall(r"[a-z0-9_]+", normalized))
    for run in re.findall(r"[\u3400-\u9fff]+", normalized):
        if len(run) == 1:
            terms.add(run)
        terms.update(run[i : i + 2] for i in range(len(run) - 1))
    return normalized, terms


def publish_snapshot_bytes(path, data, *, durability_root=None):
    """Publish deterministic bytes durably without overwriting a competing winner."""
    root = Path(durability_root or path.parent).resolve()
    if not path.resolve().is_relative_to(root):
        raise InvalidInputError("Unsafe snapshot publication path")
    created_parents = set()
    directory = path.parent
    while not directory.exists():
        created_parents.add(directory.parent)
        directory = directory.parent
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".staging-" + uuid4().hex)
    try:
        EvidenceService._write_new(temporary, data)
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise InvalidInputError("SNAPSHOT_CONFLICT: staged bytes differ")
    finally:
        temporary.unlink(missing_ok=True)
    # The published name and every newly created ancestor entry must be durable
    # before metadata can acknowledge these bytes. Unsupported filesystems fail
    # explicitly here; callers retain the unacknowledged file, not a ready receipt.
    directories = []
    for directory in path.parents:
        directories.append(directory)
        if directory == root:
            break
    directories.extend(
        sorted(
            created_parents.difference(directories), key=lambda item: -len(item.parts)
        )
    )
    for directory in directories:
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def build_evidence_records(version, extraction_id, blocks, max_records=None):
    """Single codepoint/paragraph indexing implementation for all retained text."""
    origin = version["origin"]
    kind = (
        "derived_snapshot"
        if origin == "derived_snapshot"
        else "remote_text_snapshot"
        if origin in ("remote_text_snapshot", "web_snapshot")
        else "pdf_text"
        if version["mime_type"] == "application/pdf"
        else "text"
    )
    records: list[dict[str, Any]] = []
    for block in blocks:
        for start, end, quote in _paragraphs(block["text"]):
            if max_records is not None and len(records) >= max_records:
                raise InvalidInputError("EVIDENCE_LIMIT: too many evidence records")
            identity = (
                "ev_"
                + _sha(
                    f"{version['source_version_id']}:{extraction_id}:{block['block_id']}:{start}:{end}".encode()
                )[:32]
            )
            records.append(
                EvidenceRecord(
                    evidence_id=identity,
                    source_version_id=version["source_version_id"],
                    extraction_id=extraction_id,
                    notebook_id=version["notebook_id"],
                    source_title=version["source_title"],
                    quote=quote,
                    quote_hash=_sha(quote.encode()),
                    evidence_kind=kind,
                    locator={
                        "block_id": block["block_id"],
                        "page_index": block["page_index"],
                        "start_offset": start,
                        "end_offset": end,
                    },
                ).model_dump()
            )
    return records


class EvidenceService:
    def __init__(self, store=None, data_root=None):
        if store is None:
            from api.personal_store import get_store

            store = get_store()
        self.store = store
        self.data_root = Path(
            data_root or os.getenv("STUDY_WORKBENCH_DATA_DIR", "data/personal")
        ).resolve()
        self._extraction_locks = {}

    async def ingest(
        self,
        notebook_id,
        source_id,
        title,
        data: bytes,
        mime_type=None,
        filename=None,
        origin="upload",
        original_status="available",
        provenance=None,
        source_version_id=None,
        preserve_on_error=False,
    ):
        # preserve_on_error remains accepted for existing deterministic callers;
        # a metadata-write failure must never authorize deleting original bytes.
        if origin == "web_snapshot" and (
            not isinstance(provenance, dict)
            or not provenance.get("source_url")
            or provenance.get("historical_url_omitted")
        ):
            raise InvalidInputError("New web ingestion requires the fetched source URL")
        limit = float(os.getenv("STUDY_WORKBENCH_MAX_FILE_MB", "50")) * 1024 * 1024
        if not data or len(data) > limit:
            raise InvalidInputError(
                "File size must be greater than zero and within the configured size limit"
            )
        extension = Path(filename or title).suffix.lower()
        types = {
            ".pdf": "application/pdf",
            ".md": "text/markdown",
            ".txt": "text/plain",
        }
        mime = (
            mime_type.split(";", 1)[0].strip().lower()
            if mime_type
            else types.get(extension)
        )
        if mime in (None, "application/octet-stream"):
            mime = types.get(extension)
        if mime is None or mime not in types.values():
            raise InvalidInputError(
                "Only PDF, Markdown and UTF-8 TXT files are supported"
            )
        if mime != "application/pdf":
            try:
                data.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise InvalidInputError(
                    "UTF-8 encoding required; convert the text file and upload again"
                ) from exc
        if source_version_id is not None and (
            not isinstance(source_version_id, str)
            or not re.fullmatch(r"sv_[A-Za-z0-9_-]{1,180}", source_version_id)
        ):
            raise InvalidInputError("Invalid source version identity")
        version_id = source_version_id or f"sv_{uuid4().hex}"
        suffix = {v: k for k, v in types.items()}[mime]
        relative = f"originals/{version_id}/original{suffix}"
        path = self.data_root / relative
        version = SourceVersion(
            source_version_id=version_id,
            source_id=source_id,
            notebook_id=notebook_id,
            source_title=title,
            origin=origin,
            provenance=provenance,
            original_status=original_status,
            sha256=_sha(data),
            mime_type=mime,
            byte_size=len(data),
            file_path=relative,
            created_at=_now(),
        ).model_dump()
        async with self.store.project_lock(notebook_id):
            if not source_version_id:
                await asyncio.to_thread(path.parent.mkdir, parents=True, exist_ok=True)
            previous = (
                await self.store.get("version", version_id)
                if source_version_id
                else None
            )
            if previous:
                fields = (
                    "notebook_id",
                    "source_id",
                    "source_title",
                    "origin",
                    "original_status",
                    "sha256",
                    "mime_type",
                    "byte_size",
                    "file_path",
                    "provenance",
                )
                if any(previous.get(key) != version.get(key) for key in fields):
                    raise InvalidInputError(
                        "SNAPSHOT_CONFLICT: version identity already has different content"
                    )
                await self.resolve_file(version_id)
                return previous
            if source_version_id:
                await asyncio.to_thread(
                    publish_snapshot_bytes,
                    path,
                    data,
                    durability_root=self.data_root,
                )
            else:
                await asyncio.to_thread(self._write_new, path, data)
            try:
                await self.store.put("version", version_id, version, create_only=True)
            except Exception as exc:
                # Even a typed DB exception does not establish rollback. Ordinary
                # uploads have no deterministic receipt to make replay safe.
                if source_version_id is None:
                    raise UploadCommitUnknownError(
                        source_id=source_id, source_version_id=version_id
                    ) from exc
                # Preserve deterministic callers' existing reconciliation contract.
                raise
        return version

    @staticmethod
    def _write_new(path, data):
        with path.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())

    async def versions(self, source_id):
        return sorted(
            await self.store.list("version", source_id=source_id),
            key=lambda v: v["created_at"],
        )

    async def _version(self, version_id):
        version = await self.store.get("version", version_id)
        if version is None:
            raise NotFoundError("Source version not found")
        return version

    async def version(self, version_id):
        version = await self._version(version_id)
        extraction = (
            await self.store.get("extraction", version["current_extraction_id"])
            if version.get("current_extraction_id")
            else None
        )
        return {
            **version,
            "extraction": extraction,
            "page_count": extraction.get("page_count") if extraction else None,
            "warnings": extraction.get("warnings", []) if extraction else [],
            "evidence_count": len(extraction.get("evidence_ids", []))
            if extraction
            else 0,
        }

    async def resolve_file(self, version_id):
        version = await self._version(version_id)
        path = (self.data_root / version["file_path"]).resolve()
        if (
            not path.is_relative_to(self.data_root)
            or Path(version["file_path"]).is_absolute()
        ):
            raise InvalidInputError("Unsafe original file path")
        if not path.is_file():
            raise NotFoundError("Original file is missing")
        data = await asyncio.to_thread(path.read_bytes)
        if len(data) != version["byte_size"] or _sha(data) != version["sha256"]:
            raise InvalidInputError("Original file integrity verification failed")
        return path

    @asynccontextmanager
    async def _parser_lock(self, version_id):
        # Independent workers serialize only this version, without holding the
        # project's export/write barrier while CPU parsing runs.
        import fcntl

        directory = self.data_root / ".locks"
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / ("extract-" + _sha(version_id.encode()) + ".lock")).open(
            "a"
        ) as handle:
            while True:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    await asyncio.sleep(0.05)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    async def extract(self, version_id, extraction_id=None, force=False):
        async with self._extraction_locks.setdefault(version_id, asyncio.Lock()):
            async with self._parser_lock(version_id):
                return await self._extract(version_id, extraction_id, force)

    async def _extract(self, version_id, extraction_id, force):
        version = await self._version(version_id)
        selected_id = extraction_id or (
            None if force else version.get("current_extraction_id")
        )
        prior = await self.store.get("extraction", selected_id) if selected_id else None
        if prior and prior["source_version_id"] != version_id:
            raise InvalidInputError("Extraction belongs to another source version")
        if prior and prior["status"] not in ("queued", "running"):
            return prior
        prior_current_id = version.get("current_extraction_id")
        prior_current = (
            await self.store.get("extraction", prior_current_id)
            if prior_current_id
            else None
        )
        prior_status = (prior_current or {}).get("status", version["status"])
        extraction_id = selected_id or f"ex_{uuid4().hex}"
        is_pdf = version["mime_type"] == "application/pdf"
        extraction = (
            prior
            or Extraction(
                extraction_id=extraction_id,
                source_version_id=version_id,
                notebook_id=version["notebook_id"],
                parser_name="pypdf" if is_pdf else "utf8",
                parser_version=importlib.metadata.version("pypdf") if is_pdf else "1",
                status="running",
                created_at=_now(),
            ).model_dump()
        )
        async with self.store.project_lock(version["notebook_id"]):
            await self.store.put("extraction", extraction_id, extraction)
            version["status"] = "extracting"
            if not version.get("current_extraction_id"):
                version["current_extraction_id"] = extraction_id
            await self.store.put("version", version_id, version)
        try:
            path = await self.resolve_file(version_id)
            async with _parse_slots():
                parsed = await asyncio.to_thread(
                    _bounded_parse,
                    path,
                    version["mime_type"],
                    int(os.getenv("STUDY_WORKBENCH_MAX_PDF_PAGES", "300")),
                    float(os.getenv("STUDY_WORKBENCH_EXTRACT_TIMEOUT_SECONDS", "30")),
                    int(os.getenv("STUDY_WORKBENCH_MAX_TEXT_CODEPOINTS", "5000000")),
                )
            extraction.update(parsed)
            records = build_evidence_records(version, extraction_id, parsed["blocks"])
            extraction["evidence_ids"] = [record["evidence_id"] for record in records]
            extraction["completed_at"] = _now()
            async with self.store.project_lock(version["notebook_id"]):
                for record in records:
                    existing = await self.store.get("evidence", record["evidence_id"])
                    if existing is None:
                        await self.store.put(
                            "evidence", record["evidence_id"], record, create_only=True
                        )
                    elif existing != record:
                        raise InvalidInputError("Immutable evidence conflict")
                await self.store.put("extraction", extraction_id, extraction)
                version.update(
                    current_extraction_id=extraction_id, status=extraction["status"]
                )
                await self.store.put("version", version_id, version)
            return extraction
        except Exception as exc:
            extraction.update(
                status="failed", error=str(exc)[:500], completed_at=_now()
            )
            async with self.store.project_lock(version["notebook_id"]):
                await self.store.put("extraction", extraction_id, extraction)
                # A failed reparse must not strand an already readable version.
                version.update(
                    status=prior_status
                    if prior_current_id and prior_current_id != extraction_id
                    else "failed",
                    current_extraction_id=prior_current_id or extraction_id,
                )
                await self.store.put("version", version_id, version)
            raise

    @staticmethod
    def _matches_fresh(evidence, fresh):
        """Exact location/text comparison, never fuzzy remapping to another page."""
        if (
            not fresh
            or fresh.get("verification_origin") == "restored_archive"
            or fresh.get("source_version_id") != evidence["source_version_id"]
            or fresh.get("status") not in ("ready", "partial")
        ):
            return False
        locator = evidence["locator"]
        block = next(
            (
                b
                for b in fresh.get("blocks", [])
                if b["block_id"] == locator["block_id"]
            ),
            None,
        )
        return bool(
            block
            and block.get("page_index") == locator.get("page_index")
            and locator.get("page_label") is None
            and locator.get("bbox") is None
            and type(locator.get("start_offset")) is int
            and type(locator.get("end_offset")) is int
            and 0
            <= locator["start_offset"]
            < locator["end_offset"]
            <= len(block["text"])
            and block["text"][locator["start_offset"] : locator["end_offset"]]
            == evidence["quote"]
            and _sha(evidence["quote"].encode()) == evidence["quote_hash"]
        )

    async def revalidate(self, version_id, extraction_id, fresh_extraction_id):
        version = await self._version(version_id)
        historical = await self.store.get("extraction", extraction_id)
        if not historical or historical["source_version_id"] != version_id:
            raise InvalidInputError("EXTRACTION_VERSION_MISMATCH")
        if (
            version.get("original_status") != "available"
            or version.get("origin") == "remote_text_snapshot"
        ):
            raise InvalidInputError(
                "ORIGINAL_UNAVAILABLE: revalidation requires retained original bytes"
            )
        if fresh_extraction_id == extraction_id:
            raise InvalidInputError("FRESH_EXTRACTION_REQUIRED")
        # Replays may reuse only this job's independently generated extraction.
        existing = await self.store.get("extraction", fresh_extraction_id)
        if existing and existing.get("verification_origin") == "restored_archive":
            raise InvalidInputError("FRESH_EXTRACTION_REQUIRED")
        fresh = await self.extract(version_id, extraction_id=fresh_extraction_id)
        if fresh["status"] == "failed":
            raise InvalidInputError("EXTRACTION_FAILED: retry with a new operation")
        records = await self.list_evidence(version_id, extraction_id)
        matched = [
            record["evidence_id"]
            for record in records
            if self._matches_fresh(record, fresh)
        ]
        report = {
            "source_version_id": version_id,
            "extraction_id": extraction_id,
            "fresh_extraction_id": fresh["extraction_id"],
            "checked_count": len(records),
            "verified_count": len(matched),
            "unverified_count": len(records) - len(matched),
            "checked_at": _now(),
        }
        async with self.store.project_lock(version["notebook_id"]):
            current = await self.store.get("extraction", extraction_id)
            current["revalidation"] = {**report, "evidence_ids": matched}
            await self.store.put("extraction", extraction_id, current)
        return report

    async def evidence(self, evidence_id):
        evidence = await self.store.get("evidence", evidence_id)
        if evidence is None:
            raise NotFoundError("Evidence not found")
        return evidence

    async def list_evidence(self, version_id, extraction_id=None):
        version = await self._version(version_id)
        extraction_id = extraction_id or version.get("current_extraction_id")
        if not extraction_id:
            return []
        extraction = await self.store.get("extraction", extraction_id)
        if not extraction or extraction["source_version_id"] != version_id:
            raise NotFoundError("Extraction not found for this source version")
        return [await self.evidence(id) for id in extraction["evidence_ids"]]

    async def retrieve(self, query, version_ids, limit=12):
        version_ids = list(dict.fromkeys(version_ids))
        if not version_ids:
            raise InvalidInputError(
                "NO_SOURCES_SELECTED: explicitly select sources before searching"
            )
        if len(version_ids) > int(
            os.getenv("STUDY_WORKBENCH_MAX_SELECTED_SOURCES", "20")
        ):
            raise InvalidInputError("SOURCE_LIMIT: too many selected source versions")
        normalized_query, terms = _terms(query)
        if not normalized_query.strip():
            raise InvalidInputError("Question must not be empty")
        scoped = []
        for version_id in version_ids:
            version = await self._version(version_id)
            if version["status"] not in ("ready", "partial"):
                raise InvalidInputError(
                    f"SOURCE_NOT_READY: {version_id} is {version['status']}"
                )
            scoped.extend(await self.list_evidence(version_id))
        hits = []
        for record in scoped:
            normalized, _ = _terms(record["quote"])
            score = sum(
                1 + min(normalized.count(term), 3) * 0.1
                for term in terms
                if term in normalized
            )
            if normalized_query in normalized:
                score += 5
            if score > 0:
                hits.append({**record, "score": score, "retrieval_method": "lexical"})
        ranked = sorted(hits, key=lambda hit: (-hit["score"], hit["evidence_id"]))[
            : max(1, min(limit, 100))
        ]
        for hit in ranked:
            reference = await self.validate_citation(
                {"evidence_id": hit["evidence_id"]}, version_ids
            )
            hit["reference_validity"] = reference["reference_validity"]
            hit["reference_reason"] = reference.get("reason")
            hit["provenance"] = reference.get("provenance")
            hit["independent_support"] = reference.get("independent_support")
        return ranked

    async def validate_citation(self, citation, version_ids, evidence_ids=None):
        evidence_id = citation.get("evidence_id")
        result = EvidenceCitation(
            citation_id=str(citation.get("citation_id") or "c1"),
            evidence_id=evidence_id if isinstance(evidence_id, str) else None,
            quote=citation.get("quote")
            if isinstance(citation.get("quote"), str)
            else "",
            reference_validity="invalid",
        ).model_dump()
        if not isinstance(evidence_id, str) or not evidence_id:
            return {**result, "reason": "Malformed evidence ID"}
        evidence = await self.store.get("evidence", evidence_id)
        if not evidence:
            return {**result, "reason": "Unknown evidence ID"}
        if evidence["source_version_id"] not in version_ids:
            return {
                **result,
                "reference_validity": "out_of_scope",
                "reason": "Evidence is outside the selected source versions",
            }
        if evidence_ids is not None and evidence["evidence_id"] not in evidence_ids:
            return {**result, "reason": "Evidence was not supplied to this answer"}
        if (
            citation.get("source_version_id")
            and citation["source_version_id"] != evidence["source_version_id"]
        ):
            return {**result, "reason": "Source version does not match evidence"}
        quote = citation.get("quote") or evidence["quote"]
        if not isinstance(quote, str) or quote not in evidence["quote"]:
            return {**result, "reason": "Quote does not match evidence"}
        # Recheck against the retained extraction, not merely against a model string.
        extraction = await self.store.get("extraction", evidence["extraction_id"])
        block = next(
            (
                b
                for b in (extraction or {}).get("blocks", [])
                if b["block_id"] == evidence["locator"]["block_id"]
            ),
            None,
        )
        locator = dict(evidence["locator"])
        if (
            not block
            or _sha(evidence["quote"].encode()) != evidence["quote_hash"]
            or block["text"][locator["start_offset"] : locator["end_offset"]]
            != evidence["quote"]
        ):
            return {**result, "reason": "Stored evidence integrity check failed"}
        if evidence["quote"].count(quote) != 1:
            return {**result, "reason": "Quote location is ambiguous within evidence"}
        locator["start_offset"] += evidence["quote"].index(quote)
        locator["end_offset"] = locator["start_offset"] + len(quote)
        # Archive consistency is not proof that the retained text was generated
        # locally from the original. Only a fresh extraction creates unmarked IDs.
        restored = (
            evidence.get("verification_origin") == "restored_archive"
            or (extraction or {}).get("verification_origin") == "restored_archive"
        )
        revalidated = False
        if restored and extraction:
            report = extraction.get("revalidation") or {}
            fresh_id = report.get("fresh_extraction_id")
            if evidence_id in report.get("evidence_ids", []) and fresh_id:
                fresh = await self.store.get("extraction", fresh_id)
                revalidated = self._matches_fresh(evidence, fresh)
        # Historical evidence may outlive its version. Absence is not a fresh
        # verification, even when an older revalidation report still matches.
        version = await self.store.get("version", evidence["source_version_id"])
        derived = (version or {}).get("origin") == "derived_snapshot" or evidence.get(
            "evidence_kind"
        ) == "derived_snapshot"
        unverified = not version or (restored and not revalidated)
        return {
            **result,
            "provenance": (version or {}).get("provenance"),
            "independent_support": False if derived else None,
            "kind": "derived_snapshot"
            if derived
            else "remote_text_snapshot"
            if evidence.get("evidence_kind") == "remote_text_snapshot"
            else "local_evidence",
            "source_version_id": evidence["source_version_id"],
            "source_title": evidence.get("source_title") or "",
            "locator": locator,
            "quote": quote,
            "reference_validity": "unverified" if unverified else "verified",
            "reason": "Restored archive evidence has not been verified by a fresh local extraction"
            if restored and not revalidated
            else "Source version is unavailable; retained citation cannot be freshly verified"
            if not version
            else None,
        }
