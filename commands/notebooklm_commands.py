"""One-shot remote submissions and short polls on surreal-commands.

Retry is disabled here deliberately. Domain jobs decide whether submission is
known; the API dispatcher only resumes safe queued work or polls original IDs.
"""

from surreal_commands import CommandInput, CommandOutput, command

from api.notebooklm_service import get_notebooklm_service


class NotebookLMJobInput(CommandInput):
    job_id: str


class NotebookLMJobOutput(CommandOutput):
    job_id: str
    state: str


@command("notebooklm_execute", app="open_notebook", retry={"enabled": False})
async def notebooklm_execute(input_data: NotebookLMJobInput) -> NotebookLMJobOutput:
    result = await get_notebooklm_service().run_job(input_data.job_id)
    return NotebookLMJobOutput(job_id=input_data.job_id, state=result["state"])


@command("notebooklm_poll", app="open_notebook", retry={"enabled": False})
async def notebooklm_poll(input_data: NotebookLMJobInput) -> NotebookLMJobOutput:
    result = await get_notebooklm_service().poll_job(input_data.job_id)
    return NotebookLMJobOutput(job_id=input_data.job_id, state=result["state"])
