"""Durable local export command; imports are validated before any database write."""

from surreal_commands import CommandInput, CommandOutput, command

from api.portable_service import get_portable_service
from open_notebook.exceptions import InvalidInputError, NotFoundError


class PortableExportInput(CommandInput):
    job_id: str


class PortableExportOutput(CommandOutput):
    job_id: str
    export_id: str | None = None
    state: str


@command(
    "export_portable",
    app="open_notebook",
    retry={
        "max_attempts": 2,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 5,
        "stop_on": [InvalidInputError, NotFoundError, ValueError],
    },
)
async def export_portable(input_data: PortableExportInput) -> PortableExportOutput:
    result = await get_portable_service().run_export(input_data.job_id)
    return PortableExportOutput(
        job_id=result["job_id"],
        state=result["state"],
        export_id=(result.get("result") or {}).get("export_id"),
    )
