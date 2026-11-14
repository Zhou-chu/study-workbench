"""Explicit pinned evidence embedding boundary, independent of classic defaults.

No profile read constructs a model. Every batch is prevalidated, frozen before
provisioning and sent at most once. Document indexing consent/scope authorization
belongs to the preview/job orchestrator; query disclosure is required here too.
"""

import asyncio
import json
import logging
import math
import os
import weakref
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx

from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    QueryEmbeddingDisclosure,
    sanitized_endpoint,
)
from open_notebook.exceptions import (
    ConfigurationError,
    DatabaseOperationError,
    ExternalServiceError,
    InvalidInputError,
)

BATCH_SIZE = 16
TIMEOUT_SECONDS = 30
_HTTP_STACK_VERSIONS = {"esperanto": "2.28.0", "httpx": "0.28.1", "httpcore": "1.0.9"}
_TRANSPORT_LOGGERS = (
    "httpcore",
    "httpcore.connection",
    "httpcore.http11",
    "httpcore.http2",
    "httpcore.proxy",
    "httpcore.socks",
)
_CALL_SLOTS: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = (
    weakref.WeakKeyDictionary()
)
DispatchAdmission = Callable[[], Awaitable[None]]
_QUERY_ADMISSION: ContextVar[DispatchAdmission | None] = ContextVar(
    "evidence_query_dispatch_admission", default=None
)


_DOCUMENT_ADMISSION: ContextVar[DispatchAdmission | None] = ContextVar(
    "evidence_document_dispatch_admission", default=None
)


class _AdmissionRejected(Exception):
    """Internal bypass: scope errors are not provider failures or fallback."""

    def __init__(self, error: Exception) -> None:
        super().__init__("QUERY_DISPATCH_ADMISSION_REJECTED")
        self.error = error


async def _admit_query(
    admission: DispatchAdmission | None, deadline: asyncio.Timeout | None = None
) -> None:
    if admission is None:
        return
    rejected: Exception | None = None
    try:
        await admission()
    except asyncio.CancelledError:
        if deadline is None or not deadline.expired():
            raise
        # A deadline during scope admission does not imply provider dispatch.
        rejected = DatabaseOperationError("INDEX_READ_UNAVAILABLE")
    except Exception as error:
        rejected = error
    if rejected is not None:
        raise _AdmissionRejected(rejected) from None


class EmbeddingUnavailable(ConfigurationError):
    """Configuration/provider unavailable; no application replay is authorized."""


class EmbeddingResponseInvalid(ExternalServiceError):
    """Returned vectors are unusable, never partially accepted."""


class EmbeddingOutcomeUnknown(ExternalServiceError):
    """Dispatch timed out; remote processing/cost may already have occurred."""


class EmbeddingInputInvalid(InvalidInputError):
    """Reject input before any model construction or dispatch."""


class EmbeddingDisclosureStale(InvalidInputError):
    """The disclosed identity no longer matches; require fresh disclosure."""


def _finite_number(value: Any) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def hybrid_enabled() -> bool:
    return os.getenv("STUDY_WORKBENCH_HYBRID_ENABLED", "false").lower() == "true"


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate configuration key")
        result[key] = value
    return result


def load_profiles() -> dict[str, EmbeddingProfile]:
    """Strict local JSON array; no installed profile/model/destination defaults."""
    path = os.getenv("STUDY_WORKBENCH_EMBEDDING_PROFILES")
    if not path:
        return {}
    try:
        raw = json.loads(
            Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique_object
        )
        if not isinstance(raw, list):
            raise ValueError("Profiles must be an array")
        profiles: dict[str, EmbeddingProfile] = {}
        for item in raw:
            profile = EmbeddingProfile.model_validate(item)
            if profile.profile_id in profiles:
                raise ValueError("Duplicate profile ID")
            profiles[profile.profile_id] = profile
        return profiles
    except Exception:
        # Pydantic validation bodies and filesystem errors can contain secrets.
        raise EmbeddingUnavailable("PROFILE_UNAVAILABLE") from None


@dataclass(frozen=True)
class FrozenEmbeddingConfiguration:
    """One checked model/credential snapshot, never a recipe to reread defaults."""

    model_id: str
    model_type: str
    provider: str
    model_name: str
    credential_binding_id: str
    endpoint: str = field(repr=False)
    api_key: str | None = field(default=None, repr=False)
    no_retry: bool = False


class EmbeddingBackend(Protocol):
    async def aembed(self, texts: list[str]) -> list[list[float]]: ...
    async def aclose(self) -> None: ...


class EmbeddingResolver(Protocol):
    async def resolve(
        self, profile: EmbeddingProfile
    ) -> FrozenEmbeddingConfiguration: ...
    async def provision(
        self, config: FrozenEmbeddingConfiguration
    ) -> EmbeddingBackend: ...


def _ensure_safe_transport_logging() -> None:
    # httpcore Trace DEBUG includes untrusted headers, reason phrases and
    # exception repr *inside* the transport. Never modify shared logger policy;
    # refuse this path before model/URL work and recheck before dispatch.
    if any(
        logging.getLogger(name).isEnabledFor(logging.DEBUG)
        for name in _TRANSPORT_LOGGERS
    ):
        raise EmbeddingUnavailable("EMBEDDING_DIAGNOSTICS_UNSAFE")


def _sanitize_http_metadata(response: httpx.Response) -> httpx.Response:
    # HTTPX logs these fields immediately after the transport returns, before
    # response hooks or the SDK's handler. Use standard local status metadata.
    if type(response.status_code) is not int or not 100 <= response.status_code <= 599:
        raise EmbeddingResponseInvalid("EMBEDDING_INVALID_RESPONSE")
    response.extensions.pop("reason_phrase", None)
    if response.extensions.get("http_version") not in (
        b"HTTP/1.0",
        b"HTTP/1.1",
        b"HTTP/2",
    ):
        response.extensions.pop("http_version", None)
    return response


class _SanitizingTransport(httpx.BaseTransport):
    def __init__(self, inner: httpx.BaseTransport) -> None:
        self._inner = inner

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        _ensure_safe_transport_logging()
        return _sanitize_http_metadata(self._inner.handle_request(request))

    def close(self) -> None:
        self._inner.close()


class _SanitizingAsyncTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        _ensure_safe_transport_logging()
        return _sanitize_http_metadata(await self._inner.handle_async_request(request))

    async def aclose(self) -> None:
        await self._inner.aclose()


class _IdentityHttpMixin:
    """Narrow Esperanto 2.28.0 adapter: identity text and explicit retry policy."""

    provider: str

    def _clean_text(self, text: str) -> str:
        return text

    def _handle_error(self, response: httpx.Response) -> None:
        # Never delegate HTTP errors to SDK handlers that retain raw bodies.
        # Redirects are not followed or accepted as an embedding response.
        if response.status_code >= 300:
            raise RuntimeError("EMBEDDING_PROVIDER_ERROR")
        try:
            payload = response.json()
            if self.provider == "openai":
                rows = payload["data"]
                if not isinstance(rows, list) or any(
                    not isinstance(row, dict)
                    or type(row.get("index")) is not int
                    or row["index"] != index
                    for index, row in enumerate(rows)
                ):
                    raise ValueError
                vectors = [row["embedding"] for row in rows]
            else:
                vectors = payload["embeddings"]
            # Esperanto coerces strings/bools to floats; reject before that
            # conversion can erase evidence of an invalid raw response.
            if not isinstance(vectors, list) or any(
                not isinstance(vector, list)
                or not vector
                or any(not _finite_number(value) for value in vector)
                for vector in vectors
            ):
                raise ValueError
        except Exception:
            raise EmbeddingResponseInvalid("EMBEDDING_INVALID_RESPONSE") from None

    def _create_http_clients(self) -> None:
        # No proxy/environment destination substitution, redirects or retries.
        self.client = httpx.Client(
            timeout=TIMEOUT_SECONDS,
            trust_env=False,
            follow_redirects=False,
            transport=_SanitizingTransport(httpx.HTTPTransport(retries=0)),
        )
        self.async_client = httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            trust_env=False,
            follow_redirects=False,
            transport=_SanitizingAsyncTransport(httpx.AsyncHTTPTransport(retries=0)),
        )

    def _get_api_kwargs(self) -> dict[str, Any]:
        # Only the Ollama adapter uses this; never forward client policy to API.
        return {"truncate": False}

    async def aclose(self) -> None:
        await self.async_client.aclose()
        self.client.close()


class DeploymentModelResolver:
    """Additive explicit-model seam; ModelManager's mutable path is untouched.

    Only inspected Esperanto OpenAI/Ollama and HTTP stack versions are enabled.
    Other versions/providers fail closed pending adapter/logging inspection.
    No environment credential provisioning or implicit default endpoint is used.
    """

    async def resolve(self, profile: EmbeddingProfile) -> FrozenEmbeddingConfiguration:
        from open_notebook.ai.models import Model

        model = await Model.get(profile.model_id)
        if not model.credential:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        credential = await model.get_credential_obj()
        config = credential.to_esperanto_config()
        provider = model.provider.replace("_", "-")
        if credential.provider.replace("_", "-") != provider:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        if set(config) - {"base_url", "api_key"}:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        return FrozenEmbeddingConfiguration(
            model_id=str(model.id),
            model_type=model.type,
            provider=provider,
            model_name=model.name,
            credential_binding_id=str(model.credential),
            endpoint=config.get("base_url", ""),
            api_key=config.get("api_key"),
            no_retry=provider in {"openai", "ollama"}
            and all(
                version(package) == expected
                for package, expected in _HTTP_STACK_VERSIONS.items()
            ),
        )

    async def provision(self, config: FrozenEmbeddingConfiguration) -> EmbeddingBackend:
        from esperanto.providers.embedding.ollama import OllamaEmbeddingModel
        from esperanto.providers.embedding.openai import OpenAIEmbeddingModel

        from open_notebook.ai.models import _revalidate_config_urls

        if not config.no_retry:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        parsed = urlsplit(config.endpoint)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        if config.provider == "openai" and not config.api_key:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        # Validation is deliberately after current profile/disclosure checks.
        await _revalidate_config_urls({"base_url": config.endpoint}, config.provider)

        class PinnedOpenAI(_IdentityHttpMixin, OpenAIEmbeddingModel):
            def _get_api_kwargs(self) -> dict[str, Any]:
                return {}

        class PinnedOllama(_IdentityHttpMixin, OllamaEmbeddingModel):
            pass

        backend = {"openai": PinnedOpenAI, "ollama": PinnedOllama}.get(config.provider)
        if backend is None:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        return backend(
            model_name=config.model_name,
            config={
                "base_url": config.endpoint,
                "api_key": config.api_key,
                "timeout": TIMEOUT_SECONDS,
                "embed_batch_size": BATCH_SIZE,
            },
        )


def _slot() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    if loop not in _CALL_SLOTS:
        _CALL_SLOTS[loop] = asyncio.Lock()
    return _CALL_SLOTS[loop]


def _caused_by(error: BaseException, kinds: tuple[type[BaseException], ...]) -> bool:
    # Esperanto may wrap httpx.TimeoutException in RuntimeError; inspect types,
    # never serialize exception messages, request content or response bodies.
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, kinds):
            return True
        current = current.__cause__ or current.__context__
    return False


class EvidenceEmbeddingClient:
    def __init__(
        self,
        *,
        profile_loader: Callable[[], dict[str, EmbeddingProfile]] = load_profiles,
        resolver: EmbeddingResolver | None = None,
        enabled: Callable[[], bool] = hybrid_enabled,
    ) -> None:
        self._profiles = profile_loader
        self._resolver = resolver or DeploymentModelResolver()
        self._enabled = enabled

    def resolve_profile(self, profile_id: str) -> EmbeddingProfile:
        try:
            profile = self._profiles()[profile_id]
            # Revalidate even injected input; model_copy()/construct() bypass validation.
            return EmbeddingProfile.model_validate(
                {name: getattr(profile, name) for name in EmbeddingProfile.model_fields}
            )
        except Exception:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE") from None

    def _check_current(
        self, profile: EmbeddingProfile, disclosure: QueryEmbeddingDisclosure | None
    ) -> None:
        removed = False
        try:
            current = self.resolve_profile(profile.profile_id)
        except EmbeddingUnavailable:
            if disclosure is None:
                raise  # Preserve document/indexing callers' existing behavior.
            removed = True
        if removed:
            raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE") from None
        if current.fingerprint != profile.fingerprint:
            raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE")
        if disclosure is not None:
            if (
                disclosure.disclosed_profile_fingerprint != current.fingerprint
                or disclosure.destination_descriptor_version
                != current.destination_descriptor_version
            ):
                raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE")
            if (
                current.destination_kind != "on_device"
                and not disclosure.acknowledge_query_processing
            ):
                raise EmbeddingInputInvalid("EMBEDDING_ACKNOWLEDGMENT_REQUIRED")

    def _prepare(
        self, profile: EmbeddingProfile, texts: list[str], prefix: str
    ) -> list[str]:
        prepared: list[str] = []
        for text in texts:
            if not isinstance(text, str) or not text.strip():
                raise EmbeddingInputInvalid("EMBEDDING_INPUT_INVALID")
            value = prefix + text
            try:
                size = len(value.encode("utf-8"))
            except UnicodeError:
                raise EmbeddingInputInvalid("EMBEDDING_INPUT_INVALID") from None
            if size > profile.max_input_bytes:
                raise EmbeddingInputInvalid("EMBEDDING_INPUT_TOO_LARGE")
            prepared.append(value)
        return prepared

    async def embed_documents(
        self,
        profile: EmbeddingProfile,
        texts: list[str],
        *,
        dispatch_admission: DispatchAdmission | None = None,
    ) -> list[list[float]]:
        """Per-call index admission, isolated from queries and classic callers.

        Admission runs after the slot and resolver/provisioning awaits for every
        batch. Its owner releases the project barrier before provider I/O.
        """
        prepared = self._prepare(profile, texts, profile.document_prefix)
        token = _DOCUMENT_ADMISSION.set(dispatch_admission)
        rejected: Exception | None = None
        try:
            try:
                results: list[list[float]] = []
                for start in range(0, len(prepared), BATCH_SIZE):
                    results.extend(
                        await self._batch(
                            profile, prepared[start : start + BATCH_SIZE], None
                        )
                    )
                return results
            except _AdmissionRejected as error:
                rejected = error.error
        finally:
            _DOCUMENT_ADMISSION.reset(token)
        assert rejected is not None
        raise rejected from None

    async def embed_query(
        self,
        profile: EmbeddingProfile,
        query: str,
        *,
        disclosure: QueryEmbeddingDisclosure,
        dispatch_admission: DispatchAdmission | None = None,
    ) -> list[float]:
        """Optional per-query scope admission runs inside the actual worker slot.

        The trusted caller admits under its existing barrier, releasing it before
        returning. Never retain this callback on the client or reuse it for
        documents. Task-level retrieval is the production owner of this seam.
        """
        if not isinstance(disclosure, QueryEmbeddingDisclosure):
            raise EmbeddingInputInvalid("EMBEDDING_ACKNOWLEDGMENT_REQUIRED")
        try:
            disclosure = QueryEmbeddingDisclosure.model_validate(
                {
                    name: getattr(disclosure, name)
                    for name in QueryEmbeddingDisclosure.model_fields
                }
            )
        except Exception:
            raise EmbeddingInputInvalid("EMBEDDING_ACKNOWLEDGMENT_REQUIRED") from None
        prepared = self._prepare(profile, [query], profile.query_prefix)
        token = _QUERY_ADMISSION.set(dispatch_admission)
        rejected: Exception | None = None
        try:
            try:
                return (await self._batch(profile, prepared, disclosure))[0]
            except _AdmissionRejected as error:
                rejected = error.error
        finally:
            _QUERY_ADMISSION.reset(token)
        # Outside every handler: do not attach the internal bypass as context.
        assert rejected is not None
        raise rejected from None

    async def _batch(
        self,
        profile: EmbeddingProfile,
        texts: list[str],
        disclosure: QueryEmbeddingDisclosure | None,
    ) -> list[list[float]]:
        async with _slot():
            admission = (
                _QUERY_ADMISSION.get()
                if disclosure is not None
                else _DOCUMENT_ADMISSION.get()
            )
            await _admit_query(admission)
            self._check_current(profile, disclosure)
            if not self._enabled():
                raise EmbeddingUnavailable("FEATURE_DISABLED")
            _ensure_safe_transport_logging()
            backend: EmbeddingBackend | None = None
            try:
                async with asyncio.timeout(TIMEOUT_SECONDS) as deadline:
                    config = await self._resolver.resolve(profile)
                    self._check_current(profile, disclosure)
                    try:
                        endpoint_matches = (
                            sanitized_endpoint(config.endpoint)
                            == config.endpoint
                            == profile.endpoint
                        )
                    except ValueError:
                        endpoint_matches = False
                    if (
                        config.model_id != profile.model_id
                        or config.model_type != "embedding"
                        or config.provider != profile.provider
                        or config.model_name != profile.model_name
                        or config.credential_binding_id != profile.credential_binding_id
                        or not endpoint_matches
                    ):
                        raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE")
                    if not config.no_retry:
                        raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
                    if admission is not None:
                        await _admit_query(admission, deadline)
                        self._check_current(profile, disclosure)
                    backend = await self._resolver.provision(config)
                    self._check_current(profile, disclosure)
                    _ensure_safe_transport_logging()
                    if admission is not None:
                        await _admit_query(admission, deadline)
                        self._check_current(profile, disclosure)
                    raw = await backend.aembed(texts)
                    return self._validate_vectors(raw, len(texts), profile.dimension)
            except (
                _AdmissionRejected,
                EmbeddingDisclosureStale,
                EmbeddingInputInvalid,
                EmbeddingResponseInvalid,
                EmbeddingUnavailable,
            ):
                raise
            except Exception as error:
                if _caused_by(error, (TimeoutError, httpx.TimeoutException)):
                    raise EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN") from None
                if _caused_by(error, (EmbeddingResponseInvalid,)):
                    raise EmbeddingResponseInvalid(
                        "EMBEDDING_INVALID_RESPONSE"
                    ) from None
                raise EmbeddingUnavailable("EMBEDDING_UNAVAILABLE") from None
            finally:
                if backend is not None:
                    try:
                        await backend.aclose()
                    except Exception:
                        pass  # Cleanup cannot relabel the known send outcome or expose errors.

    @staticmethod
    def _validate_vectors(raw: Any, count: int, dimension: int) -> list[list[float]]:
        if not isinstance(raw, list) or len(raw) != count:
            raise EmbeddingResponseInvalid("EMBEDDING_INVALID_RESPONSE")
        normalized: list[list[float]] = []
        for vector in raw:
            if not isinstance(vector, list) or len(vector) != dimension:
                raise EmbeddingResponseInvalid("EMBEDDING_INVALID_RESPONSE")
            if any(not _finite_number(value) for value in vector):
                raise EmbeddingResponseInvalid("EMBEDDING_INVALID_RESPONSE")
            # Scaled hypot avoids overflow/underflow for otherwise valid vectors.
            scale = max(abs(value) for value in vector)
            if scale == 0:
                raise EmbeddingResponseInvalid("EMBEDDING_INVALID_RESPONSE")
            scaled = [value / scale for value in vector]
            norm = math.hypot(*scaled)
            normalized.append([value / norm for value in scaled])
        return normalized
