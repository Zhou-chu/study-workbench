"""Explicit test-injection adapter, never selected by runtime configuration.

Every response must be supplied by a test. Missing methods fail closed; there is
no built-in connected status, successful answer or production fallback.
"""

import copy
import inspect
from collections.abc import Mapping

from .contracts import BridgeError


class FakeNotebookLMBridge:
    def __init__(self, responses: Mapping):
        self.responses = dict(responses)
        self.calls: list[tuple[str, tuple]] = []

    async def _invoke(self, name, *args):
        self.calls.append((name, copy.deepcopy(args)))
        if name not in self.responses:
            raise BridgeError(
                "TEST_RESPONSE_MISSING", f"No explicit test response for {name}."
            )
        value = self.responses[name]
        if isinstance(value, Exception):
            raise value
        if callable(value):
            value = value(*args)
        if inspect.isawaitable(value):
            value = await value
        return copy.deepcopy(value)

    async def verify_connection(self):
        return await self._invoke("verify_connection")

    async def capabilities(self):
        return await self._invoke("capabilities")

    async def list_notebooks(self, cursor=None):
        return await self._invoke("list_notebooks", cursor)

    async def list_sources(self, remote_notebook_id, cursor=None):
        return await self._invoke("list_sources", remote_notebook_id, cursor)

    async def create_notebook(self, request):
        return await self._invoke("create_notebook", request)

    async def upload_source(self, request):
        return await self._invoke("upload_source", request)

    async def fetch_source_text(self, request):
        return await self._invoke("fetch_source_text", request)

    async def ask(self, request):
        return await self._invoke("ask", request)

    async def list_artifacts(self, remote_notebook_id):
        return await self._invoke("list_artifacts", remote_notebook_id)

    async def generate_audio(self, request):
        return await self._invoke("generate_audio", request)

    async def get_artifact(self, remote_notebook_id, remote_task_id):
        return await self._invoke("get_artifact", remote_notebook_id, remote_task_id)

    async def download_artifact(self, request):
        return await self._invoke("download_artifact", request)
