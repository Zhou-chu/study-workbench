"""Explicitly injected offline fixtures, never imported by production code."""

import asyncio
import copy
from contextlib import asynccontextmanager

from open_notebook.integrations.notebooklm.contracts import (
    BridgeAnswer,
    Capability,
    CapabilityMatrix,
    ConnectionStatus,
    NotebookPage,
    RemoteArtifact,
    RemoteSource,
    RemoteSourcePage,
    SubmissionResult,
)


class MemoryStore:
    def __init__(self):
        self.rows = {}
        self.locks = {}

    async def get(self, kind, identity):
        return copy.deepcopy(self.rows.get((kind, identity)))

    async def put(self, kind, identity, value, create_only=False):
        if create_only and (kind, identity) in self.rows:
            raise ValueError("duplicate")
        self.rows[kind, identity] = copy.deepcopy(value)
        return value

    async def list(self, kind, notebook_id=None, **filters):
        if notebook_id is not None:
            filters["notebook_id"] = notebook_id
        return [
            copy.deepcopy(v)
            for (k, _), v in self.rows.items()
            if k == kind and all(v.get(f) == x for f, x in filters.items())
        ]

    async def delete(self, kind, identity):
        self.rows.pop((kind, identity), None)

    @asynccontextmanager
    async def project_lock(self, key):
        async with self.locks.setdefault(key, asyncio.Lock()):
            yield


class FakeBridge:
    """Small transport double; application state machines remain real."""

    def __init__(self):
        self.audio_calls = 0
        self.create_calls = 0
        self.upload_calls = 0
        self.ask_calls = 0
        self.polls = 0
        self.error = None
        self.artifact_status = "processing"
        self.sources = [
            RemoteSource(id="a", title="A", status="ready"),
            RemoteSource(id="b", title="B", status="ready"),
        ]
        self.answer = BridgeAnswer(answer="Answer", conversation_id="conversation")

    async def verify_connection(self):
        return ConnectionStatus(
            state="connected", last_verified_at="2026-01-01T00:00:00+00:00"
        )

    async def capabilities(self):
        return CapabilityMatrix(
            operations=[
                Capability(name=x, support="available")
                for x in ["ask", "generate_audio", "create_notebook", "upload_source"]
            ]
        )

    async def list_notebooks(self, cursor=None):
        return NotebookPage(items=[])

    async def list_sources(self, remote_notebook_id, cursor=None):
        return RemoteSourcePage(items=self.sources)

    async def create_notebook(self, request):
        self.create_calls += 1
        if self.error:
            raise self.error
        return SubmissionResult(remote_id="new-nb", status="ready")

    async def upload_source(self, request):
        self.upload_calls += 1
        if self.error:
            raise self.error
        return SubmissionResult(
            remote_id="uploaded-" + request.source_version_id, status="ready"
        )

    async def generate_audio(self, request):
        self.audio_calls += 1
        if self.error:
            raise self.error
        return SubmissionResult(remote_id="audio-1")

    async def get_artifact(self, remote_notebook_id, remote_task_id):
        self.polls += 1
        return RemoteArtifact(id=remote_task_id, status=self.artifact_status)

    async def ask(self, request):
        self.ask_calls += 1
        if self.error:
            raise self.error
        return self.answer
