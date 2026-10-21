"""Explicit, durable answer invocation. Never automatically retry provider calls."""

from surreal_commands import CommandInput, CommandOutput, command


class PersonalTurnInput(CommandInput):
    job_id: str


class PersonalTurnOutput(CommandOutput):
    job_id: str
    state: str


@command("personal_turn", app="open_notebook", retry={"max_attempts": 1})
async def personal_turn_command(input_data: PersonalTurnInput) -> PersonalTurnOutput:
    from api.personal_service import PersonalService

    job = await PersonalService().run_turn(input_data.job_id)
    return PersonalTurnOutput(job_id=job["job_id"], state=job["state"])
