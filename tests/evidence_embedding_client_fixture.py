"""Synthetic resolver boundary shared without importing collected tests."""

import asyncio

from open_notebook.ai.evidence_embeddings import FrozenEmbeddingConfiguration


class FakeResolver:
    def __init__(self, profile):
        self.profile = profile
        self.default_model_id = "model:unrelated-default"
        self.endpoint = profile.endpoint
        self.model_name = profile.model_name
        self.model_type = "embedding"
        self.calls = []
        self.provisions = []
        self.resolutions = []
        self.result = None
        self.failure = None
        self.on_provision = None
        self.active = 0
        self.max_active = 0

    async def resolve(self, profile):
        self.resolutions.append(profile.model_id)
        return FrozenEmbeddingConfiguration(
            model_id=profile.model_id,
            model_type=self.model_type,
            provider=profile.provider,
            model_name=self.model_name,
            credential_binding_id=profile.credential_binding_id,
            endpoint=self.endpoint,
            api_key="fake-test-secret",
            no_retry=True,
        )

    async def provision(self, config):
        self.provisions.append(config)
        if self.on_provision:
            self.on_provision()
        return self

    async def aembed(self, texts):
        self.calls.append(list(texts))
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await asyncio.sleep(0)
            if self.failure:
                raise self.failure
            return (
                self.result if self.result is not None else [[3.0, 4.0] for _ in texts]
            )
        finally:
            self.active -= 1

    async def aclose(self):
        pass
