"""Immutable parent identity for local turn dispatch and commit admission."""

from dataclasses import dataclass

from open_notebook.exceptions import InvalidInputError


@dataclass(frozen=True)
class PersonalTurnAdmission:
    job_id: str
    turn_id: str
    notebook_id: str
    chat_session_id: str
    request_hash: str
    attempts: int

    @classmethod
    def capture(cls, job):
        return cls(**{name: job[name] for name in cls.__dataclass_fields__})

    async def assert_locked(self, store):
        """Caller owns the notebook barrier; never hold it over provider I/O."""
        current = await store.get("job", self.job_id)
        if not current or any(
            current.get(name) != getattr(self, name)
            for name in self.__dataclass_fields__
        ):
            raise InvalidInputError("TURN_ADMISSION_CHANGED")
        if (
            current.get("state") != "running"
            or current.get("cancel_requested")
            or current.get("operation") != "chat"
            or current.get("restored_history")
            or current.get("replay_allowed") is False
        ):
            raise InvalidInputError("TURN_ADMISSION_STOPPED")
