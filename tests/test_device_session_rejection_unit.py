"""Session rejection boundaries using only in-memory synthetic credentials/state."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from device_session_core_fixtures import MemoryStore, error, setup

from api.device_session_models import AuthError
from api.device_session_service import DeviceSessionService


@pytest.mark.asyncio
async def test_naive_clock_fails_before_any_session_can_be_issued():
    service, store, _ = setup()
    service._clock = lambda: datetime(2026, 1, 1)
    await error("AUTH_UNAVAILABLE", service.create_session("synthetic", "device"))
    assert store.sessions == {} and store.access == {}


def test_clock_offset_is_normalized_to_utc_without_changing_instant():
    service, _, _ = setup()
    instant = datetime(2026, 1, 1, 9, tzinfo=timezone(timedelta(hours=9)))
    service._clock = lambda: instant
    assert service._now() == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert service._now().tzinfo is timezone.utc


@pytest.mark.parametrize(
    "identity",
    [
        None,
        True,
        7,
        "AABBCCDD-1122-3344-5566-778899001122",
        "aabbccdd112233445566778899001122",
    ],
)
def test_noncanonical_session_identity_is_rejected(identity):
    with pytest.raises(AuthError) as caught:
        DeviceSessionService._session_id(identity)
    assert caught.value.code == "AUTH_INVALID_REQUEST"


def test_noncanonical_base64_alias_is_not_an_unknown_valid_token():
    # B has the same decoded bytes as A in the final two unused padding bits.
    canonical = "swa1_" + "A" * 43
    alias = canonical[:-1] + "B"
    assert len(DeviceSessionService._digest(canonical, "swa1_")) == 64
    with pytest.raises(AuthError) as caught:
        DeviceSessionService._digest(alias, "swa1_")
    assert caught.value.code == "AUTH_INVALID_REQUEST"


@pytest.mark.parametrize("length", [0, 31, 33])
def test_wrong_entropy_length_never_produces_a_token(length):
    service, _, _ = setup()
    service._random = lambda _: bytes(length)
    with pytest.raises(AuthError) as caught:
        service._token("swa1_")
    assert caught.value.code == "AUTH_UNAVAILABLE"


@pytest.mark.asyncio
async def test_readiness_queries_authoritative_store_and_sanitizes_failure():
    service, store, _ = setup()
    assert await service.check_ready() is None
    store.fail = True
    caught = await error("AUTH_UNAVAILABLE", service.check_ready())
    assert "sensitive storage detail" not in str(caught)
    assert caught.__suppress_context__ is True


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["session_id", "digest"])
async def test_access_record_cannot_authenticate_a_mismatched_owner_or_digest(
    corruption,
):
    service, store, _ = setup()
    issued = await service.create_session("synthetic", "device")
    digest = service._digest(issued.access_token, "swa1_")
    original = store.access[digest]
    if corruption == "session_id":
        # Preserve a live returned session despite a contradictory access owner.
        other = replace(store.sessions[issued.session_id], session_id="other")
        store.sessions["other"] = other
        store.access[digest] = replace(original, session_id="other")

        async def contradictory(_):
            return store.access[digest], store.sessions[issued.session_id]

        store.get_access = contradictory
    else:
        store.access[digest] = replace(original, digest="0" * 64)
    await error("AUTH_REQUIRED", service.authenticate_access(issued.access_token))


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["missing", "revoked"])
async def test_authoritative_usage_update_loss_never_returns_prior_authorization(
    outcome,
):
    class Store(MemoryStore):
        async def advance_last_used(self, session_id, scope):
            return (
                None
                if outcome == "missing"
                else replace(self.sessions[session_id], revoked_at=scope.now)
            )

    service, store, clock = setup(store=Store())
    issued = await service.create_session("synthetic", "device")
    clock.advance(seconds=60)
    await error("AUTH_REQUIRED", service.authenticate_access(issued.access_token))


@pytest.mark.asyncio
async def test_unavailable_credentials_revoke_old_epoch_and_recover_without_reviving_it():
    class Credentials:
        unavailable = False

        async def read(self):
            if self.unavailable:
                raise AuthError("AUTH_UNAVAILABLE")
            return "synthetic"

    provider = Credentials()
    service, store, _ = setup(provider)
    issued = await service.create_session("synthetic", "device")
    provider.unavailable = True
    await error("AUTH_UNAVAILABLE", service.authenticate_access(issued.access_token))
    assert store.sessions[issued.session_id].revoked_at is not None
    provider.unavailable = False
    await error("AUTH_REQUIRED", service.authenticate_access(issued.access_token))
    replacement = await service.create_session("synthetic", "replacement")
    assert (
        await service.authenticate_access(replacement.access_token)
    ).session_id == replacement.session_id


def test_rate_limit_reports_latest_blocking_deadline_and_drops_expired_buckets():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    buckets = {
        "old": [now - timedelta(seconds=60)],
        "peer": [now - timedelta(seconds=10)],
        "other": [now - timedelta(seconds=59)],
    }
    with pytest.raises(AuthError) as caught:
        DeviceSessionService._limit(buckets, "peer", now, local=1, global_limit=2)
    assert caught.value.code == "AUTH_RATE_LIMITED"
    assert caught.value.retry_after == 50
    assert "old" not in buckets
