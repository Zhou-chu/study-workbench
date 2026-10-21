"""Idempotent CPU extraction jobs on the existing surreal-commands worker."""

from datetime import datetime, timezone

from surreal_commands import CommandInput, CommandOutput, command

from api.evidence_maintenance import EvidenceMaintenanceService
from api.evidence_service import EvidenceService
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import InvalidInputError, NotFoundError


class EvidenceExtractionInput(CommandInput):
    source_version_id: str
    extraction_id: str | None = None
    job_id: str | None = None


class EvidenceExtractionOutput(CommandOutput):
    success: bool
    source_version_id: str
    extraction_id: str
    status: str
    evidence_count: int
    warnings: list[str]


@command(
    "extract_evidence",
    app="open_notebook",
    retry={
        "max_attempts": 3,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 10,
        "stop_on": [InvalidInputError, NotFoundError, ValueError],
    },
)
async def extract_evidence_command(
    input_data: EvidenceExtractionInput,
) -> EvidenceExtractionOutput:
    service = EvidenceService()
    version = await service.version(input_data.source_version_id)
    job = (
        await service.store.get("job", input_data.job_id) if input_data.job_id else None
    )
    if input_data.job_id and job is None:
        raise NotFoundError("Extraction job not found")
    if job and job.get("notebook_id") != version["notebook_id"]:
        raise InvalidInputError("Extraction job belongs to another notebook")
    if job:
        async with service.store.project_lock(version["notebook_id"]):
            job = await service.store.get("job", input_data.job_id)
            if job.get("cancel_requested") or job["state"] == "cancelled_local":
                return EvidenceExtractionOutput(
                    success=False,
                    source_version_id=input_data.source_version_id,
                    extraction_id="",
                    status="cancelled_local",
                    evidence_count=0,
                    warnings=["Cancelled before extraction started"],
                )
            if job["state"] == "succeeded" and job.get("result"):
                return EvidenceExtractionOutput(**job["result"])
            job.update(
                state="running", started_at=datetime.now(timezone.utc).isoformat()
            )
            await service.store.put("job", input_data.job_id, job)
    try:
        extraction = await service.extract(
            input_data.source_version_id, extraction_id=input_data.extraction_id
        )
        result = EvidenceExtractionOutput(
            success=extraction["status"] != "failed",
            source_version_id=input_data.source_version_id,
            extraction_id=extraction["extraction_id"],
            status=extraction["status"],
            evidence_count=len(extraction["evidence_ids"]),
            warnings=extraction["warnings"],
        )
        async with service.store.project_lock(version["notebook_id"]):
            versions = await service.versions(version["source_id"])
            if versions[-1]["source_version_id"] == input_data.source_version_id:
                source = await Source.get(version["source_id"])
                source.full_text = "\n\n".join(
                    block["text"] for block in extraction["blocks"]
                )
                await source.save()  # Source.save does not embed or invoke an LLM.
            if job:
                job = await service.store.get("job", input_data.job_id)
                if job.get("cancel_requested") or job["state"] == "cancelled_local":
                    return result
                job.update(
                    state="succeeded" if result.success else "failed",
                    result=result.model_dump(),
                    completed_at=datetime.now(timezone.utc).isoformat(),
                )
                await service.store.put("job", input_data.job_id, job)
        return result
    except Exception as exc:
        if job:
            async with service.store.project_lock(version["notebook_id"]):
                job = await service.store.get("job", input_data.job_id)
                if (
                    not job.get("cancel_requested")
                    and job["state"] != "cancelled_local"
                ):
                    job.update(
                        state="failed",
                        error={"type": type(exc).__name__, "message": str(exc)[:500]},
                        completed_at=datetime.now(timezone.utc).isoformat(),
                    )
                    await service.store.put("job", input_data.job_id, job)
        raise


class EvidenceMaintenanceInput(CommandInput):
    job_id: str


class EvidenceMaintenanceOutput(CommandOutput):
    job_id: str
    state: str


@command("maintain_evidence", app="open_notebook", retry={"max_attempts": 1})
async def maintain_evidence_command(
    input_data: EvidenceMaintenanceInput,
) -> EvidenceMaintenanceOutput:
    job = await EvidenceMaintenanceService().run(input_data.job_id)
    return EvidenceMaintenanceOutput(job_id=job["job_id"], state=job["state"])
