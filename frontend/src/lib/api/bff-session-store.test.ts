import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { BffSessionStore, digestSessionHandle, getProcessBffSessionStore, NativeCallError, type NativeCalls, type NativeEnvelope, type AccessSnapshot, type RecordRef } from './bff-session-store'

const START = Date.parse('2026-10-21T00:00:00.000Z')
const token = (prefix: string, byte: number) => prefix + Buffer.alloc(32, byte).toString('base64url')
const envelope = (id = 1, access = START + 900_000, deadline = START + 2_592_000_000) => ({
  session_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  access_token: token('swa1_', id),
  refresh_token: token('swr1_', id + 1),
  access_expires_at: new Date(access).toISOString(),
  refresh_expires_at: new Date(deadline).toISOString(),
})
const fixture = () => {
  const native = {
    create: vi.fn<NativeCalls['create']>(async () => envelope()),
    refresh: vi.fn<NativeCalls['refresh']>(async () => envelope()),
    probe: vi.fn<NativeCalls['probe']>(async () => ({ ok: true as const })),
    revoke: vi.fn<NativeCalls['revoke']>(async () => true),
  }
  return { native, store: new BffSessionStore({ native, clock: { now: Date.now, setTimeout, clearTimeout } }) }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('publishes a one-use opaque handle and pending metadata, never a native pair', async () => {
  const { store } = fixture()
  const admission = store.admitLogin()
  expect(admission.kind).toBe('admitted')
  if (admission.kind !== 'admitted') throw new Error('login admission failed')
  const result = store.publishLogin(admission, envelope())
  expect(result.kind).toBe('published')
  if (result.kind !== 'published') throw new Error('login publication failed')
  expect(result.handle).toMatch(/^swb1_[A-Za-z0-9_-]{43}$/)
  const digest = digestSessionHandle(result.handle)
  expect(digest).toMatch(/^[a-f0-9]{64}$/)
  expect(store.lookup(digest!)).toBe(result.record)
  expect(store.snapshotForResource(digest!)).toEqual({ kind: 'pending', metadata: result.metadata })
  expect(Object.keys(result.metadata).sort()).toEqual(['access_expires_at', 'generation', 'refresh_expires_at', 'session_id'])
  expect(store.publishLogin(admission, envelope()).kind).not.toBe('published')
  expect(await store.confirmStatus(result.record)).toEqual({ kind: 'confirmed', metadata: result.metadata })
  expect(store.snapshotForResource(digest!)).toMatchObject({ accessToken: envelope().access_token, generation: 0 })
  store.retireOwn(result.record)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function publish(store: BffSessionStore, value = envelope(), predecessor?: RecordRef) {
  const admission = store.admitLogin(predecessor)
  if (admission.kind !== 'admitted') throw new Error('admission failed')
  const result = store.publishLogin(admission, value)
  if (result.kind !== 'published') throw new Error('publication failed')
  return { ...result, digest: digestSessionHandle(result.handle)! }
}
async function active(store: BffSessionStore, value = envelope()) {
  const result = publish(store, value)
  expect((await store.confirmStatus(result.record)).kind).toBe('confirmed')
  return result
}
function snapshot(store: BffSessionStore, digest: string): AccessSnapshot {
  const result = store.snapshotForResource(digest)
  if (!('accessToken' in result)) throw new Error('no resource access')
  return result
}

describe('custody and admission bounds', () => {
  it('rejects noncanonical handles, aliases, token confusion and unbounded lookup keys', () => {
    const handle = token('swb1_', 1)
    expect(digestSessionHandle(handle)).toHaveLength(64)
    for (const invalid of ['', handle + '=', handle + ' ', handle.toUpperCase(), token('swa1_', 1), 'x'.repeat(8192)]) {
      expect(digestSessionHandle(invalid)).toBeUndefined()
    }
    const alias = handle.slice(0, -1) + String.fromCharCode(handle.charCodeAt(handle.length - 1) + 1)
    expect(digestSessionHandle(alias)).toBeUndefined()
    const { store } = fixture()
    expect(store.lookup('f'.repeat(65))).toBeUndefined()
    expect(() => JSON.stringify(store)).toThrow('not serializable')
  })

  it('shares only the same versioned process registry across bundled imports', async () => {
    const { native } = fixture()
    const options = { native }
    const first = getProcessBffSessionStore(options)
    vi.resetModules()
    const reloaded = await import('./bff-session-store')
    expect(reloaded.getProcessBffSessionStore(options)).toBe(first)
  })

  it('admits eight login/pending slots without upstream calls or live eviction', async () => {
    const { store, native } = fixture()
    const admissions = Array.from({ length: 8 }, () => store.admitLogin())
    expect(admissions.every(a => a.kind === 'admitted')).toBe(true)
    expect(store.admitLogin()).toEqual({ kind: 'busy' })
    expect(native.create).not.toHaveBeenCalled()
    for (const a of admissions) if (a.kind === 'admitted') store.cancelLogin(a)
    const pending = publish(store)
    const held = Array.from({ length: 7 }, () => store.admitLogin())
    expect(store.admitLogin().kind).toBe('busy')
    await store.confirmStatus(pending.record)
    expect(store.admitLogin().kind).toBe('admitted')
    for (const a of held) if (a.kind === 'admitted') store.cancelLogin(a)
  })

  it('enforces 64 combined live/reserved slots and releases only expired or retired records', async () => {
    const { store } = fixture()
    const records = []
    for (let id = 1; id <= 64; id++) records.push(await active(store, envelope(id)))
    expect(store.admitLogin().kind).toBe('busy')
    expect(store.lookup(records[0].digest)).toBe(records[0].record)
    store.retireOwn(records[0].record)
    expect(store.admitLogin().kind).toBe('admitted')
  })

  it('pending expiry cleans once and cannot be promoted by a late probe', async () => {
    const { store, native } = fixture()
    const pending = publish(store)
    await vi.advanceTimersByTimeAsync(59_000)
    const probe = deferred<{ ok: true }>()
    native.probe.mockReturnValueOnce(probe.promise)
    const status = store.confirmStatus(pending.record)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(store.lookup(pending.digest)).toBeUndefined()
    probe.resolve({ ok: true })
    expect((await status).kind).toBe('reauth-required')
    store.cleanupKnownRetired(pending.record, 'expired')
    await flush()
    expect(native.revoke).toHaveBeenCalledTimes(1)
  })
})

describe('strict metadata-only rotation', () => {
  it('shares one native rotation with 32 followers, preserves live overlap and rejects only excess callers', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000))
    const rotation = deferred<NativeEnvelope>()
    native.refresh.mockReturnValueOnce(rotation.promise)
    const owner = store.refresh(p.record)
    const followers = Array.from({ length: 32 }, () => store.refresh(p.record))
    expect((await store.refresh(p.record)).kind).toBe('busy')
    expect(snapshot(store, p.digest).accessToken).toBe(envelope().access_token)
    expect(native.refresh).toHaveBeenCalledTimes(1)
    const successor = { ...envelope(), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) }
    rotation.resolve(successor)
    const results = await Promise.all([owner, ...followers])
    expect(results.every(r => r.kind === 'confirmed')).toBe(true)
    expect(JSON.stringify(results)).not.toMatch(/swa1_|swr1_|swb1_/)
    expect(snapshot(store, p.digest)).toMatchObject({ accessToken: successor.access_token, generation: 1 })
    expect((await store.refresh(p.record)).kind).toBe('confirmed')
    expect((await store.confirmStatus(p.record)).kind).toBe('confirmed')
    expect(native.refresh).toHaveBeenCalledTimes(1)
  })

  it.each(['lost ACK', '429', '503', 'REFRESH_REJECTED', 'malformed'])('retires after %s without resending or family cleanup', async failure => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000))
    if (failure === 'malformed') native.refresh.mockResolvedValueOnce({ access_token: 'bad' })
    else native.refresh.mockRejectedValueOnce(new Error(failure))
    expect((await store.refresh(p.record)).kind).toBe('reauth-required')
    expect((await store.refresh(p.record)).kind).toBe('reauth-required')
    expect(store.lookup(p.digest)).toBeUndefined()
    expect(native.refresh).toHaveBeenCalledTimes(1)
    expect(native.revoke).not.toHaveBeenCalled()
  })

  it('times out rotation without resurrection from a late acknowledged successor', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000))
    const rotation = deferred<NativeEnvelope>()
    native.refresh.mockReturnValueOnce(rotation.promise)
    const owner = store.refresh(p.record)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await owner).kind).toBe('reauth-required')
    expect(native.refresh.mock.calls[0][1].aborted).toBe(true)
    rotation.resolve(envelope())
    await flush()
    expect(store.lookup(p.digest)).toBeUndefined()
  })

  it('retires immediately during network wait and refuses late status/fast-path completion', async () => {
    const { store, native } = fixture()
    const p = await active(store)
    const probe = deferred<{ ok: true }>()
    native.probe.mockReturnValueOnce(probe.promise)
    const refresh = store.refresh(p.record)
    expect(store.retireOwn(p.record)).toBeUndefined()
    expect(store.lookup(p.digest)).toBeUndefined()
    probe.resolve({ ok: true })
    expect((await refresh).kind).toBe('reauth-required')
  })

  it('never proactively rotates access already clipped to the absolute deadline', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000, START + 20_000))
    for (let i = 0; i < 12; i++) expect((await store.refresh(p.record)).kind).toBe('confirmed')
    expect(native.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(store.snapshotForResource(p.digest).kind).toBe('reauth-required')
    expect((await store.refresh(p.record)).kind).toBe('reauth-required')
    expect(native.refresh).not.toHaveBeenCalled()
  })

  it('rotates an earlier-expiring final access once, then suppresses a terminal storm', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 5_000, START + 20_000))
    native.refresh.mockResolvedValueOnce({ ...envelope(1, START + 20_000, START + 20_000), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) })
    for (let i = 0; i < 12; i++) expect((await store.refresh(p.record)).kind).toBe('confirmed')
    expect(native.refresh).toHaveBeenCalledTimes(1)
  })

  it('checks immutable session ID/deadline, canonical tokens, access bounds and distinct successors', async () => {
    const invalid = [
      { ...envelope(), session_id: envelope(2).session_id },
      { ...envelope(), refresh_expires_at: new Date(START + 2_592_000_001).toISOString() },
      { ...envelope(), access_expires_at: new Date(START + 900_001).toISOString() },
      { ...envelope(), access_token: 'not-a-token' },
      { ...envelope(), extra: true },
    ]
    for (const response of invalid) {
      const { store, native } = fixture()
      const p = await active(store, envelope(1, START + 20_000))
      native.refresh.mockResolvedValueOnce(response)
      expect((await store.refresh(p.record)).kind).toBe('reauth-required')
    }
  })
})

describe('expiry-aware authority', () => {
  it('reports locally expired or pruned access as refresh-needed without claiming auth', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 1_000))
    const old = snapshot(store, p.digest)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await store.confirmStatus(p.record)).kind).toBe('refresh-needed')
    expect(store.snapshotForResource(p.digest).kind).toBe('refresh-needed')
    expect(store.observeAuthFailure(old, 'AUTH_REQUIRED').kind).toBe('refresh-needed')
    expect(store.lookup(p.digest)).toBe(p.record)
    native.refresh.mockResolvedValueOnce({ ...envelope(), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) })
    expect((await store.refresh(p.record)).kind).toBe('confirmed')
    expect(native.refresh).toHaveBeenCalledTimes(1)
  })

  it('fresh current AUTH_REQUIRED retires, old generation cannot destroy the winner', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000))
    const old = snapshot(store, p.digest)
    native.refresh.mockResolvedValueOnce({ ...envelope(), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) })
    await store.refresh(p.record)
    expect(store.observeAuthFailure(old, 'AUTH_REQUIRED').kind).toBe('unavailable')
    expect(store.lookup(p.digest)).toBe(p.record)
    expect(store.observeAuthFailure(snapshot(store, p.digest), 'AUTH_REQUIRED').kind).toBe('reauth-required')
  })

  it('rechecks generation after a delayed status probe rather than publishing stale metadata', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000))
    const probe = deferred<{ ok: true }>()
    native.probe.mockReturnValueOnce(probe.promise)
    const status = store.confirmStatus(p.record)
    native.refresh.mockResolvedValueOnce({ ...envelope(), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) })
    await store.refresh(p.record)
    probe.resolve({ ok: true })
    expect((await status).kind).toBe('unavailable')
    expect(snapshot(store, p.digest).generation).toBe(1)
  })

  it('lets authoritative current ACCESS_EXPIRED request rotation even before the local deadline', async () => {
    const { store, native } = fixture()
    const p = await active(store)
    expect(store.observeAuthFailure(snapshot(store, p.digest), 'ACCESS_EXPIRED').kind).toBe('refresh-needed')
    native.refresh.mockRejectedValueOnce(new Error('REFRESH_REJECTED'))
    expect((await store.refresh(p.record)).kind).toBe('reauth-required')
    expect(native.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('admission ordering and bounded orphan cleanup', () => {
  it('older A cannot publish after newer B confirms; suppressed known A is cleaned once', async () => {
    const { store, native } = fixture()
    const a = deferred<NativeEnvelope>()
    const b = deferred<NativeEnvelope>()
    native.create.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const first = store.login({ password: 'synthetic-a', device_name: 'A' })
    const second = store.login({ password: 'synthetic-b', device_name: 'B' })
    b.resolve(envelope(2))
    const winner = await second
    if (winner.kind !== 'published') throw new Error('B must win')
    await store.confirmStatus(winner.record)
    a.resolve(envelope(1))
    const loser = await first
    expect(loser.kind).toBe('reauth-required')
    expect('handle' in loser).toBe(false)
    expect(store.lookup(digestSessionHandle(winner.handle)!)).toBe(winner.record)
    await flush()
    expect(native.revoke).toHaveBeenCalledTimes(1)
    expect(native.revoke.mock.calls[0][0].sessionId).toBe(envelope(1).session_id)
  })

  it('newer wrong password preserves predecessor and does not suppress older valid A', async () => {
    const { store, native } = fixture()
    const old = await active(store, envelope(3))
    const a = deferred<NativeEnvelope>()
    native.create.mockReturnValueOnce(a.promise).mockRejectedValueOnce(new Error('AUTH_INVALID_CREDENTIALS'))
    const first = store.login({ password: 'synthetic-a', device_name: 'A' })
    expect((await store.login({ password: 'bad', device_name: 'B' }, old.record)).kind).toBe('unavailable')
    expect(store.lookup(old.digest)).toBe(old.record)
    a.resolve(envelope())
    expect((await first).kind).toBe('published')
  })

  it('supersession and successful predecessor replacement clean only captured old identities', async () => {
    const { store, native } = fixture()
    const predecessor = await active(store, envelope(1))
    const pending = publish(store, envelope(2))
    const replacement = publish(store, envelope(3), predecessor.record)
    expect(store.lookup(predecessor.digest)).toBeUndefined()
    expect(store.lookup(pending.digest)).toBeUndefined()
    expect(store.lookup(replacement.digest)).toBe(replacement.record)
    await flush()
    expect(native.revoke.mock.calls.map(([request]) => request.sessionId).sort()).toEqual([envelope(1).session_id, envelope(2).session_id])
    store.cleanupKnownRetired(predecessor.record, 'again')
    expect(native.revoke).toHaveBeenCalledTimes(2)
  })

  it('own signout cancels associated admitted operations, not unrelated or previously unseen logins', async () => {
    const { store, native } = fixture()
    const old = await active(store)
    const own = deferred<NativeEnvelope>()
    const other = deferred<NativeEnvelope>()
    native.create.mockReturnValueOnce(own.promise).mockReturnValueOnce(other.promise)
    const ownLogin = store.login({ password: 'synthetic', device_name: 'own' }, old.record)
    const otherLogin = store.login({ password: 'synthetic', device_name: 'other' })
    store.retireOwn(old.record)
    own.resolve(envelope(2)); other.resolve(envelope(3))
    expect((await ownLogin).kind).toBe('reauth-required')
    expect((await otherLogin).kind).toBe('published')
    native.create.mockResolvedValueOnce(envelope(4))
    expect((await store.login({ password: 'synthetic', device_name: 'late' })).kind).toBe('published')
  })

  it('late known create success after the 10-second deadline is cleaned, never published', async () => {
    const { store, native } = fixture()
    const late = deferred<NativeEnvelope>()
    native.create.mockReturnValueOnce(late.promise)
    const result = store.login({ password: 'synthetic', device_name: 'late' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await result).kind).toBe('unavailable')
    late.resolve(envelope())
    await flush()
    expect(native.revoke).toHaveBeenCalledTimes(1)
    expect(native.create).toHaveBeenCalledTimes(1)
  })

  it('hung create adapters retain physical admission reservations after logical timeout', async () => {
    const { store, native } = fixture()
    const late = Array.from({ length: 8 }, () => deferred<NativeEnvelope>())
    late.forEach(d => native.create.mockReturnValueOnce(d.promise))
    const operations = late.map(() => store.login({ password: 'synthetic', device_name: 'hung' }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await Promise.all(operations)).every(r => r.kind === 'unavailable')).toBe(true)
    for (let i = 0; i < 20; i++) expect((await store.login({ password: 'synthetic', device_name: 'no' })).kind).toBe('busy')
    expect(native.create).toHaveBeenCalledTimes(8)
    late.forEach(d => d.reject(new Error('aborted')))
    await flush()
    expect(store.admitLogin().kind).toBe('admitted')
  })

  it('cleanup has four physical slots, 5-second deadlines, no queue and no retries', async () => {
    const { store, native } = fixture()
    const hung = Array.from({ length: 4 }, () => deferred<boolean>())
    hung.forEach(d => native.revoke.mockReturnValueOnce(d.promise))
    const records = []
    for (let id = 1; id <= 6; id++) records.push(await active(store, envelope(id)))
    records.forEach(p => store.retireOwn(p.record))
    expect(native.revoke).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(native.revoke.mock.calls.every(([, signal]) => signal.aborted)).toBe(true)
    const seventh = await active(store, envelope(7))
    store.retireOwn(seventh.record)
    expect(native.revoke).toHaveBeenCalledTimes(4)
    hung.forEach(d => d.resolve(true))
    await flush()
    records.forEach(p => store.cleanupKnownRetired(p.record, 'repeat'))
    expect(native.revoke).toHaveBeenCalledTimes(4)
  })
})

describe('fresh cross-record authority and captured boundaries', () => {
  it('rejects ordinary/forged snapshots and natively revoked callers without affecting other sessions', async () => {
    const { store, native } = fixture()
    const caller = await active(store)
    const other = await active(store, envelope(2))
    expect(store.captureAuthorizedRevocation(snapshot(store, caller.digest), 'all').kind).toBe('reauth-required')
    native.probe.mockResolvedValueOnce({ ok: false, code: 'AUTH_REQUIRED' })
    expect((await store.validateAuthority(caller.record)).kind).toBe('reauth-required')
    expect(store.lookup(other.digest)).toBe(other.record)
    const a = store.admitLogin()
    expect(a.kind).toBe('admitted')
  })

  it('requires one-use current unexpired store proof and rechecks after its awaited probe', async () => {
    const { store, native } = fixture()
    const caller = await active(store)
    const other = await active(store, envelope(2))
    const proof = await store.validateAuthority(caller.record)
    if (!('accessToken' in proof)) throw new Error('validated access needed')
    expect(store.captureAuthorizedRevocation({ ...proof }, envelope(2).session_id).kind).toBe('reauth-required')
    const boundary = store.captureAuthorizedRevocation(proof, envelope(2).session_id)
    expect(boundary.kind).toBe('captured')
    expect(store.lookup(other.digest)).toBeUndefined()
    expect(store.captureAuthorizedRevocation(proof, 'all').kind).toBe('reauth-required')
    const probe = deferred<{ ok: true }>()
    native.probe.mockReturnValueOnce(probe.promise)
    const late = store.validateAuthority(caller.record)
    store.retireOwn(caller.record)
    probe.resolve({ ok: true })
    expect((await late).kind).toBe('reauth-required')
  })

  it('delayed revoke-all completion never rescans records or cancels logins admitted after its boundary', async () => {
    const { store, native } = fixture()
    const caller = await active(store)
    await active(store, envelope(2))
    const before = deferred<NativeEnvelope>()
    native.create.mockReturnValueOnce(before.promise)
    const admitted = store.login({ password: 'synthetic', device_name: 'before' })
    const proof = await store.validateAuthority(caller.record)
    if (!('accessToken' in proof)) throw new Error('validated access needed')
    const boundary = store.captureAuthorizedRevocation(proof, 'all')
    if (boundary.kind !== 'captured') throw new Error('boundary needed')
    const newer = await active(store, envelope(3))
    before.resolve(envelope(4))
    expect((await admitted).kind).toBe('reauth-required')
    expect(store.completeRevocation(boundary, true)).toEqual({ server_revocation: 'confirmed' })
    expect(store.lookup(newer.digest)).toBe(newer.record)
    native.probe.mockResolvedValueOnce({ ok: false, code: 'AUTH_REQUIRED' })
    expect((await store.confirmStatus(newer.record)).kind).toBe('reauth-required')
  })
})

describe('adversarial owner completion and failure hygiene', () => {
  it('returns only typed allowlisted login rejection codes and bounded retry advice', async () => {
    const { store, native } = fixture()
    native.create.mockRejectedValueOnce(new NativeCallError('AUTH_INVALID_CREDENTIALS'))
    expect(await store.login({ password: 'synthetic', device_name: 'bad' })).toEqual({ kind: 'login-rejected', code: 'AUTH_INVALID_CREDENTIALS' })
    native.create.mockRejectedValueOnce(new NativeCallError('AUTH_RATE_LIMITED', 99_999))
    expect(await store.login({ password: 'synthetic', device_name: 'limited' })).toEqual({ kind: 'login-rejected', code: 'AUTH_RATE_LIMITED', retryAfter: 60 })
    const secret = 'synthetic-credential-sentinel'
    native.create.mockRejectedValueOnce({ body: secret, cause: new Error(secret), code: 'AUTH_INVALID_CREDENTIALS' })
    const unknown = await store.login({ password: secret, device_name: 'unknown' })
    expect(unknown).toEqual({ kind: 'unavailable' })
    expect(JSON.stringify(unknown)).not.toContain(secret)
  })

  it('successful replacement does not cancel its own owner or release its live capacity lease', async () => {
    const { store, native } = fixture()
    const predecessor = await active(store)
    native.create.mockResolvedValueOnce(envelope(2))
    const replacement = await store.login({ password: 'synthetic', device_name: 'replacement' }, predecessor.record)
    expect(replacement.kind).toBe('published')
    if (replacement.kind !== 'published') throw new Error('replacement required')
    await store.confirmStatus(replacement.record)
    for (let id = 3; id <= 65; id++) await active(store, envelope(id))
    expect(store.admitLogin().kind).toBe('busy')
    expect(store.lookup(digestSessionHandle(replacement.handle)!)).toBe(replacement.record)
  })

  it('ignored probe abort cannot start unbounded underlying probes after timeouts', async () => {
    const { store, native } = fixture()
    const p = await active(store)
    const hung = deferred<{ ok: true }>()
    native.probe.mockReturnValueOnce(hung.promise)
    const status = store.confirmStatus(p.record)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await status).kind).toBe('unavailable')
    for (let i = 0; i < 20; i++) expect((await store.confirmStatus(p.record)).kind).toBe('unavailable')
    expect(native.probe).toHaveBeenCalledTimes(2)
    hung.resolve({ ok: true })
    await flush()
    expect((await store.confirmStatus(p.record)).kind).toBe('confirmed')
    expect(native.probe).toHaveBeenCalledTimes(3)
  })

  it('fresh authority proof expires and cannot survive a generation change', async () => {
    const { store, native } = fixture()
    const caller = await active(store, envelope(1, START + 20_000))
    const other = await active(store, envelope(2))
    const expired = await store.validateAuthority(caller.record)
    if (!('accessToken' in expired)) throw new Error('proof required')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(store.captureAuthorizedRevocation(expired, 'all').kind).toBe('reauth-required')
    const stale = await store.validateAuthority(caller.record)
    if (!('accessToken' in stale)) throw new Error('proof required')
    native.refresh.mockResolvedValueOnce({ ...envelope(), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) })
    await store.refresh(caller.record)
    expect(store.captureAuthorizedRevocation(stale, 'all').kind).toBe('unavailable')
    expect(store.lookup(other.digest)).toBe(other.record)
  })
})

describe('post-wait revalidation and physical capacity', () => {
  it('a follower does not publish confirmed metadata after retirement between owner and follower completion', async () => {
    const { store, native } = fixture()
    const p = await active(store, envelope(1, START + 20_000))
    const rotating = deferred<NativeEnvelope>()
    native.refresh.mockReturnValueOnce(rotating.promise)
    const owner = store.refresh(p.record)
    void owner.then(() => store.retireOwn(p.record))
    const follower = store.refresh(p.record)
    rotating.resolve({ ...envelope(), access_token: token('swa1_', 91), refresh_token: token('swr1_', 92) })
    expect((await owner).kind).toBe('confirmed')
    expect((await follower).kind).toBe('reauth-required')
  })

  it('retired records with hung rotation calls still consume the combined 64 physical slots', async () => {
    const { store, native } = fixture()
    const records = []
    for (let id = 1; id <= 64; id++) records.push(await active(store, envelope(id, START + 20_000)))
    const hung = records.map(() => deferred<NativeEnvelope>())
    hung.forEach(d => native.refresh.mockReturnValueOnce(d.promise))
    const owners = records.map(p => store.refresh(p.record))
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await Promise.all(owners)).every(r => r.kind === 'reauth-required')).toBe(true)
    expect(records.every(p => !store.lookup(p.digest))).toBe(true)
    expect(store.admitLogin().kind).toBe('busy')
    hung[0].reject(new Error('aborted'))
    await flush()
    expect(store.admitLogin().kind).toBe('admitted')
    expect(native.refresh).toHaveBeenCalledTimes(64)
    hung.slice(1).forEach(d => d.reject(new Error('aborted')))
    await flush()
  })

  it('pending supersession cannot promote the older record even when its probe later succeeds', async () => {
    const { store, native } = fixture()
    const old = publish(store)
    const probe = deferred<{ ok: true }>()
    native.probe.mockReturnValueOnce(probe.promise)
    const status = store.confirmStatus(old.record)
    const newer = publish(store, envelope(2))
    probe.resolve({ ok: true })
    expect((await status).kind).toBe('reauth-required')
    expect(store.lookup(old.digest)).toBeUndefined()
    expect((await store.confirmStatus(newer.record)).kind).toBe('confirmed')
  })

  it('keeps token-bearing publications and resource snapshots nonserializable', async () => {
    const { store } = fixture()
    const admission = store.admitLogin()
    if (admission.kind !== 'admitted') throw new Error('admission needed')
    const publication = store.publishLogin(admission, envelope())
    if (publication.kind !== 'published') throw new Error('publication needed')
    expect(() => JSON.stringify(publication)).toThrow('not serializable')
    await store.confirmStatus(publication.record)
    expect(() => JSON.stringify(snapshot(store, digestSessionHandle(publication.handle)!))).toThrow('not serializable')
    expect(JSON.stringify(publication.metadata)).not.toMatch(/swa1_|swr1_|swb1_/)
  })
})

describe('safe publication failures', () => {
  it('sanitizes a synchronous adapter failure just like an asynchronous rejection', async () => {
    const { store, native } = fixture()
    native.create.mockImplementationOnce(() => { throw new NativeCallError('AUTH_INVALID_CREDENTIALS') })
    expect(await store.login({ password: 'synthetic', device_name: 'sync' })).toEqual({ kind: 'login-rejected', code: 'AUTH_INVALID_CREDENTIALS' })
    for (let i = 0; i < 8; i++) expect(store.admitLogin().kind).toBe('admitted')
  })

  it('rejects an already-current native session ID without cleaning or replacing that session', async () => {
    const { store, native } = fixture()
    const current = await active(store)
    native.create.mockResolvedValueOnce(envelope())
    expect((await store.login({ password: 'synthetic', device_name: 'duplicate' }, current.record)).kind).toBe('unavailable')
    expect(store.lookup(current.digest)).toBe(current.record)
    expect(native.revoke).not.toHaveBeenCalled()
  })

  it('cleans a known successful create if CSPRNG issuance fails and frees admission capacity', async () => {
    const { native } = fixture()
    const store = new BffSessionStore({ native, clock: { now: Date.now, setTimeout, clearTimeout }, randomBytes: () => new Uint8Array(31) })
    expect((await store.login({ password: 'synthetic', device_name: 'entropy failure' })).kind).toBe('unavailable')
    await flush()
    expect(native.revoke).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 8; i++) expect(store.admitLogin().kind).toBe('admitted')
  })

  it('a stale known success cannot clean the current session even if its native ID is duplicated', async () => {
    const { store, native } = fixture()
    const late = deferred<NativeEnvelope>()
    native.create.mockReturnValueOnce(late.promise)
    const older = store.login({ password: 'synthetic', device_name: 'older' })
    const current = await active(store, envelope(2))
    late.resolve(envelope(2))
    expect((await older).kind).not.toBe('published')
    expect(store.lookup(current.digest)).toBe(current.record)
    expect(native.revoke).not.toHaveBeenCalled()
  })
})
