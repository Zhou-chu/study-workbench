"""Pinned public Web SDK adapter. Never silently substitutes a test adapter.

Every call owns a short-lived SDK context. No cookie material is returned or
logged. Strict chat is deliberately unavailable: v0.8.5 ``conversation_id=None``
continues server history, and isolated non-destructive new sessions are unverified.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .contracts import (
    SDK_VERSION,
    AudioRequest,
    BridgeAnswer,
    BridgeAskRequest,
    BridgeError,
    Capability,
    CapabilityMatrix,
    ConnectionStatus,
    CreateNotebookRequest,
    FetchTextRequest,
    NotebookPage,
    RemoteArtifact,
    RemoteNotebook,
    RemoteSource,
    RemoteSourcePage,
    RemoteTextResult,
    SubmissionResult,
    UploadSourceRequest,
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@asynccontextmanager
async def sdk_client(path: Path):
    import notebooklm
    from notebooklm.options import ClientConfig, RetryOptions, WebBackendConfig

    if notebooklm.__version__ != SDK_VERSION:
        raise BridgeError(
            "SDK_VERSION_MISMATCH", "Install the exact locked NotebookLM SDK version."
        )
    # No hidden SDK mutation retries or keepalive credential refresh loop.
    config = ClientConfig(
        backend=WebBackendConfig(),
        retry=RetryOptions(
            rate_limit_max_retries=0,
            server_error_max_retries=0,
        ),
    )
    async with notebooklm.NotebookLMClient.from_storage(
        path=str(path), config=config
    ) as client:
        yield client


class SDKNotebookLMBridge:
    def __init__(self, storage_path: Path | None = None, client_factory=None):
        self.storage_path = storage_path or Path(
            os.environ.get(
                "NOTEBOOKLM_STORAGE_PATH",
                str(
                    Path.home()
                    / ".local/share/study-workbench/notebooklm/storage_state.json"
                ),
            )
        )
        self._factory = client_factory or sdk_client
        self._status = ConnectionStatus()
        self._disabled = False
        self._slot = asyncio.Lock()
        self._login_flow: dict[str, Any] | None = None
        self._verified: dict[str, str] = {}

    def connection_status(self) -> ConnectionStatus:
        return self._status

    @asynccontextmanager
    async def _client(self):
        async with self._slot:
            if self._disabled or not self.storage_path.is_file():
                raise BridgeError(
                    "NEEDS_REAUTH",
                    "Connect NotebookLM in the application runtime first.",
                )
            if self.storage_path.is_symlink() or self.storage_path.parent.is_symlink():
                raise BridgeError(
                    "UNSAFE_PROFILE_PATH",
                    "The application profile must not be a symlink.",
                )
            self.storage_path.parent.chmod(0o700)
            self.storage_path.chmod(0o600)
            async with self._factory(self.storage_path) as client:
                yield client

    async def verify_connection(self) -> ConnectionStatus:
        if self._disabled or not self.storage_path.is_file():
            self._status = ConnectionStatus(
                state="disconnected", reason="PROFILE_MISSING"
            )
            return self._status
        self._status = ConnectionStatus(state="verifying")
        try:
            async with self._client() as client:
                rows = await client.notebooks.list()
                if not isinstance(rows, list) or any(
                    not getattr(row, "id", None) for row in rows
                ):
                    raise BridgeError(
                        "REMOTE_SCHEMA_CHANGED", "Unexpected notebook listing schema."
                    )
            verified_at = now()
            self._status = ConnectionStatus(
                state="connected", last_verified_at=verified_at
            )
            self._verified["list_notebooks"] = verified_at
        except Exception as exc:
            error = classify_error(exc)
            self._status = ConnectionStatus(
                state="needs_reauth" if error.code == "NEEDS_REAUTH" else "unavailable",
                reason=error.code,
            )
        return self._status

    async def capabilities(self) -> CapabilityMatrix:
        names = [
            "list_notebooks",
            "list_sources",
            "create_notebook",
            "upload_source",
            "fetch_source_text",
            "ask",
            "generate_audio",
            "list_artifacts",
            "download_artifact",
        ]
        ops = [
            Capability(
                name=name,
                support="available" if name in self._verified else "unverified",
                last_verified_at=self._verified.get(name),
            )
            for name in names
        ]
        for op in ops:
            # A successful historical call is evidence, not current admission.
            # Preserve its timestamp without advertising an unusable connection.
            if (
                self._status.state in {"needs_reauth", "unavailable"}
                or self._status.reason == "PROFILE_MISSING"
                or self._disabled
                or not self.storage_path.is_file()
            ):
                op.support = "temporarily_unavailable"
                op.reason = self._status.reason or "PROFILE_MISSING"
            if op.name == "ask":
                op.support = "unsupported"
                op.reason = "SCOPE_ISOLATION_UNAVAILABLE: SDK omission continues server history; non-destructive isolation has not been verified."
        return CapabilityMatrix(operations=ops)

    async def start_login(self) -> dict[str, Any]:
        self._disabled = False
        if self._login_flow and self._login_flow["expires_at"] > now():
            return self._login_flow
        self._login_flow = {
            "flow_id": f"flow_{uuid4()}",
            "state": "unavailable",
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(minutes=10)
            ).isoformat(),
            "reason": "This runtime has no approved visible persistent browser profile for Google login. An operator must provide the dedicated runtime browser; do not paste passwords, codes or cookies into this app.",
        }
        return self._login_flow

    async def disconnect(self) -> ConnectionStatus:
        # Block admissions immediately, drain/close any current context, then delete.
        self._disabled = True
        async with self._slot:
            if self.storage_path.is_symlink():
                raise BridgeError(
                    "UNSAFE_PROFILE_PATH", "Refusing to follow a profile symlink."
                )
            self.storage_path.unlink(missing_ok=True)
            self._status = ConnectionStatus(state="disconnected")
            self._verified.clear()
            self._login_flow = None
        return self._status

    def _record_failure(self, exc: Exception, *, mutation: bool = False) -> BridgeError:
        error = classify_error(exc, mutation=mutation)
        if error.code in {
            "NEEDS_REAUTH",
            "REMOTE_UNAVAILABLE",
            "REMOTE_SCHEMA_CHANGED",
            "SDK_VERSION_MISMATCH",
            "UNSAFE_PROFILE_PATH",
        }:
            self._status = ConnectionStatus(
                state="needs_reauth" if error.code == "NEEDS_REAUTH" else "unavailable",
                reason=error.code,
            )
        return error

    async def _call(self, operation, *, mutation=False):
        try:
            async with self._client() as client:
                result = await operation(client)
            return result
        except Exception as exc:
            raise self._record_failure(exc, mutation=mutation) from None

    async def list_notebooks(self, cursor: str | None = None) -> NotebookPage:
        rows = await self._call(lambda c: c.notebooks.list())
        if not isinstance(rows, list):
            raise self._record_failure(
                BridgeError(
                    "REMOTE_SCHEMA_CHANGED", "Unexpected notebook listing schema."
                )
            )
        try:
            items = [RemoteNotebook(id=r.id, title=r.title) for r in rows]
        except Exception as exc:
            raise self._record_failure(exc) from None
        selected, next_cursor = page(items, cursor)
        self._verified["list_notebooks"] = now()
        return NotebookPage(
            items=selected,
            next_cursor=next_cursor,
            listing_complete=False,
            completeness_note="The SDK lists recently viewed notebooks. Google does not guarantee this is every owned notebook.",
        )

    async def list_sources(
        self, remote_notebook_id: str, cursor: str | None = None
    ) -> RemoteSourcePage:
        rows = await self._call(
            lambda c: c.sources.list(remote_notebook_id, strict=True)
        )
        if not isinstance(rows, list):
            raise self._record_failure(
                BridgeError(
                    "REMOTE_SCHEMA_CHANGED", "Unexpected source listing schema."
                )
            )
        try:
            items = [
                RemoteSource(
                    id=r.id,
                    title=r.title or "Untitled source",
                    status="ready" if r.is_ready else "processing",
                    revision_id=getattr(r, "revision_id", None),
                )
                for r in rows
            ]
        except Exception as exc:
            raise self._record_failure(exc) from None
        selected, next_cursor = page(items, cursor)
        self._verified["list_sources"] = now()
        return RemoteSourcePage(
            items=selected,
            next_cursor=next_cursor,
            listing_complete=next_cursor is None,
        )

    async def create_notebook(self, request: CreateNotebookRequest) -> SubmissionResult:
        row = await self._call(
            lambda c: c.notebooks.create(request.title), mutation=True
        )
        return confirmed_result(row, "id", "ready")

    async def upload_source(self, request: UploadSourceRequest) -> SubmissionResult:
        row = await self._call(
            lambda c: c.sources.add_file(
                request.remote_notebook_id,
                request.file_path,
                mime_type=request.mime_type,
                title=request.title,
                wait=False,
            ),
            mutation=True,
        )
        return confirmed_result(row, "id", "ready" if row.is_ready else "processing")

    async def fetch_source_text(self, request: FetchTextRequest) -> RemoteTextResult:
        row = await self._call(
            lambda c: c.sources.get_fulltext(
                request.remote_notebook_id,
                request.remote_source_id,
                output_format="text",
            )
        )
        try:
            return RemoteTextResult(
                remote_source_id=row.source_id, title=row.title, content=row.content
            )
        except Exception as exc:
            raise self._record_failure(exc) from None

    async def ask(self, request: BridgeAskRequest) -> BridgeAnswer:
        # There is no safe environment-variable bypass. Real isolation validation
        # and an adapter revision are required before enabling this SDK path.
        raise BridgeError(
            "SCOPE_ISOLATION_UNAVAILABLE",
            "Strict source isolation is unavailable: this SDK continues server history when no conversation ID is supplied.",
        )

    async def generate_audio(self, request: AudioRequest) -> SubmissionResult:
        if not request.remote_source_ids:
            raise BridgeError("EMPTY_SCOPE", "Explicitly select at least one source.")
        row = await self._call(
            lambda c: c.artifacts.generate_audio(
                request.remote_notebook_id,
                source_ids=request.remote_source_ids,
                language=request.language,
            ),
            mutation=True,
        )
        return confirmed_result(row, "task_id", artifact_state(row.status))

    async def list_artifacts(self, remote_notebook_id: str) -> list[RemoteArtifact]:
        rows = await self._call(lambda c: c.artifacts.list(remote_notebook_id))
        if not isinstance(rows, list):
            raise self._record_failure(
                BridgeError(
                    "REMOTE_SCHEMA_CHANGED", "Unexpected artifact listing schema."
                )
            )
        try:
            return [
                RemoteArtifact(
                    id=r.id,
                    title=r.title,
                    kind=str(r.kind.value),
                    status=artifact_state(r.status_str),
                    remote_source_ids=list(r.source_ids),
                )
                for r in rows
            ]
        except Exception as exc:
            raise self._record_failure(exc) from None

    async def get_artifact(
        self, remote_notebook_id: str, remote_task_id: str
    ) -> RemoteArtifact:
        row = await self._call(
            lambda c: c.artifacts.poll_status(remote_notebook_id, remote_task_id)
        )
        return RemoteArtifact(id=remote_task_id, status=artifact_state(row.status))

    async def download_artifact(self, request):
        import httpx

        row = await self._call(
            lambda c: c.artifacts.get(
                request.remote_notebook_id, request.remote_artifact_id
            )
        )
        if (
            row.id != request.remote_artifact_id
            or str(row.kind.value) != "audio"
            or not row.is_completed
        ):
            raise BridgeError(
                "ARTIFACT_NOT_READY",
                "The verified artifact is not a completed audio overview.",
            )
        if not row.url:
            raise BridgeError(
                "ARTIFACT_DOWNLOAD_UNAVAILABLE",
                "The SDK supplied no downloadable asset URL.",
            )
        async with httpx.AsyncClient(
            timeout=30, follow_redirects=False, trust_env=False
        ) as client:
            async with asyncio.timeout(300):
                return await download_signed_asset(
                    row.url, Path(request.output_path), request.max_bytes, client
                )


def page(items, cursor):
    try:
        offset = 0 if cursor is None else int(cursor)
        if offset < 0 or str(offset) != (cursor or "0"):
            raise ValueError()
    except ValueError:
        raise BridgeError("INVALID_CURSOR", "Invalid listing cursor.") from None
    return items[offset : offset + 50], str(offset + 50) if offset + 50 < len(
        items
    ) else None


def confirmed_result(row, field, status):
    remote_id = getattr(row, field, None)
    if not isinstance(remote_id, str) or not remote_id:
        raise BridgeError(
            "REMOTE_SCHEMA_CHANGED",
            "Submission returned no usable remote identity.",
            submission_state="unknown",
        )
    return SubmissionResult(remote_id=remote_id, status=status)


def artifact_state(value):
    state = str(getattr(value, "value", value))
    if state in {"completed", "ready", "succeeded"}:
        return "ready"
    if state in {"pending", "in_progress", "processing", "queued"}:
        return "processing"
    if state in {"failed", "error"}:
        return "failed"
    # Missing/unknown must not masquerade as completed or definitively failed.
    return "unknown"


def classify_error(exc: Exception, *, mutation: bool = False) -> BridgeError:
    if isinstance(exc, BridgeError):
        return exc
    # Class names avoid coupling to private SDK exception classes. Raw exception
    # messages can contain URLs or credentials, so never persist them.
    name = type(exc).__name__
    if name in {"AuthError", "AuthExtractionError", "CookieError"}:
        code, message = (
            "NEEDS_REAUTH",
            "Google session expired; reconnect to resume reading the original task.",
        )
    elif name == "RateLimitError":
        code, message = (
            "QUOTA_LIMIT",
            "Google rejected this call for a quota or rate limit.",
        )
    elif (
        "Parse" in name
        or "Decod" in name
        or isinstance(exc, (AttributeError, TypeError, KeyError))
    ):
        code, message = (
            "REMOTE_SCHEMA_CHANGED",
            "Google returned an unsupported response format.",
        )
    elif (
        isinstance(exc, (TimeoutError, OSError))
        or "Timeout" in name
        or name == "NetworkError"
    ):
        code, message = (
            "REMOTE_UNAVAILABLE",
            "The remote request did not return a reliable result.",
        )
    else:
        code, message = (
            "REMOTE_UNAVAILABLE",
            "NotebookLM is unavailable; no automatic write retry was made.",
        )
    remote_id = getattr(exc, "source_id", None)
    state = "confirmed" if remote_id else ("unknown" if mutation else "not_submitted")
    return BridgeError(code, message, submission_state=state, remote_id=remote_id)


def _audio_type(header: bytes):
    if header.startswith(b"ID3") or (
        len(header) >= 2 and header[0] == 255 and header[1] & 224 == 224
    ):
        return "audio/mpeg", ".mp3"
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "audio/wav", ".wav"
    if header.startswith(b"OggS"):
        return "audio/ogg", ".ogg"
    if header[4:8] == b"ftyp":
        return "audio/mp4", ".m4a"
    raise BridgeError(
        "UNSUPPORTED_AUDIO", "Downloaded content is not a recognized audio container."
    )


def _validate_asset_url(url):
    from urllib.parse import urlsplit

    value = urlsplit(url)
    host = (value.hostname or "").lower()
    if (
        value.scheme != "https"
        or value.port not in (None, 443)
        or value.username
        or value.password
    ):
        raise BridgeError(
            "UNSAFE_DOWNLOAD", "Artifact download requires a trusted HTTPS origin."
        )
    if not any(
        host == domain or host.endswith("." + domain)
        for domain in ("googleusercontent.com", "googlevideo.com")
    ):
        raise BridgeError("UNSAFE_DOWNLOAD", "Artifact download origin is not allowed.")


async def download_signed_asset(url, output_path: Path, max_bytes: int, client):
    """Bounded, unauthenticated signed-asset download. Never accepts a UI URL.

    Only called after SDK artifact identity/type/status validation. Every redirect
    is checked, bytes are bounded while streaming, and incomplete files are removed.
    """
    import hashlib
    from urllib.parse import urljoin

    output_path = Path(output_path)
    temp = output_path.with_name(output_path.name + ".partial-" + uuid4().hex)
    total, sha, header = 0, hashlib.sha256(), b""
    try:
        for _ in range(6):
            _validate_asset_url(url)
            async with client.stream("GET", url, follow_redirects=False) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    url = urljoin(url, response.headers.get("location", ""))
                    continue
                if response.status_code in {401, 403}:
                    raise BridgeError(
                        "ARTIFACT_DOWNLOAD_UNAVAILABLE",
                        "This asset requires an authenticated download unsupported by the bounded runtime downloader.",
                    )
                if response.status_code != 200:
                    raise BridgeError(
                        "ARTIFACT_DOWNLOAD_UNAVAILABLE",
                        "The audio download is unavailable.",
                    )
                try:
                    content_length = int(response.headers.get("content-length", "0"))
                except ValueError:
                    raise BridgeError(
                        "REMOTE_SCHEMA_CHANGED", "Invalid download size header."
                    ) from None
                if content_length > max_bytes:
                    raise BridgeError(
                        "ARTIFACT_TOO_LARGE",
                        "Audio exceeds the configured download limit.",
                    )
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with temp.open("xb") as out:
                    async for chunk in response.aiter_bytes(65536):
                        total += len(chunk)
                        if total > max_bytes:
                            raise BridgeError(
                                "ARTIFACT_TOO_LARGE",
                                "Audio exceeds the configured download limit.",
                            )
                        header = (header + chunk)[:32]
                        sha.update(chunk)
                        out.write(chunk)
                    out.flush()
                    await asyncio.to_thread(os.fsync, out.fileno())
                mime, extension = _audio_type(header)
                declared = response.headers.get("content-type", "").split(";")[0]
                if declared and not (
                    declared.startswith("audio/")
                    or declared in {"application/octet-stream", "video/mp4"}
                ):
                    raise BridgeError(
                        "UNSUPPORTED_AUDIO",
                        "The server did not return an audio content type.",
                    )
                target = output_path.with_suffix(extension)
                # Fresh app-generated identities mean no user file is overwritten.
                if target.exists():
                    if (
                        hashlib.sha256(target.read_bytes()).hexdigest()
                        != sha.hexdigest()
                    ):
                        raise BridgeError(
                            "ARTIFACT_CONFLICT",
                            "An asset with this identity already has different bytes.",
                        )
                    temp.unlink()
                else:
                    temp.rename(target)
                from .contracts import DownloadedAsset

                return DownloadedAsset(
                    path=str(target),
                    mime_type=mime,
                    byte_size=total,
                    sha256=sha.hexdigest(),
                )
        raise BridgeError("UNSAFE_DOWNLOAD", "Too many artifact redirects.")
    finally:
        temp.unlink(missing_ok=True)
