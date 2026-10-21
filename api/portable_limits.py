"""Shared, restart-configured portable archive and HTTP size contract."""

import os
from dataclasses import asdict, dataclass


def _positive(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0 or value > 2**53 - 1 - 1024 * 1024:
        raise ValueError(f"{name} must be a positive, JSON-safe integer")
    return value


@dataclass(frozen=True)
class PortableLimits:
    max_archive_bytes: int
    max_expanded_bytes: int
    max_entity_bytes: int = 32 * 1024 * 1024
    max_manifest_bytes: int = 8 * 1024 * 1024
    multipart_overhead_bytes: int = 1024 * 1024
    max_entries: int = 10000
    max_compression_ratio: int = 200

    @property
    def max_request_bytes(self) -> int:
        return self.max_archive_bytes + self.multipart_overhead_bytes

    def public(self) -> dict[str, int]:
        return {**asdict(self), "max_request_bytes": self.max_request_bytes}


def get_portable_limits() -> PortableLimits:
    budget = _positive("STUDY_WORKBENCH_PORTABLE_MAX_BYTES", 1024 * 1024 * 1024)
    return PortableLimits(
        max_archive_bytes=budget,
        max_expanded_bytes=budget,
        max_entries=_positive("STUDY_WORKBENCH_PORTABLE_MAX_ENTRIES", 10000),
        max_compression_ratio=_positive("STUDY_WORKBENCH_PORTABLE_MAX_RATIO", 200),
    )
