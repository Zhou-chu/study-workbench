"""Credential-free project archives, consistent snapshots and atomic fresh restore.

This format deliberately contains visible application records, never raw database
files or LangGraph execution checkpoints. All filesystem work is bounded and all
restored identities are new. Existing projects are never modified by an import.
"""

from __future__ import annotations

import asyncio
import copy
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from api.personal_store import data_root as get_data_root
from api.personal_store import get_store, record_key
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

FORMAT_VERSION = 1
FILES = {
    "notebook": "notebook.json",
    "sources": "sources.json",
    "notes": "notes.json",
    "chat_sessions": "chat-sessions.json",
    "source_insights": "source-insights.json",
    "version": "versions.json",
    "extraction": "extractions.json",
    "evidence": "evidence.jsonl",
    "turn": "turns.jsonl",
    "job": "jobs.json",
    "link": "remote-notebook-links.json",
    "source_link": "remote-source-links.json",
    "artifact": "artifacts.json",
    "selection": "selections.json",
    "import_report": "import-reports.json",
    "note_snapshot": "note-snapshots.json",
    "legacy_chat": "legacy-chat.json",
}
PERSONAL_KINDS = tuple(
    key
    for key in FILES
    if key not in ("notebook", "sources", "notes", "chat_sessions", "source_insights")
)
IDENTITIES = {
    "version": ("source_version_id",),
    "extraction": ("extraction_id",),
    "evidence": ("evidence_id",),
    "turn": ("turn_id",),
    "job": ("job_id",),
    "link": ("link_id", "notebook_id"),
    "source_link": ("source_link_id", "link_id"),
    "artifact": ("artifact_id",),
    "selection": ("notebook_id",),
    "import_report": ("import_report_id", "report_id"),
    "note_snapshot": ("note_id",),
    "legacy_chat": ("chat_session_id",),
}
PREFIXES = {
    "version": "sv_",
    "extraction": "ex_",
    "evidence": "ev_",
    "turn": "turn_",
    "job": "job_",
    "link": "link_",
    "source_link": "sl_",
    "artifact": "artifact_",
    "import_report": "report_",
}
SINGULAR_REFERENCES = {
    "notebook_id": "notebook",
    "source_id": "sources",
    "source_version_id": "version",
    "extraction_id": "extraction",
    "current_extraction_id": "extraction",
    "evidence_id": "evidence",
    "chat_session_id": "chat_sessions",
    "note_id": "notes",
    "turn_id": "turn",
    "artifact_id": "artifact",
}
SECRET_KEY = re.compile(
    r"(password|secret|cookie|credential|authorization|access_token|refresh_token|api_key|master_key|encryption_key|storage_state|signed_url|profile_path)",
    re.I,
)
DROP_KEYS = {
    "connection_id",
    "worker_job_id",
    "command",
    "model_override",
    "lease_until",
    "next_poll_at",
    "idempotency_key",
    "request_hash",
    "download_url",
    "url",
}
TERMINAL_STATES = {
    "succeeded",
    "failed",
    "needs_reauth",
    "submission_unknown",
    "cancelled_local",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")


def _sha(value):
    return hashlib.sha256(value).hexdigest()


@asynccontextmanager
async def _export_job_lock(root, job_id):
    """Serialize a single export across worker processes, independently of the
    short project commit barrier. Process death releases the advisory lock.
    """
    directory = root / ".export-locks"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / (_sha(job_id.encode()) + ".lock")).open("a+b") as handle:
        try:
            while True:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    await asyncio.sleep(0.05)
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _identity(kind, record):
    for field in IDENTITIES.get(kind, ("id",)):
        value = record.get(field)
        if isinstance(value, str) and value and len(value) <= 512:
            return value
    raise InvalidInputError(f"Portable {kind} record has no valid identity")


def _clean(value):
    """Exclude managed secrets and ephemeral URLs, including nested SDK metadata."""
    if isinstance(value, dict):
        return {
            str(k): _clean(v)
            for k, v in value.items()
            if not SECRET_KEY.search(str(k))
            and str(k) not in DROP_KEYS
            and not str(k).lower().endswith("_url")
        }
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _safe_member(name):
    if (
        not isinstance(name, str)
        or not name
        or len(name) > 512
        or "\\" in name
        or "\x00" in name
    ):
        raise InvalidInputError("Unsafe archive path")
    path = PurePosixPath(name)
    if (
        path.is_absolute()
        or any(p in ("", ".", "..") for p in name.split("/"))
        or ":" in name
    ):
        raise InvalidInputError("Unsafe archive path")
    return path


def _confined_file(root, relative):
    _safe_member(relative)
    root = Path(root).resolve()
    path = root / relative
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise InvalidInputError("Symlink is not an allowed original file path")
    if not path.resolve().is_relative_to(root):
        raise InvalidInputError("Unsafe original file path")
    if not path.is_file():
        raise InvalidInputError("Referenced original or artifact file is missing")
    return path


def _rows(project, kind):
    return [project["notebook"]] if kind == "notebook" else project.get(kind, [])


def _validate_project(project, files):
    """Check entity closure before copying or accepting any destination records."""
    if set(project) != set(FILES) or not isinstance(project["notebook"], dict):
        raise InvalidInputError("Invalid portable entity collections")
    ids = {}
    for kind in FILES:
        rows = _rows(project, kind)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise InvalidInputError(f"Invalid {kind} records")
        identities = [_identity(kind, row) for row in rows]
        if len(set(identities)) != len(identities):
            raise InvalidInputError(f"Duplicate {kind} identity")
        ids[kind] = set(identities)
    notebook_id = project["notebook"]["id"]
    if (
        not isinstance(project["notebook"].get("name"), str)
        or not project["notebook"]["name"].strip()
    ):
        raise InvalidInputError("Portable notebook needs a name")

    def visit(value, path=""):
        if isinstance(value, dict):
            for key, item in value.items():
                if (
                    SECRET_KEY.search(key)
                    or key in DROP_KEYS
                    or key.lower().endswith("_url")
                ):
                    raise InvalidInputError(
                        "Portable package contains disallowed secret or runtime configuration fields"
                    )
                target = SINGULAR_REFERENCES.get(key)
                if target and item is not None and item not in ids[target]:
                    raise InvalidInputError(f"Dangling {key} reference in {path}")
                if key == "parent_id" and item not in ids["notebook"] | ids["sources"]:
                    raise InvalidInputError("Dangling chat parent reference")
                if (
                    key == "source"
                    and path.startswith("source_insights")
                    and item not in ids["sources"]
                ):
                    raise InvalidInputError("Dangling source insight reference")
                plural = next(
                    (
                        target
                        for reference, target in SINGULAR_REFERENCES.items()
                        if not key.startswith("remote_")
                        and (
                            key == reference + "s"
                            or key.endswith("_" + reference + "s")
                        )
                    ),
                    None,
                )
                if plural and (
                    not isinstance(item, list)
                    or any(ref not in ids[plural] for ref in item)
                ):
                    raise InvalidInputError(f"Dangling {key} reference in {path}")
                if key == "file_path" and item is not None and item not in files:
                    raise InvalidInputError("Dangling file reference")
                visit(item, path + "." + key)
        elif isinstance(value, list):
            for item in value:
                visit(item, path)

    for kind in FILES:
        for row in _rows(project, kind):
            if row.get("notebook_id", notebook_id) != notebook_id:
                raise InvalidInputError("Cross-project notebook reference")
            visit(row, kind)
    versions = {row["source_version_id"]: row for row in project["version"]}
    extractions = {row["extraction_id"]: row for row in project["extraction"]}
    evidence = {row["evidence_id"]: row for row in project["evidence"]}
    for extraction in extractions.values():
        for identity in extraction.get("evidence_ids", []):
            row = evidence[identity]
            if (
                row["extraction_id"] != extraction["extraction_id"]
                or row["source_version_id"] != extraction["source_version_id"]
            ):
                raise InvalidInputError("Evidence/extraction reference mismatch")
    for kind, prefix in (("version", "originals/"), ("artifact", "artifacts/")):
        for row in project[kind]:
            if row.get("file_path") and not row["file_path"].startswith(prefix):
                raise InvalidInputError(
                    "Entity file reference must use its binary payload directory"
                )
    for source in project["sources"]:
        asset = source.get("asset") or {}
        if asset.get("file_path") and not asset["file_path"].startswith("originals/"):
            raise InvalidInputError(
                "Source file reference must use the originals directory"
            )
    for artifact in project["artifact"]:
        if artifact.get("mime_type") not in (
            "audio/mpeg",
            "audio/mp4",
            "audio/wav",
            "audio/x-wav",
            "audio/ogg",
            "audio/webm",
            "application/octet-stream",
        ):
            raise InvalidInputError("Unsupported artifact MIME type")
    for version in versions.values():
        if version.get("mime_type") not in (
            "application/pdf",
            "text/plain",
            "text/markdown",
        ):
            raise InvalidInputError(
                "Unsupported original MIME type; portable V1 supports PDF, Markdown and text"
            )
        current = version.get("current_extraction_id")
        if (
            current
            and extractions[current]["source_version_id"]
            != version["source_version_id"]
        ):
            raise InvalidInputError("Current extraction reference mismatch")
        if version.get("original_status") == "available" and not version.get(
            "file_path"
        ):
            raise InvalidInputError("Available original has no file reference")
    for row in evidence.values():
        extraction = extractions[row["extraction_id"]]
        if extraction["source_version_id"] != row["source_version_id"]:
            raise InvalidInputError("Evidence version reference mismatch")
        quote = row.get("quote", "")
        if row.get("quote_hash") != _sha(quote.encode()):
            raise InvalidInputError("Evidence quote integrity mismatch")
        locator = row.get("locator", {})
        block = next(
            (
                b
                for b in extraction.get("blocks", [])
                if b.get("block_id") == locator.get("block_id")
            ),
            None,
        )
        start, end = locator.get("start_offset"), locator.get("end_offset")
        if (
            block is None
            or type(start) is not int
            or type(end) is not int
            or start < 0
            or end < start
            or end > len(block.get("text", ""))
            or block["text"][start:end] != quote
            or locator.get("page_index") != block.get("page_index")
            or locator.get("page_label") != block.get("page_label")
            or locator.get("bbox") != block.get("bbox")
            or (
                locator.get("page_index") is not None
                and (
                    type(locator["page_index"]) is not int
                    or locator["page_index"] < 0
                    or type(extraction.get("page_count")) is not int
                    or locator["page_index"] >= extraction["page_count"]
                )
            )
        ):
            raise InvalidInputError("Evidence locator integrity mismatch")

    # A manifest hash is not proof of a model citation. Verify every claimed
    # citation against retained extraction text and the answer's frozen scope.
    for kind in ("turn", "note_snapshot"):
        for record in project[kind]:
            scope = record.get("scope_snapshot", {})
            allowed = scope.get("source_version_ids")
            for citation in record.get("citations", []):
                if citation.get("reference_validity") != "verified":
                    continue
                item = evidence.get(citation.get("evidence_id"))
                if (
                    not item
                    or citation.get("source_version_id") != item["source_version_id"]
                ):
                    raise InvalidInputError(
                        "Verified citation has an invalid evidence/version identity"
                    )
                if allowed is not None and item["source_version_id"] not in allowed:
                    raise InvalidInputError(
                        "Verified citation is outside the frozen source scope"
                    )
                supplied = record.get("evidence_ids")
                if kind == "turn" and (
                    allowed is None
                    or supplied is None
                    or item["evidence_id"] not in supplied
                ):
                    raise InvalidInputError(
                        "Verified citation was not included in the answer evidence scope"
                    )
                quote = citation.get("quote", item["quote"])
                if (
                    not isinstance(quote, str)
                    or not quote
                    or item["quote"].count(quote) != 1
                ):
                    raise InvalidInputError(
                        "Verified citation quote is invalid or ambiguous"
                    )
                expected = dict(item["locator"])
                expected["start_offset"] += item["quote"].index(quote)
                expected["end_offset"] = expected["start_offset"] + len(quote)
                if citation.get("locator", expected) != expected:
                    raise InvalidInputError(
                        "Verified citation locator does not match the retained text"
                    )


class CommitOutcomeUnknown(DatabaseOperationError):
    """Keep staged immutable bytes if a database commit acknowledgement was lost."""


class SurrealProjectRepository:
    def __init__(self, store):
        self.store = store

    async def read(self, notebook_id):
        from open_notebook.database.repository import ensure_record_id, repo_query
        from open_notebook.domain.notebook import Notebook

        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise NotFoundError("Notebook not found")
        sources = await notebook.get_sources(include_full_text=True)
        notes = await notebook.get_notes(include_content=True)
        parents = [
            ensure_record_id(notebook_id),
            *[ensure_record_id(str(s.id)) for s in sources],
        ]
        related = await repo_query(
            "SELECT in AS session, out AS parent_id FROM refers_to WHERE out IN $parents FETCH session;",
            {"parents": parents},
        )
        sessions, history, seen = [], [], set()
        for relation in related:
            session = relation.get("session")
            if not isinstance(session, dict) or str(session.get("id")) in seen:
                continue
            identity = str(session["id"])
            seen.add(identity)
            parent = str(relation["parent_id"])
            sessions.append(
                {key: session.get(key) for key in ("id", "title", "created", "updated")}
                | {"parent_id": parent}
            )
            restored = await self.store.get("legacy_chat", identity)
            messages = await self._visible_messages(
                identity,
                source_chat=parent != notebook_id,
                allow_missing=restored is not None,
            )
            historical = restored.get("messages", []) if restored else []
            known = {m.get("id") for m in historical}
            history.append(
                {
                    "chat_session_id": identity,
                    "notebook_id": notebook_id,
                    "history_origin": "normalized_visible_messages",
                    "messages": historical
                    + [m for m in messages if m.get("id") not in known],
                }
            )
        insights = (
            await repo_query(
                "SELECT id, source, insight_type, content FROM source_insight WHERE source IN $sources;",
                {"sources": parents[1:]},
            )
            if sources
            else []
        )
        return {
            "notebook": notebook.model_dump(mode="json"),
            "sources": [s.model_dump(mode="json") for s in sources],
            "notes": [n.model_dump(mode="json") for n in notes],
            "chat_sessions": sessions,
            "legacy_chat": history,
            "source_insights": insights,
        }

    async def _visible_messages(
        self, session_id, source_chat=False, allow_missing=False
    ):
        from open_notebook.config import LANGGRAPH_CHECKPOINT_FILE

        if not Path(LANGGRAPH_CHECKPOINT_FILE).is_file():
            if allow_missing:
                return []
            raise InvalidInputError(
                "Legacy SQLite history is unavailable; project export cannot claim complete history"
            )
        from langchain_core.runnables import RunnableConfig

        from api.routers._chat_shared import extract_chat_messages

        graph: Any
        if source_chat:
            from open_notebook.graphs.source_chat import source_chat_graph as graph
        else:
            from open_notebook.graphs.chat import graph
        try:
            state = await asyncio.to_thread(
                graph.get_state,
                config=RunnableConfig(configurable={"thread_id": session_id}),
            )
            return [
                message.model_dump(mode="json")
                for message in extract_chat_messages(state.values.get("messages", []))
                if message.type in ("human", "ai")
            ]
        except Exception as exc:
            raise InvalidInputError(
                "Legacy SQLite history could not be read; export stopped"
            ) from exc

    async def commit(self, project, records):
        from open_notebook.database.repository import db_connection, ensure_record_id

        queries = ["BEGIN TRANSACTION;"]
        params: dict[str, Any] = {}

        def create(identity, value):
            n = len(params)
            params[f"r{n}"], params[f"v{n}"] = ensure_record_id(identity), value
            queries.append(f"CREATE $r{n} CONTENT $v{n};")

        def relate(origin, relation, target):
            n = len(params)
            params[f"f{n}"], params[f"t{n}"] = (
                ensure_record_id(origin),
                ensure_record_id(target),
            )
            queries.append(f"RELATE $f{n}->{relation}->$t{n};")

        notebook_id = project["notebook"]["id"]
        create(
            notebook_id,
            {
                key: project["notebook"].get(key)
                for key in ("name", "description", "archived")
                if project["notebook"].get(key) is not None
            },
        )
        for source in project["sources"]:
            create(
                source["id"],
                {
                    key: source.get(key)
                    for key in ("asset", "title", "topics", "full_text")
                    if source.get(key) is not None
                },
            )
            relate(source["id"], "reference", notebook_id)
        for note in project["notes"]:
            create(
                note["id"],
                {
                    key: note.get(key)
                    for key in ("title", "content", "note_type")
                    if note.get(key) is not None
                },
            )
            relate(note["id"], "artifact", notebook_id)
        for session in project["chat_sessions"]:
            create(session["id"], {"title": session.get("title")})
            relate(session["id"], "refers_to", session.get("parent_id", notebook_id))
        for insight in project["source_insights"]:
            create(
                insight["id"],
                {
                    "source": ensure_record_id(insight["source"]),
                    "insight_type": insight.get("insight_type", "restored"),
                    "content": insight.get("content", ""),
                    "embedding": [],
                },
            )
        for kind, identity, value in records:
            create(record_key(kind, identity), {"app_id": identity, "payload": value})
        queries.append("COMMIT TRANSACTION;")
        try:
            async with db_connection() as connection:
                response = await connection.query_raw("\n".join(queries), params)
        except (Exception, asyncio.CancelledError) as exc:
            # Never delete files that a successfully committed transaction may reference.
            raise CommitOutcomeUnknown(
                "Restore commit outcome is unknown; immutable files retained for recovery. Do not blindly retry."
            ) from exc
        results = response.get("result", []) if isinstance(response, dict) else []
        if not results:
            raise CommitOutcomeUnknown(
                "Restore transaction returned no acknowledgement; files retained for recovery"
            )
        if any(row.get("status") == "ERR" for row in results):
            raise DatabaseOperationError(
                "Portable restore transaction was rejected and rolled back"
            )


class PortableService:
    def __init__(self, store=None, project_repository=None, data_root=None):
        self.store = store or get_store()
        self.root = Path(data_root or get_data_root()).resolve()
        self.projects = project_repository or SurrealProjectRepository(self.store)
        self.max_bytes = int(
            os.getenv("STUDY_WORKBENCH_PORTABLE_MAX_BYTES", str(1024 * 1024 * 1024))
        )
        self.max_entries = int(
            os.getenv("STUDY_WORKBENCH_PORTABLE_MAX_ENTRIES", "10000")
        )
        self.max_ratio = int(os.getenv("STUDY_WORKBENCH_PORTABLE_MAX_RATIO", "200"))

    async def _snapshot(self, notebook_id, stage):
        async with self.store.project_lock(notebook_id):
            before = await self.projects.read(notebook_id)
            project = _clean(copy.deepcopy(before))
            for kind in PERSONAL_KINDS:
                if kind == "legacy_chat":
                    continue
                project[kind] = _clean(
                    await self.store.list(kind, notebook_id=notebook_id)
                )
            project.setdefault("legacy_chat", [])
            project["job"] = [
                job
                for job in project["job"]
                if job.get("operation") != "portable_export"
            ]
            # All binary bytes are copied while the short commit barrier is held.
            # Compression happens afterwards and never re-reads live project state.
            files, missing = await asyncio.to_thread(self._stage_files, project, stage)
            after = await self.projects.read(notebook_id)
            if _json(before) != _json(after):
                raise InvalidInputError(
                    "Project changed during legacy snapshot; retry after writes complete"
                )
            _validate_project(project, files)
            return project, files, missing

    def _stage_files(self, project, stage):
        files, missing, total = {}, [], 0
        file_mapping = {}

        def copy_file(path, collection, expected=None):
            nonlocal total
            size = path.stat().st_size
            total += size
            if total > self.max_bytes:
                raise InvalidInputError("Portable project exceeds the size limit")
            digest = hashlib.sha256()
            temp = stage / ("copy-" + uuid4().hex)
            before = path.stat()
            with path.open("rb") as source, temp.open("xb") as out:
                while block := source.read(1024 * 1024):
                    out.write(block)
                    digest.update(block)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (
                after.st_size,
                after.st_mtime_ns,
                after.st_ino,
            ):
                raise InvalidInputError("Original file changed during snapshot")
            digest_hex = digest.hexdigest()
            if expected and (
                expected.get("sha256") != digest_hex
                or expected.get("byte_size") != size
            ):
                raise InvalidInputError(
                    "Original/artifact integrity verification failed"
                )
            suffix = (
                path.suffix.lower()
                if re.fullmatch(r"\.[a-zA-Z0-9]{1,8}", path.suffix)
                else ".bin"
            )
            name = f"{collection}/{digest_hex}{suffix}"
            destination = stage / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                temp.unlink()
            else:
                temp.replace(destination)
            files[name] = {"sha256": digest_hex, "byte_size": size}
            return name

        for kind in ("version", "artifact"):
            for record in project[kind]:
                if kind == "version" and record.get("original_status") != "available":
                    missing.append(
                        {
                            "source_version_id": record["source_version_id"],
                            "reason": record.get("original_status", "missing"),
                        }
                    )
                relative = record.get("file_path")
                if relative:
                    path = _confined_file(self.root, relative)
                    record["file_path"] = copy_file(
                        path, "originals" if kind == "version" else "artifacts", record
                    )
                    file_mapping[relative] = record["file_path"]

                elif kind == "artifact":
                    raise InvalidInputError(
                        "Saved artifact is missing its file reference"
                    )
        from open_notebook.config import UPLOADS_FOLDER

        upload_root = Path(UPLOADS_FOLDER).resolve()
        for source in project["sources"]:
            asset = source.get("asset")
            if not isinstance(asset, dict) or not asset.get("file_path"):
                if not any(v["source_id"] == source["id"] for v in project["version"]):
                    missing.append(
                        {
                            "source_id": source["id"],
                            "reason": "No locally available original; source text/metadata preserved",
                        }
                    )
                continue
            value = asset["file_path"]
            path = Path(value)
            # Old source uploads are confined to the existing upstream upload root.
            resolved = (
                path.resolve()
                if path.is_absolute() or path.exists()
                else (self.root / path).resolve()
            )
            allowed = self.root if resolved.is_relative_to(self.root) else upload_root
            if not resolved.is_relative_to(allowed):
                raise InvalidInputError("Unsafe legacy original file path")
            file = _confined_file(allowed, str(resolved.relative_to(allowed)))
            asset["file_path"] = copy_file(file, "originals")
            file_mapping[value] = asset["file_path"]
            if not any(v["source_id"] == source["id"] for v in project["version"]):
                descriptor = files[asset["file_path"]]
                mime = {
                    ".pdf": "application/pdf",
                    ".txt": "text/plain",
                    ".md": "text/markdown",
                }.get(file.suffix.lower(), "application/octet-stream")
                project["version"].append(
                    {
                        "source_version_id": "sv_"
                        + uuid5(
                            NAMESPACE_URL,
                            "legacy:" + source["id"] + ":" + descriptor["sha256"],
                        ).hex,
                        "notebook_id": project["notebook"]["id"],
                        "source_id": source["id"],
                        "source_title": source.get("title") or "Legacy original",
                        "origin": "upload",
                        "original_status": "available",
                        "file_path": asset["file_path"],
                        "sha256": descriptor["sha256"],
                        "byte_size": descriptor["byte_size"],
                        "mime_type": mime,
                        "created_at": str(source.get("created") or _now()),
                        "status": "not_extracted",
                        "current_extraction_id": None,
                    }
                )

        def normalize_paths(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if (
                        key == "file_path"
                        and isinstance(item, str)
                        and item in file_mapping
                    ):
                        value[key] = file_mapping[item]
                    else:
                        normalize_paths(item)
            elif isinstance(value, list):
                for item in value:
                    normalize_paths(item)

        normalize_paths(project)
        return files, missing

    def _write_archive(self, project, files, missing, stage, target):
        for kind, filename in FILES.items():
            value = project[kind]
            raw = (
                b"".join(_json(item) + b"\n" for item in value)
                if filename.endswith(".jsonl")
                else _json(value)
            )
            (stage / filename).write_bytes(raw)
            files[filename] = {"sha256": _sha(raw), "byte_size": len(raw)}
        by_id = {row["evidence_id"]: row for row in project["evidence"]}
        versions = {row["source_version_id"]: row for row in project["version"]}
        for index, note in enumerate(project["notes"]):
            snapshot: dict[str, Any] = next(
                (r for r in project["note_snapshot"] if r["note_id"] == note["id"]), {}
            )
            lines = [
                f"# {note.get('title') or 'Untitled note'}",
                "",
                note.get("content") or "",
            ]
            for citation in snapshot.get("citations", []):
                evidence = by_id.get(citation.get("evidence_id"), citation)
                version = versions.get(evidence.get("source_version_id"), {})
                locator = evidence.get("locator") or {}
                position = (
                    f"PDF page {locator['page_index'] + 1}"
                    if locator.get("page_index") is not None
                    else f"block {locator.get('block_id', 'unmapped')}"
                )
                title = (
                    evidence.get("source_title")
                    or version.get("source_title")
                    or "Remote reference"
                )
                file = version.get("file_path")
                label = f"[{title}](../{file})" if file else title
                lines.extend(
                    ["", f"- {label}, {position}", f"  {evidence.get('quote', '')}"]
                )
            name = f"notes/note-{index + 1}.md"
            (stage / "notes").mkdir(exist_ok=True)
            raw = "\n".join(lines).encode()
            (stage / name).write_bytes(raw)
            files[name] = {"sha256": _sha(raw), "byte_size": len(raw)}
        readme = (
            "StudyWorkbench portable project, format 1.\n\n"
            "Includes immutable originals, extraction text, evidence, notes, normalized visible chat and saved assets.\n"
            "Missing originals and unfinished jobs are listed in manifest.json.\n"
            "Credentials, Google sessions, model keys, embeddings and raw LangGraph checkpoints are excluded.\n"
            "Restore creates new identities; remote links require re-verification and historical jobs never replay.\n"
        ).encode()
        (stage / "README.md").write_bytes(readme)
        files["README.md"] = {"sha256": _sha(readme), "byte_size": len(readme)}
        manifest = {
            "format_version": FORMAT_VERSION,
            "application": "StudyWorkbench",
            "upstream_version": "1.15.0",
            "created_at": _now(),
            "files": files,
            "entity_counts": {kind: len(_rows(project, kind)) for kind in FILES},
            "coverage": {
                "legacy_history": "normalized_visible_messages",
                "originals": "available_local_bytes",
                "credentials": "excluded",
                "runtime_checkpoints": "excluded",
            },
            "missing": missing,
            "unfinished_jobs": [
                {
                    "job_id": job["job_id"],
                    "operation": job.get("operation"),
                    "state": job.get("state"),
                }
                for job in project["job"]
                if job.get("state") not in TERMINAL_STATES
            ],
            "restore_requirements": [
                "Configure credentials separately",
                "Reverify remote links",
                "Rebuild embeddings if desired",
            ],
        }
        (stage / "manifest.json").write_bytes(_json(manifest))
        if (
            sum(item["byte_size"] for item in files.values()) > self.max_bytes
            or len(files) + 1 > self.max_entries
        ):
            raise InvalidInputError(
                "Portable archive exceeds configured size or entry limit"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".partial")
        try:
            # ZIP_STORED keeps compression ratio bounded even for large repetitive
            # source text and means our own output always passes the bomb guard.
            with zipfile.ZipFile(
                temporary, "w", compression=zipfile.ZIP_STORED
            ) as package:
                for file in sorted(files):
                    package.write(stage / file, file)
                package.write(stage / "manifest.json", "manifest.json")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return manifest

    async def export_project(self, notebook_id, export_id=None):
        export_id = export_id or "export_" + uuid4().hex
        self.root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".portable-", dir=self.root) as folder:
            stage = Path(folder)
            project, files, missing = await self._snapshot(notebook_id, stage)
            target = self.root / "exports" / f"{export_id}.zip"
            manifest = await asyncio.to_thread(
                self._write_archive, project, files, missing, stage, target
            )
        return {"export_id": export_id, "path": target, "manifest": manifest}

    def _read_archive(self, archive, stage):
        try:
            package = zipfile.ZipFile(archive)
        except (zipfile.BadZipFile, OSError, ValueError) as exc:
            raise InvalidInputError("Invalid portable ZIP archive") from exc
        with package:
            entries = package.infolist()
            if len(entries) > self.max_entries:
                raise InvalidInputError("Archive entry count exceeds configured limit")
            names, total = set(), 0
            for entry in entries:
                _safe_member(entry.filename)
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise InvalidInputError("Archive symlink entries are forbidden")
                if entry.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    raise InvalidInputError(
                        "Archive special files/directories are forbidden"
                    )
                if entry.filename in names:
                    raise InvalidInputError("Duplicate archive path")
                names.add(entry.filename)
                if entry.flag_bits & 1:
                    raise InvalidInputError("Encrypted archive entries are unsupported")
                if entry.compress_type not in (
                    zipfile.ZIP_STORED,
                    zipfile.ZIP_DEFLATED,
                ):
                    raise InvalidInputError("Unsupported archive compression method")
                total += entry.file_size
                if total > self.max_bytes:
                    raise InvalidInputError(
                        "Archive expanded size exceeds configured limit"
                    )
                if entry.file_size > max(
                    1024 * 1024, entry.compress_size * self.max_ratio
                ):
                    raise InvalidInputError(
                        "Archive compression ratio exceeds configured limit"
                    )
            if "manifest.json" not in names:
                raise InvalidInputError("Portable archive is missing manifest.json")
            if package.getinfo("manifest.json").file_size > 8 * 1024 * 1024:
                raise InvalidInputError("Portable manifest exceeds size limit")
            try:
                manifest = json.loads(package.read("manifest.json"))
            except (ValueError, UnicodeError, zipfile.BadZipFile) as exc:
                raise InvalidInputError("Invalid portable manifest") from exc
            if not isinstance(manifest, dict):
                raise InvalidInputError("Invalid portable manifest object")
            if (
                type(manifest.get("format_version")) is not int
                or manifest["format_version"] != FORMAT_VERSION
            ):
                raise InvalidInputError("Unsupported portable format version")
            files = manifest.get("files")
            if (
                not isinstance(files, dict)
                or set(files) != names - {"manifest.json"}
                or not set(FILES.values()).issubset(files)
            ):
                raise InvalidInputError(
                    "Manifest file inventory does not match archive"
                )
            for name, descriptor in files.items():
                _safe_member(name)
                if (
                    name in FILES.values()
                    and package.getinfo(name).file_size > 32 * 1024 * 1024
                ):
                    raise InvalidInputError(
                        "Portable entity metadata exceeds size limit"
                    )
                if (
                    not isinstance(descriptor, dict)
                    or descriptor.get("byte_size") != package.getinfo(name).file_size
                ):
                    raise InvalidInputError("File integrity size mismatch")
                path = stage / name
                path.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                try:
                    with package.open(name) as src, path.open("xb") as dst:
                        while chunk := src.read(1024 * 1024):
                            digest.update(chunk)
                            dst.write(chunk)
                except (zipfile.BadZipFile, RuntimeError) as exc:
                    raise InvalidInputError(
                        "Archive file integrity verification failed"
                    ) from exc
                if digest.hexdigest() != descriptor.get("sha256"):
                    raise InvalidInputError("File integrity hash mismatch")
            project = {}
            try:
                for kind, filename in FILES.items():
                    raw = (stage / filename).read_bytes()
                    project[kind] = (
                        [json.loads(line) for line in raw.splitlines() if line]
                        if filename.endswith(".jsonl")
                        else json.loads(raw)
                    )
            except (ValueError, UnicodeError) as exc:
                raise InvalidInputError("Invalid portable entity JSON") from exc
            _validate_project(project, files)
            if manifest.get("entity_counts") != {
                kind: len(_rows(project, kind)) for kind in FILES
            }:
                raise InvalidInputError("Manifest entity counts do not match archive")
            for kind in ("version", "artifact"):
                for row in project[kind]:
                    if row.get("file_path"):
                        descriptor = files[row["file_path"]]
                        if (
                            row.get("sha256") != descriptor["sha256"]
                            or row.get("byte_size") != descriptor["byte_size"]
                        ):
                            raise InvalidInputError("Entity file integrity mismatch")
            return project, manifest

    def _remap(self, project, prefix):
        mapping = {}
        for kind in FILES:
            for row in _rows(project, kind):
                old = _identity(kind, row)
                if old in mapping:
                    continue
                if kind in (
                    "notebook",
                    "sources",
                    "notes",
                    "chat_sessions",
                    "source_insights",
                ):
                    table = {
                        "sources": "source",
                        "notes": "note",
                        "chat_sessions": "chat_session",
                        "source_insights": "source_insight",
                    }.get(kind, kind)
                    mapping[old] = table + ":" + uuid4().hex
                else:
                    mapping[old] = PREFIXES.get(kind, "restored_") + uuid4().hex

        def remap(value, key=None):
            if isinstance(value, dict):
                return {field: remap(item, field) for field, item in value.items()}
            if isinstance(value, list):
                return [remap(item, key) for item in value]
            if isinstance(value, str):
                if key == "file_path":
                    return f"{prefix}/{value}"
                if key and key.startswith("remote_"):
                    return value
                # Identity fields only: prose that happens to equal an ID is data.
                if key and (
                    key in ("id", "source", "parent_id")
                    or key.endswith(("_id", "_ids"))
                ):
                    return mapping.get(value, value)
                return value
            return value

        restored = remap(project)

        def distrust(value):
            if isinstance(value, dict):
                if value.get("reference_validity") == "verified":
                    value.update(
                        reference_validity="unverified",
                        archived_reference_validity="verified",
                        reason="Restored historical citation; archive integrity is not a new extraction verification",
                    )
                for child in value.values():
                    distrust(child)
            elif isinstance(value, list):
                for child in value:
                    distrust(child)

        distrust(restored)
        # Archive consistency cannot establish that text was locally extracted.
        # Overwrite any claimed provenance so later citation validation cannot
        # promote imported evidence merely by comparing imported records.
        for kind in ("extraction", "evidence"):
            for row in restored[kind]:
                row["verification_origin"] = "restored_archive"
                row.pop("revalidation", None)

        def refresh_scope_hashes(value):
            if isinstance(value, dict):
                scope = value.get("scope_snapshot")
                if isinstance(scope, dict) and scope.get("scope_hash"):
                    old_hash = scope["scope_hash"]
                    if scope.get("engine") == "independent":
                        scope["source_version_ids"] = sorted(
                            scope.get("source_version_ids", [])
                        )
                        scope["scope_hash"] = _sha(
                            _json({k: v for k, v in scope.items() if k != "scope_hash"})
                        )
                    elif scope.get("engine") == "notebooklm":
                        scope["scope_hash"] = _sha(
                            _json(
                                {
                                    "versions": sorted(
                                        scope.get("source_version_ids", [])
                                    ),
                                    "remote": sorted(
                                        scope.get("remote_source_ids", [])
                                    ),
                                    "notebook": scope.get("remote_notebook_id"),
                                }
                            )
                        )
                    if "scope_hash" in value:
                        value["archived_scope_hash"] = old_hash
                        value["scope_hash"] = scope["scope_hash"]
                for child in value.values():
                    refresh_scope_hashes(child)
            elif isinstance(value, list):
                for child in value:
                    refresh_scope_hashes(child)

        refresh_scope_hashes(restored)
        for row in restored["link"] + restored["source_link"]:
            row.update(
                mapping_status="unverified",
                remote_status="unverified",
                last_checked_at=None,
                requires_rebind=True,
            )
        for job in restored["job"]:
            job.update(
                historical_state=job.get("state"),
                state="cancelled_local",
                replay_allowed=False,
                restored_history=True,
                idempotency_key="restored:" + job["job_id"],
            )
        for extraction in restored["extraction"]:
            if extraction.get("status") in ("queued", "running"):
                extraction.update(
                    status="failed",
                    error="Restored incomplete extraction; explicitly re-extract to continue",
                )
        for version in restored["version"]:
            if version.get("status") in ("queued", "extracting"):
                version["status"] = "failed"
        return restored, mapping

    async def import_archive(self, archive):
        self.root.mkdir(parents=True, exist_ok=True)
        restore_id = uuid4().hex
        prefix = "restored/" + restore_id
        destination = self.root / prefix
        with tempfile.TemporaryDirectory(prefix=".import-", dir=self.root) as folder:
            stage = Path(folder)
            try:
                project, manifest = await asyncio.to_thread(
                    self._read_archive, archive, stage
                )
            except (
                TypeError,
                KeyError,
                AttributeError,
                RecursionError,
                UnicodeError,
            ) as exc:
                raise InvalidInputError(
                    "Invalid portable entity or manifest schema"
                ) from exc
            restored, mapping = self._remap(project, prefix)
            # Keep only binary payloads in the durable directory; all entity JSON
            # lives transactionally in SurrealDB after successful validation.
            binary = stage / ".payloads"
            binary.mkdir()
            for name in manifest["files"]:
                if name.startswith(("originals/", "artifacts/")):
                    target = binary / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    (stage / name).replace(target)
            destination.parent.mkdir(parents=True, exist_ok=True)
            binary.replace(destination)
            records = [
                (kind, _identity(kind, row), row)
                for kind in PERSONAL_KINDS
                for row in restored[kind]
            ]
            try:
                await self.projects.commit(restored, records)
            except CommitOutcomeUnknown:
                raise
            except BaseException:
                await asyncio.to_thread(shutil.rmtree, destination, True)
                raise
        return {
            "notebook_id": restored["notebook"]["id"],
            "id_map": mapping,
            "entity_counts": manifest["entity_counts"],
            "missing": manifest.get("missing", []),
            "warnings": [
                "Remote links require re-verification",
                "Historical jobs will not be replayed",
                "Credentials and embeddings were not restored",
            ],
        }

    async def request_export(self, notebook_id, idempotency_key):
        if (
            not isinstance(idempotency_key, str)
            or not idempotency_key.strip()
            or len(idempotency_key) > 200
        ):
            raise InvalidInputError(
                "A nonempty idempotency key of at most 200 characters is required"
            )
        # Verify that the project exists before scheduling an inaccessible job.
        await self.projects.read(notebook_id)
        job_id = (
            "job_"
            + uuid5(NAMESPACE_URL, f"portable:{notebook_id}:{idempotency_key}").hex
        )
        async with self.store.project_lock(notebook_id):
            prior = await self.store.get("job", job_id)
            if prior:
                return prior
            job = {
                "job_id": job_id,
                "notebook_id": notebook_id,
                "provider": "local",
                "operation": "portable_export",
                "idempotency_key": idempotency_key,
                "request_hash": _sha(_json({"notebook_id": notebook_id})),
                "request_snapshot": {"notebook_id": notebook_id},
                "state": "queued",
                "submission_state": "not_submitted",
                "attempts": 0,
                "created_at": _now(),
            }
            await self.store.put("job", job_id, job, create_only=True)
        try:
            from surreal_commands import submit_command

            worker_id = await asyncio.to_thread(
                submit_command, "open_notebook", "export_portable", {"job_id": job_id}
            )
        except Exception as exc:
            async with self.store.project_lock(notebook_id):
                job.update(
                    state="failed",
                    error={
                        "code": "QUEUE_UNAVAILABLE",
                        "message": "Export could not be queued",
                    },
                    updated_at=_now(),
                )
                await self.store.put("job", job_id, job)
            raise DatabaseOperationError(
                "Export could not be queued; retry with a new idempotency key"
            ) from exc
        async with self.store.project_lock(notebook_id):
            current = await self.store.get("job", job_id)
            if current is None:
                raise NotFoundError("Export job disappeared during queue submission")
            job = current
            job.update(worker_job_id=str(worker_id), submission_state="confirmed")
            await self.store.put("job", job_id, job)
        return job

    async def run_export(self, job_id):
        job = await self.store.get("job", job_id)
        if not job or job.get("operation") != "portable_export":
            raise NotFoundError("Export job not found")
        if job.get("replay_allowed") is False:
            raise InvalidInputError("Restored historical jobs cannot be replayed")
        if job.get("state") == "succeeded":
            return job
        notebook_id = job["notebook_id"]
        # Separate export lock prevents duplicate workers without blocking project writes.
        async with _export_job_lock(self.root, job_id):
            job = await self.store.get("job", job_id)
            if job is None:
                raise NotFoundError("Export job not found")
            if job.get("state") == "succeeded":
                return job
            async with self.store.project_lock(notebook_id):
                job.update(
                    state="running",
                    attempts=job.get("attempts", 0) + 1,
                    updated_at=_now(),
                )
                await self.store.put("job", job_id, job)
            export_id = "export_" + uuid5(NAMESPACE_URL, job_id).hex
            try:
                result = await self.export_project(notebook_id, export_id=export_id)
                path = result["path"]
                digest = await asyncio.to_thread(_file_hash, path)
                export = {
                    "export_id": export_id,
                    "notebook_id": notebook_id,
                    "job_id": job_id,
                    "file_path": str(path.relative_to(self.root)),
                    "sha256": digest,
                    "byte_size": path.stat().st_size,
                    "created_at": _now(),
                    "manifest": result["manifest"],
                }
                async with self.store.project_lock(notebook_id):
                    await self.store.put("export", export_id, export)
                    job.update(
                        state="succeeded",
                        result={
                            "export_id": export_id,
                            "download_url": f"/api/personal/exports/{export_id}/download",
                        },
                        updated_at=_now(),
                    )
                    await self.store.put("job", job_id, job)
            except Exception:
                async with self.store.project_lock(notebook_id):
                    job.update(
                        state="failed",
                        error={
                            "code": "EXPORT_FAILED",
                            "message": "Export failed consistency, integrity or storage checks; no download was published",
                        },
                        updated_at=_now(),
                    )
                    await self.store.put("job", job_id, job)
                raise
        return job

    async def download(self, export_id):
        exported = await self.store.get("export", export_id)
        if not exported:
            raise NotFoundError("Export not found")
        path = _confined_file(self.root, exported["file_path"])
        digest = await asyncio.to_thread(_file_hash, path)
        if path.stat().st_size != exported["byte_size"] or digest != exported["sha256"]:
            raise InvalidInputError("Export integrity verification failed")
        return path


_service = None


def get_portable_service():
    global _service
    if _service is None:
        _service = PortableService()
    return _service
