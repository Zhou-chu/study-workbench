import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

/** Server-only custody. Never pass this module's objects to a Client Component. */
export const BFF_SESSION_LIMITS = Object.freeze({
  records: 64,
  loginPending: 8,
  refreshFollowers: 32,
  pendingMs: 60_000,
  ownerMs: 10_000,
  cleanupCalls: 4,
  cleanupMs: 5_000,
})
const ACCESS_MS = 900_000
const SESSION_MS = 2_592_000_000
const REFRESH_WINDOW_MS = 30_000
const REGISTRY_VERSION = 'bff-memory-v1/core-1'
const REGISTRY_KEY = Symbol.for('study-workbench.bff-session-registry')
const inspect = Symbol.for('nodejs.util.inspect.custom')
const nativeError = Symbol.for('study-workbench.native-call-error')
const LOGIN_ERROR_CODES = ['AUTH_INVALID_REQUEST', 'AUTH_INVALID_CREDENTIALS', 'AUTH_RATE_LIMITED', 'AUTH_UNAVAILABLE'] as const
export type NativeLoginErrorCode = typeof LOGIN_ERROR_CODES[number]
/** Adapter-created sanitized error. Never attach a raw response, request or cause. */
export class NativeCallError extends Error {
  readonly [nativeError] = true
  readonly code: NativeLoginErrorCode
  readonly retryAfter?: number
  constructor(code: NativeLoginErrorCode, retryAfter?: number) {
    const safeCode = LOGIN_ERROR_CODES.includes(code) ? code : 'AUTH_UNAVAILABLE'
    super(safeCode)
    this.code = safeCode
    if (safeCode === 'AUTH_RATE_LIMITED' && Number.isInteger(retryAfter)) this.retryAfter = Math.max(1, Math.min(60, retryAfter!))
  }
}
function loginFailure(error: unknown): LoginPublication {
  if (error && typeof error === 'object' && nativeError in error && error[nativeError] === true
    && 'code' in error && LOGIN_ERROR_CODES.includes(error.code as NativeLoginErrorCode)) {
    const code = error.code as NativeLoginErrorCode
    const retry = 'retryAfter' in error ? error.retryAfter : undefined
    return { kind: 'login-rejected', code, ...(code === 'AUTH_RATE_LIMITED' && typeof retry === 'number' && Number.isInteger(retry)
      ? { retryAfter: Math.max(1, Math.min(60, retry)) } : {}) }
  }
  return unavailable()
}
declare const recordBrand: unique symbol

export type RecordRef = Readonly<{ [recordBrand]: true }>
export type WebSessionMetadata = Readonly<{
  session_id: string
  access_expires_at: string
  refresh_expires_at: string
  generation: number
}>
export type AuthOutcome =
  | { kind: 'confirmed' | 'pending' | 'refresh-needed'; metadata: WebSessionMetadata }
  | { kind: 'reauth-required' | 'unavailable' | 'busy' }
export type AccessSnapshot = Readonly<{
  kind: 'access'
  record: RecordRef
  generation: number
  accessToken: string
  apiSessionId: string
  accessExpiresAt: string
  sessionExpiresAt: string
}>
export type NativeEnvelope = Readonly<{
  session_id: string
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
}>
export type LoginInput = Readonly<{ password: string; device_name: string }>
export type NativeCalls = {
  create(input: LoginInput, signal: AbortSignal): Promise<unknown>
  refresh(input: { session_id: string; refresh_token: string }, signal: AbortSignal): Promise<unknown>
  probe(snapshot: AccessSnapshot, signal: AbortSignal): Promise<{ ok: true } | { ok: false; code: string }>
  /** Resolve true only for an acknowledged native 204; never retry. */
  revoke(input: { accessToken: string; sessionId: string }, signal: AbortSignal): Promise<boolean>
}
export type SessionClock = {
  now(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}
export type BffSessionOptions = {
  native: NativeCalls
  clock?: SessionClock
  /** Production defaults to Node's CSPRNG; injection is for deterministic fixtures. */
  randomBytes?: (size: number) => Uint8Array
}
export type LoginAdmission = Readonly<{ kind: 'admitted'; sequence: number }>
export type LoginPublication =
  | Readonly<{ kind: 'login-rejected'; code: NativeLoginErrorCode; retryAfter?: number }>
  | Readonly<{ kind: 'published'; handle: string; record: RecordRef; metadata: WebSessionMetadata }>
  | AuthOutcome
export type RevocationBoundary = Readonly<{
  kind: 'captured'
  target: string | 'all'
  admissionSequence: number
}>

type Lease = { live: boolean; inFlight: number }
type Admission = {
  ref: LoginAdmission
  lease: Lease
  predecessor?: RecordRef
  deadline: number
  active: boolean
  consumed: boolean
  timer?: ReturnType<typeof setTimeout>
  stop?: () => void
}
type Flight = { promise: Promise<AuthOutcome>; followers: number }
type SessionRecord = {
  ref: RecordRef
  digest: string
  lease: Lease
  phase: 'pending' | 'active' | 'retired'
  metadata: WebSessionMetadata
  accessToken?: string
  refreshToken?: string
  pendingDeadline: number
  pendingTimer?: ReturnType<typeof setTimeout>
  needsRefresh: boolean
  refresh?: Flight
  status?: Flight
  authorityBusy: boolean
  stops: Set<() => void>
  cleanup: 'unused' | 'pending' | 'confirmed' | 'unconfirmed'
}
type Call<T> = { promise: Promise<T>; stop(value: T): void }

const reauth = (): AuthOutcome => ({ kind: 'reauth-required' })
const unavailable = (): AuthOutcome => ({ kind: 'unavailable' })
const busy = (): AuthOutcome => ({ kind: 'busy' })

/** No serialization/inspection of token-bearing server objects, even by accident. */
function privateObject<T extends object>(value: T): T {
  Object.defineProperties(value, {
    toJSON: { value: () => { throw new Error('BFF custody is not serializable') } },
    [inspect]: { value: () => '[private BFF custody]' },
  })
  return Object.freeze(value)
}
function canonicalToken(value: unknown, prefix: string): value is string {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(value)) return false
  const encoded = value.slice(prefix.length)
  const decoded = Buffer.from(encoded, 'base64url')
  return decoded.length === 32 && decoded.toString('base64url') === encoded
}
/** Cookie ambiguity/duplicate rejection belongs to request policy, not this core. */
export function digestSessionHandle(handle: string): string | undefined {
  return canonicalToken(handle, 'swb1_') ? createHash('sha256').update(handle, 'ascii').digest('hex') : undefined
}
function dateMs(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return NaN
  const result = Date.parse(value)
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN
  return result
}
function validEnvelope(value: unknown, now: number): value is NativeEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  const keys = ['session_id', 'access_token', 'refresh_token', 'access_expires_at', 'refresh_expires_at']
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key))) return false
  const access = dateMs(v.access_expires_at)
  const session = dateMs(v.refresh_expires_at)
  return typeof v.session_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v.session_id)
    && canonicalToken(v.access_token, 'swa1_') && canonicalToken(v.refresh_token, 'swr1_')
    && access > now && access <= now + ACCESS_MS && session > now && session <= now + SESSION_MS && access <= session
}
function metadata(value: NativeEnvelope, generation: number): WebSessionMetadata {
  return Object.freeze({ session_id: value.session_id, access_expires_at: value.access_expires_at,
    refresh_expires_at: value.refresh_expires_at, generation })
}

/**
 * One stable Node process only. No I/O at construction, no cookie or resource code.
 * A timed-out adapter retains its physical capacity until it settles, even if it
 * ignores abort. This intentionally fails closed rather than accumulating work.
 */
export class BffSessionStore {
  readonly #native: NativeCalls
  readonly #clock: SessionClock
  readonly #random: (size: number) => Uint8Array
  readonly #records = new Map<string, SessionRecord>()
  readonly #refs = new WeakMap<RecordRef, SessionRecord>()
  readonly #leases = new Set<Lease>()
  readonly #loginLeases = new Set<Lease>()
  readonly #admissions = new WeakMap<LoginAdmission, Admission>()
  readonly #activeAdmissions = new Set<Admission>()
  readonly #proofs = new WeakMap<AccessSnapshot, number>()
  readonly #boundaries = new WeakMap<RevocationBoundary, readonly RecordRef[]>()
  #sequence = 0
  #publishedSequence = 0
  #logoutFence = 0
  #cleanupInFlight = 0

  constructor(options: BffSessionOptions) {
    this.#native = options.native
    this.#clock = options.clock ?? { now: Date.now, setTimeout, clearTimeout }
    this.#random = options.randomBytes ?? randomBytes
  }
  toJSON(): never { throw new Error('BFF custody is not serializable') }
  [inspect](): string { return '[private BFF custody]' }

  #release(lease: Lease): void {
    if (!lease.live && lease.inFlight === 0) {
      this.#leases.delete(lease)
      this.#loginLeases.delete(lease)
    }
  }
  #sweep(): void {
    const now = this.#clock.now()
    for (const record of this.#records.values()) {
      if (now >= dateMs(record.metadata.refresh_expires_at) || (record.phase === 'pending' && now >= record.pendingDeadline)) {
        this.#retire(record, true)
      }
    }
  }
  #current(ref: RecordRef): SessionRecord | undefined {
    this.#sweep()
    const record = this.#refs.get(ref)
    return record && record.phase !== 'retired' && this.#records.get(record.digest) === record ? record : undefined
  }
  lookup(handleDigest: string): RecordRef | undefined {
    if (!/^[a-f0-9]{64}$/.test(handleDigest)) return undefined
    this.#sweep()
    return this.#records.get(handleDigest)?.ref
  }

  admitLogin(predecessor?: RecordRef): LoginAdmission | AuthOutcome {
    this.#sweep()
    if (predecessor && !this.#current(predecessor)) return reauth()
    if (this.#leases.size >= BFF_SESSION_LIMITS.records || this.#loginLeases.size >= BFF_SESSION_LIMITS.loginPending
      || this.#sequence >= Number.MAX_SAFE_INTEGER) return busy()
    const ref = privateObject({ kind: 'admitted' as const, sequence: ++this.#sequence })
    const lease = { live: true, inFlight: 0 }
    const admission: Admission = { ref, lease, predecessor, deadline: this.#clock.now() + BFF_SESSION_LIMITS.ownerMs,
      active: true, consumed: false }
    this.#leases.add(lease)
    this.#loginLeases.add(lease)
    this.#admissions.set(ref, admission)
    this.#activeAdmissions.add(admission)
    admission.timer = this.#clock.setTimeout(() => this.cancelLogin(ref), BFF_SESSION_LIMITS.ownerMs)
    return ref
  }
  cancelLogin(ref: LoginAdmission): void {
    const admission = this.#admissions.get(ref)
    if (!admission || !admission.active) return
    admission.active = false
    admission.lease.live = false
    this.#activeAdmissions.delete(admission)
    if (admission.timer) this.#clock.clearTimeout(admission.timer)
    admission.stop?.()
    this.#release(admission.lease)
  }

  /** Routes should use this owner, not dispatch create outside its reservation. */
  login(input: LoginInput, predecessor?: RecordRef): Promise<LoginPublication> {
    const ref = this.admitLogin(predecessor)
    if (ref.kind !== 'admitted') return Promise.resolve(ref)
    const admission = this.#admissions.get(ref)!
    const call = this.#call<unknown, LoginPublication>(admission.lease, admission.deadline,
      signal => this.#native.create(input, signal),
      value => this.publishLogin(ref, value),
      error => { admission.stop = undefined; this.cancelLogin(ref); return loginFailure(error) },
      value => { this.publishLogin(ref, value) },
    )
    admission.stop = () => call.stop(this.#clock.now() >= admission.deadline ? unavailable() : reauth())
    return call.promise
  }

  publishLogin(ref: LoginAdmission, value: unknown): LoginPublication {
    const admission = this.#admissions.get(ref)
    if (!admission || admission.consumed) return reauth()
    admission.consumed = true
    const now = this.#clock.now()
    try {
      if (!validEnvelope(value, now)) return unavailable()
      // A create response must identify a new native session. Never clean an
      // allegedly orphaned response that actually names a current record.
      if (this.#hasNativeSession(value.session_id)) return unavailable()
      if (!admission.active || now >= admission.deadline || ref.sequence <= this.#logoutFence
        || ref.sequence < this.#publishedSequence || (admission.predecessor && !this.#current(admission.predecessor))) {
        this.#cleanupEnvelope(value)
        return reauth()
      }
      const bytes = this.#random(32)
      if (bytes.length !== 32) { this.#cleanupEnvelope(value); return unavailable() }
      const handle = `swb1_${Buffer.from(bytes).toString('base64url')}`
      const digest = digestSessionHandle(handle)!
      if (this.#records.has(digest)) { this.#cleanupEnvelope(value); return unavailable() }
      const recordRef = privateObject({}) as RecordRef
      const record: SessionRecord = { ref: recordRef, digest, lease: admission.lease, phase: 'pending',
        metadata: metadata(value, 0), accessToken: value.access_token, refreshToken: value.refresh_token,
        pendingDeadline: now + BFF_SESSION_LIMITS.pendingMs, needsRefresh: false, authorityBusy: false,
        stops: new Set(), cleanup: 'unused' }
      // A successful replacement must not cancel its own publishing admission.
      this.#activeAdmissions.delete(admission)
      // Publish sequence is admission order, not completion order. Failed newer
      // passwords never advance it. All transitions here are synchronous.
      for (const old of this.#records.values()) if (old.phase === 'pending') this.#retire(old, true)
      if (admission.predecessor) {
        const old = this.#current(admission.predecessor)
        if (old) this.#retire(old, true)
      }
      this.#publishedSequence = ref.sequence
      this.#records.set(digest, record)
      this.#refs.set(recordRef, record)
      record.pendingTimer = this.#clock.setTimeout(() => {
        if (record.phase === 'pending') this.#retire(record, true)
      }, BFF_SESSION_LIMITS.pendingMs)
      // The admission lease becomes the record's lease, without a capacity gap.
      admission.active = false
      return privateObject({ kind: 'published', handle, record: recordRef, metadata: record.metadata })
    } catch {
      if (validEnvelope(value, now)) this.#cleanupEnvelope(value)
      return unavailable()
    } finally {
      this.#activeAdmissions.delete(admission)
      if (admission.timer) this.#clock.clearTimeout(admission.timer)
      if (admission.active || !this.#recordsHasLease(admission.lease)) {
        admission.active = false
        admission.lease.live = false
      }
      this.#release(admission.lease)
    }
  }
  #recordsHasLease(lease: Lease): boolean {
    for (const record of this.#records.values()) if (record.lease === lease) return true
    return false
  }
  #snapshot(record: SessionRecord): AccessSnapshot {
    return privateObject({ kind: 'access', record: record.ref, generation: record.metadata.generation,
      accessToken: record.accessToken!, apiSessionId: record.metadata.session_id,
      accessExpiresAt: record.metadata.access_expires_at, sessionExpiresAt: record.metadata.refresh_expires_at })
  }
  #local(record: SessionRecord): AuthOutcome | undefined {
    if (record.needsRefresh || this.#clock.now() >= dateMs(record.metadata.access_expires_at)) {
      return { kind: 'refresh-needed', metadata: record.metadata }
    }
    return undefined
  }
  snapshotForResource(handleDigest: string): AccessSnapshot | AuthOutcome {
    const ref = this.lookup(handleDigest)
    const record = ref && this.#current(ref)
    if (!record) return reauth()
    if (record.phase === 'pending') return { kind: 'pending', metadata: record.metadata }
    return this.#local(record) ?? this.#snapshot(record)
  }
  #recheck(snapshot: AccessSnapshot): SessionRecord | AuthOutcome {
    const record = this.#current(snapshot.record)
    if (!record) return reauth()
    if (record.metadata.generation !== snapshot.generation) return unavailable()
    return record
  }
  #probeResult(snapshot: AccessSnapshot, result: { ok: true } | { ok: false; code: string }): AuthOutcome {
    const current = this.#recheck(snapshot)
    if ('kind' in current) return current
    if (!result.ok) return this.observeAuthFailure(snapshot, result.code)
    const local = this.#local(current)
    if (local) return local
    if (current.phase === 'pending') {
      current.phase = 'active'
      if (current.pendingTimer) this.#clock.clearTimeout(current.pendingTimer)
      this.#loginLeases.delete(current.lease)
    }
    return { kind: 'confirmed', metadata: current.metadata }
  }
  #join(record: SessionRecord, flight: Flight): Promise<AuthOutcome> {
    if (flight.followers >= BFF_SESSION_LIMITS.refreshFollowers) return Promise.resolve(busy())
    flight.followers++
    return flight.promise.then(outcome => {
      flight.followers--
      const current = this.#current(record.ref)
      if (!current) return reauth()
      if ('metadata' in outcome) {
        if (outcome.metadata.generation !== current.metadata.generation) return unavailable()
        const local = this.#local(current)
        if (local) return local
      }
      return outcome
    })
  }
  confirmStatus(ref: RecordRef): Promise<AuthOutcome> {
    const record = this.#current(ref)
    if (!record) return Promise.resolve(reauth())
    const local = this.#local(record)
    if (local) return Promise.resolve(local)
    if (record.status) return this.#join(record, record.status)
    const snapshot = this.#snapshot(record)
    return this.#flight(record, 'status', signal => this.#native.probe(snapshot, signal),
      value => this.#probeResult(snapshot, value), () => unavailable())
  }
  refresh(ref: RecordRef): Promise<AuthOutcome> {
    const record = this.#current(ref)
    if (!record) return Promise.resolve(reauth())
    if (record.phase === 'pending') return Promise.resolve({ kind: 'pending', metadata: record.metadata })
    if (record.refresh) return this.#join(record, record.refresh)
    const snapshot = this.#snapshot(record)
    const now = this.#clock.now()
    const accessEnd = dateMs(snapshot.accessExpiresAt)
    const sessionEnd = dateMs(snapshot.sessionExpiresAt)
    if (!record.needsRefresh && now < accessEnd && (accessEnd >= sessionEnd || accessEnd - now > REFRESH_WINDOW_MS)) {
      return this.#flight(record, 'refresh', signal => this.#native.probe(snapshot, signal),
        value => this.#probeResult(snapshot, value), () => unavailable())
    }
    const refreshToken = record.refreshToken!
    return this.#flight(record, 'refresh',
      signal => this.#native.refresh({ session_id: snapshot.apiSessionId, refresh_token: refreshToken }, signal),
      value => {
        const current = this.#recheck(snapshot)
        if ('kind' in current) return current
        if (!validEnvelope(value, this.#clock.now()) || value.session_id !== snapshot.apiSessionId
          || value.refresh_expires_at !== snapshot.sessionExpiresAt || value.refresh_token === refreshToken
          || value.access_token === snapshot.accessToken) {
          this.#retire(current, false)
          return reauth()
        }
        current.accessToken = value.access_token
        current.refreshToken = value.refresh_token
        current.metadata = metadata(value, snapshot.generation + 1)
        current.needsRefresh = false
        return { kind: 'confirmed', metadata: current.metadata }
      },
      () => { this.#retire(record, false); return reauth() },
    )
  }
  observeAuthFailure(snapshot: AccessSnapshot, code: string, now = this.#clock.now()): AuthOutcome {
    const current = this.#recheck(snapshot)
    if ('kind' in current) return current
    if (code === 'ACCESS_EXPIRED' || (code === 'AUTH_REQUIRED' && now >= dateMs(snapshot.accessExpiresAt))) {
      current.needsRefresh = true
      return { kind: 'refresh-needed', metadata: current.metadata }
    }
    if (code === 'AUTH_REQUIRED') { this.#retire(current, false); return reauth() }
    return unavailable()
  }

  retireOwn(ref: RecordRef): void {
    const record = this.#current(ref)
    if (record) this.#retire(record, true)
  }
  #retire(record: SessionRecord, cleanup: boolean): void {
    if (record.phase === 'retired') return
    record.phase = 'retired'
    this.#records.delete(record.digest)
    record.lease.live = false
    if (record.pendingTimer) this.#clock.clearTimeout(record.pendingTimer)
    for (const admission of this.#activeAdmissions) {
      if (admission.predecessor === record.ref) this.cancelLogin(admission.ref)
    }
    for (const stop of record.stops) stop()
    if (cleanup) this.cleanupKnownRetired(record.ref, 'retirement')
    else record.cleanup = 'unconfirmed'
    record.accessToken = undefined
    record.refreshToken = undefined
    this.#release(record.lease)
  }
  cleanupKnownRetired(ref: RecordRef, reason: string): void {
    // Reasons are deliberately not retained in an unbounded audit/result log.
    void reason
    const record = this.#refs.get(ref)
    if (!record || record.phase !== 'retired' || record.cleanup !== 'unused') return
    record.cleanup = 'unconfirmed'
    if (record.accessToken) this.#cleanup(record.accessToken, record.metadata.session_id, record)
  }
  #hasNativeSession(sessionId: string): boolean {
    for (const record of this.#records.values()) if (record.metadata.session_id === sessionId) return true
    return false
  }
  #cleanupEnvelope(value: NativeEnvelope): void { this.#cleanup(value.access_token, value.session_id) }
  #cleanup(accessToken: string, sessionId: string, record?: SessionRecord): void {
    if (this.#hasNativeSession(sessionId) || this.#cleanupInFlight >= BFF_SESSION_LIMITS.cleanupCalls) return
    this.#cleanupInFlight++
    if (record) record.cleanup = 'pending'
    const lease = { live: false, inFlight: 0 }
    this.#call(lease, this.#clock.now() + BFF_SESSION_LIMITS.cleanupMs,
      signal => this.#native.revoke({ accessToken, sessionId }, signal),
      confirmed => { if (record) record.cleanup = confirmed === true ? 'confirmed' : 'unconfirmed' },
      () => { if (record) record.cleanup = 'unconfirmed' },
      undefined, () => { this.#cleanupInFlight-- },
    )
  }

  /** Fresh, unshared protected check. Resource snapshots are never authority. */
  validateAuthority(ref: RecordRef): Promise<AccessSnapshot | AuthOutcome> {
    const record = this.#current(ref)
    if (!record) return Promise.resolve(reauth())
    if (record.phase === 'pending') return Promise.resolve({ kind: 'pending', metadata: record.metadata })
    const local = this.#local(record)
    if (local) return Promise.resolve(local)
    if (record.authorityBusy) return Promise.resolve(busy())
    record.authorityBusy = true
    const snapshot = this.#snapshot(record)
    const deadline = this.#clock.now() + BFF_SESSION_LIMITS.ownerMs
    const call = this.#call(record.lease, deadline, signal => this.#native.probe(snapshot, signal), result => {
      const outcome = this.#probeResult(snapshot, result)
      if (outcome.kind !== 'confirmed') return outcome
      this.#proofs.set(snapshot, deadline)
      return snapshot
    }, () => unavailable(), undefined, () => { record.authorityBusy = false; record.stops.delete(stop) })
    const stop = () => call.stop(reauth())
    record.stops.add(stop)
    return call.promise
  }
  captureAuthorizedRevocation(proof: AccessSnapshot, target: string | 'all'): RevocationBoundary | AuthOutcome {
    const deadline = this.#proofs.get(proof)
    this.#proofs.delete(proof)
    if (deadline === undefined || this.#clock.now() >= deadline) return reauth()
    const current = this.#recheck(proof)
    if ('kind' in current) return current
    if (current.phase !== 'active' || this.#local(current)) return reauth()
    if (target !== 'all' && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(target)) return reauth()
    const records = [...this.#records.values()].filter(record => target === 'all' || record.metadata.session_id === target)
    const boundary = privateObject({ kind: 'captured' as const, target, admissionSequence: this.#sequence })
    this.#boundaries.set(boundary, records.map(record => record.ref))
    if (target === 'all') {
      this.#logoutFence = boundary.admissionSequence
      for (const admission of this.#activeAdmissions) {
        if (admission.ref.sequence <= boundary.admissionSequence) this.cancelLogin(admission.ref)
      }
    }
    // Native management remains the caller's separately acknowledged operation;
    // do not spend a second cleanup revoke on each already captured target.
    for (const record of records) this.#retire(record, false)
    return boundary
  }
  completeRevocation(boundary: RevocationBoundary, confirmed: boolean): { server_revocation: 'confirmed' | 'unconfirmed' } {
    const records = this.#boundaries.get(boundary)
    this.#boundaries.delete(boundary)
    if (!records) return { server_revocation: 'unconfirmed' }
    for (const ref of records) {
      const record = this.#refs.get(ref)
      if (record?.phase === 'retired') record.cleanup = confirmed ? 'confirmed' : 'unconfirmed'
    }
    return { server_revocation: confirmed ? 'confirmed' : 'unconfirmed' }
  }

  #flight<T>(record: SessionRecord, kind: 'status' | 'refresh', invoke: (signal: AbortSignal) => Promise<T>,
    transform: (value: T) => AuthOutcome, failure: () => AuthOutcome): Promise<AuthOutcome> {
    const call = this.#call(record.lease, this.#clock.now() + BFF_SESSION_LIMITS.ownerMs, invoke, transform, failure,
      undefined, () => { record[kind] = undefined; record.stops.delete(stop) })
    const stop = () => call.stop(reauth())
    record.stops.add(stop)
    record[kind] = { promise: call.promise, followers: 0 }
    return call.promise
  }

  /** Converts native output directly to metadata; never stores a native result. */
  #call<T, R>(lease: Lease, deadline: number, invoke: (signal: AbortSignal) => Promise<T>,
    transform: (value: T) => R, failure: (error?: unknown) => R, late?: (value: T) => void, settled?: () => void): Call<R> {
    lease.inFlight++
    const controller = new AbortController()
    let finished = false
    let resolve!: (value: R) => void
    const promise = new Promise<R>(yes => { resolve = yes })
    const finish = (value: R) => {
      if (finished) return
      finished = true
      this.#clock.clearTimeout(timer)
      resolve(value)
    }
    const stop = (value: R) => { finish(value); controller.abort() }
    const timer = this.#clock.setTimeout(() => stop(failure()), Math.max(0, deadline - this.#clock.now()))
    const done = () => { lease.inFlight--; this.#release(lease); settled?.() }
    let raw: Promise<T>
    try { raw = Promise.resolve(invoke(controller.signal)) }
    catch (error) { raw = Promise.reject(error) }
    void raw.then(value => {
      try {
        if (finished) { late?.(value); return }
        if (this.#clock.now() >= deadline) { stop(failure()); late?.(value); return }
        finish(transform(value))
      } catch (error) { finish(failure(error)) }
      finally { done() }
    }, error => {
      try { if (!finished) finish(failure(error)) }
      finally { done() }
    })
    return { promise, stop }
  }
}

/** Versioned process identity, shared across separately bundled Node handlers. */
export function getProcessBffSessionStore(options: BffSessionOptions): BffSessionStore {
  const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: { version: string; store: BffSessionStore } }
  const existing = host[REGISTRY_KEY]
  if (existing) {
    if (existing.version !== REGISTRY_VERSION) throw new Error('BFF registry version mismatch')
    return existing.store
  }
  const store = new BffSessionStore(options)
  Object.defineProperty(host, REGISTRY_KEY, { value: Object.freeze({ version: REGISTRY_VERSION, store }) })
  return store
}
