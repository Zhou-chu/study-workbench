import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTurnRegistry, MAX_CAPTURE_BYTES, MAX_PENDING_NOTEBOOKS, type AttemptToken, type TurnRegistry, type ValidatedTurnCapture } from './turn-operations'

const uuid = '00000000-0000-4000-8000-000000000000'
function input(notebook = 'notebook:one'): { -readonly [K in keyof ValidatedTurnCapture]: ValidatedTurnCapture[K] } {
  return {
    sessionId: 'chat:one', context: { epoch: 3, ready: true, target: { mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null } },
    owner: { mountId: 'mount:one', questionRevision: 2, editor: { session: 1, revision: 4 } },
    request: { notebook_id: notebook, task: 'question', engine: 'independent', selection_origin: 'local', source_version_ids: ['version:z', 'version:a'], remote_source_ids: [], message: 'Question 😀' },
  }
}
function admit(registry: TurnRegistry, value = input()): AttemptToken {
  const result = registry.admit(value)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Admission rejected')
  return result.token
}
afterEach(() => vi.restoreAllMocks())

describe('bounded document turn registry', () => {
  it.each([['question', 'question'], ['outline', 'outline'], ['question', 'outline'], ['outline', 'question']] as const)('synchronously fences %s then %s', (first, second) => {
    const registry = createTurnRegistry(); const value = input()
    value.request = { ...value.request, task: first }; const token = admit(registry, value)
    expect(registry.admit({ ...value, request: { ...value.request, task: second } })).toEqual({ ok: false, reason: 'busy' })
    expect(registry.getSnapshot(value.request.notebook_id)).toMatchObject({ token, phase: 'posting', busy: 'post', postAttempts: 1 })
  })
  it('copies and freezes only allowlisted capture fields without normalizing the emitted DTO', () => {
    const registry = createTurnRegistry(); const value = input()
    Object.assign(value, { credentials: 'secret', callback: () => undefined, answer: 'not retained' })
    Object.assign(value.request, { reading: { page_index: 7 }, password: 'secret' })
    Object.assign(value.context.target, { credential: 'secret' }); Object.assign(value.owner, { node: document.body })
    const token = admit(registry, value); const capture = registry.getSnapshot(token.notebookId)!.capture
    value.request.source_version_ids.reverse(); value.request.message = 'new question'; Object.assign(value.owner.editor!, { revision: 100 })
    expect(capture.dto.source_version_ids).toEqual(['version:z', 'version:a'])
    expect(capture.dto.message).toBe('Question 😀'); expect(capture.owner.editor!.revision).toBe(4)
    expect(capture.dto).not.toHaveProperty('remote_notebook_id'); expect(capture.dto).not.toHaveProperty('model_id')
    expect(capture.dto.idempotency_key).toBe(capture.operationId)
    expect(Object.keys(capture).sort()).toEqual(['bytes', 'context', 'dto', 'operationId', 'owner', 'sessionId'])
    expect(Object.keys(capture.dto).sort()).toEqual(['engine', 'idempotency_key', 'message', 'notebook_id', 'remote_source_ids', 'selection_origin', 'source_version_ids', 'task'])
    expect(Object.keys(capture.context.target).sort()).toEqual(['apiBase', 'mode', 'protocol'])
    expect(Object.keys(capture.owner).sort()).toEqual(['editor', 'mountId', 'questionRevision'])
    for (const object of [capture, capture.context, capture.context.target, capture.owner, capture.owner.editor, capture.dto, capture.dto.source_version_ids, capture.dto.remote_source_ids]) expect(Object.isFrozen(object)).toBe(true)
    expect(capture.bytes).toBe(new TextEncoder().encode(JSON.stringify(capture.dto)).byteLength)
  })
  it('fails closed when the browser cannot allocate an operation UUID', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Unavailable') })
    const registry = createTurnRegistry()
    expect(registry.admit(input())).toEqual({ ok: false, reason: 'unavailable' })
    expect(registry.getSnapshot('notebook:one')).toBeNull()
  })
  it('preserves explicit null and original scope duplicates/order', () => {
    const registry = createTurnRegistry(); const value = input(); value.request.remote_notebook_id = null; value.request.source_version_ids = ['z', 'z', 'a']
    const token = admit(registry, value)
    expect(registry.getSnapshot(token.notebookId)!.capture.dto).toMatchObject({ remote_notebook_id: null, source_version_ids: ['z', 'z', 'a'] })
  })
  it('retains eight unresolved notebooks and rejects the ninth without eviction', () => {
    const registry = createTurnRegistry(); const tokens = Array.from({ length: 8 }, (_, index) => admit(registry, input(`notebook:${index}`)))
    expect(MAX_PENDING_NOTEBOOKS).toBe(8); expect(registry.admit(input('notebook:ninth'))).toEqual({ ok: false, reason: 'capacity' })
    tokens.forEach(token => expect(registry.getSnapshot(token.notebookId)?.token).toBe(token))
  })
  it('enforces the exact aggregate UTF-8 JSON byte boundary without an invented ID length limit', () => {
    let sequence = 0; vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `${uuid.slice(0, -3)}${String(sequence++).padStart(3, '0')}` as typeof uuid)
    const registry = createTurnRegistry(); const first = input('one'); first.request.message = '😀'.repeat(50000)
    admit(registry, first); const bytes = registry.getSnapshot('one')!.capture.bytes
    const second = input('two'); second.request.source_version_ids = ['x']
    const probe = createTurnRegistry(); admit(probe, second); const overhead = probe.getSnapshot('two')!.capture.bytes - 1
    second.request.source_version_ids = ['x'.repeat(MAX_CAPTURE_BYTES - bytes - overhead)]
    admit(registry, second)
    expect(bytes + registry.getSnapshot('two')!.capture.bytes).toBe(1_048_576)
    expect(registry.admit(input('three'))).toEqual({ ok: false, reason: 'size' })
    const over = createTurnRegistry(); second.request.source_version_ids[0] += 'x'.repeat(bytes + 1)
    expect(over.admit(second)).toEqual({ ok: false, reason: 'size' })
  })
  it.each([
    ['empty message', { message: '' }], ['whitespace message', { message: '  ' }], ['long message', { message: '😀'.repeat(50001) }],
    ['future engine', { engine: 'future' }], ['future task', { task: 'future' }], ['future origin', { selection_origin: 'future' }],
    ['no scope', { source_version_ids: [] }], ['too many IDs', { source_version_ids: Array(21).fill('v') }],
    ['sparse IDs', { source_version_ids: Array(1) }], ['invalid IDs', { source_version_ids: [3] }], ['empty ID', { source_version_ids: [''] }],
    ['mixed scope', { remote_source_ids: ['remote'] }], ['independent remote', { selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['r'] }],
    ['missing Google notebook', { engine: 'notebooklm' }], ['invalid notebook', { notebook_id: null }],
  ])('revalidates %s', (_, patch) => {
    const registry = createTurnRegistry(); const value = input(); Object.assign(value.request, patch)
    expect(registry.admit(value)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('accepts Google remote scope and retains only the optional connection ID', () => {
    const registry = createTurnRegistry(); const value = input(); value.googleConnectionId = 'connection:one'
    value.request = { ...value.request, engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['r'], remote_notebook_id: 'remote:one' }
    const token = admit(registry, value); expect(registry.getSnapshot(token.notebookId)!.capture.googleConnectionId).toBe('connection:one')
  })
  it('rejects malformed owner/context and unavailable context', () => {
    for (const patch of [{ sessionId: '' }, { owner: { mountId: '' } }, { owner: { mountId: 'm', questionRevision: -1 } }, { context: null }]) {
      expect(createTurnRegistry().admit({ ...input(), ...patch } as ValidatedTurnCapture)).toEqual({ ok: false, reason: 'invalid' })
    }
    const value = input(); value.context = { ...value.context, ready: false }
    expect(createTurnRegistry().admit(value)).toEqual({ ok: false, reason: 'unavailable' })
  })
  it('uses a synchronous shared retry/check latch and monotonic action numbers separate from POST count', () => {
    const registry = createTurnRegistry(); const token = admit(registry)
    expect(registry.beginRetry(token.operationId)).toBeNull(); expect(registry.beginCheck(token.operationId)).toBeNull()
    registry.settlePost(token, { kind: 'unknown', reason: 'transport' })
    const check = registry.beginCheck(token.operationId)!
    expect(check.attempt).toBe(2); expect(registry.beginCheck(token.operationId)).toBeNull(); expect(registry.beginRetry(token.operationId)).toBeNull()
    registry.settleCheck(check, { kind: 'unknown', reason: 'not-found' })
    const retry = registry.beginRetry(token.operationId)!
    expect(retry.attempt).toBe(3); expect(registry.getSnapshot(token.notebookId)!.postAttempts).toBe(2)
    expect(registry.beginRetry(token.operationId)).toBeNull(); expect(registry.beginCheck(token.operationId)).toBeNull()
    registry.settlePost(token, { kind: 'bound', jobId: 'stale', turnId: 'stale', state: 'succeeded', dispatchUnknown: false })
    expect(registry.getSnapshot(token.notebookId)!.token).toBe(retry)
    expect(registry.getSnapshot(token.notebookId)!.receipt).toBeUndefined()
  })
  it('only abandons a first-and-only locally unsent POST, including after a read-only check', () => {
    const registry = createTurnRegistry(); const token = admit(registry)
    expect(registry.abandonNotSent(token.operationId)).toBe(false)
    registry.settlePost(token, { kind: 'not-dispatched' })
    const check = registry.beginCheck(token.operationId)!; expect(registry.abandonNotSent(token.operationId)).toBe(false)
    registry.settleCheck(check, { kind: 'unknown', reason: 'not-found' })
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ phase: 'not-sent', everPossiblyDispatched: false, postAttempts: 1 })
    expect(registry.abandonNotSent(token.operationId)).toBe(true); expect(registry.getSnapshot(token.notebookId)).toBeNull()
  })
  it('never downgrades uncertainty after a later locally unsent POST', () => {
    const registry = createTurnRegistry(); const token = admit(registry)
    registry.settlePost(token, { kind: 'unknown', reason: 'transport' }); const retry = registry.beginRetry(token.operationId)!
    registry.settlePost(retry, { kind: 'not-dispatched' })
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ phase: 'unknown', everPossiblyDispatched: true, postAttempts: 2 })
    expect(registry.abandonNotSent(token.operationId)).toBe(false)
  })
  it('a second unsent POST also cannot be abandoned', () => {
    const registry = createTurnRegistry(); const token = admit(registry); registry.settlePost(token, { kind: 'not-dispatched' })
    const retry = registry.beginRetry(token.operationId)!; registry.settlePost(retry, { kind: 'not-dispatched' })
    expect(registry.abandonNotSent(token.operationId)).toBe(false)
  })
  it.each(['queued', 'running', 'waiting_remote', 'succeeded', 'failed', 'needs_reauth', 'submission_unknown', 'cancelled_local', 'unknown'] as const)('keeps %s receipt bound and check-only without inferring completion', state => {
    const registry = createTurnRegistry(); const token = admit(registry)
    registry.settlePost(token, { kind: 'bound', jobId: 'parent', turnId: 'turn', state, dispatchUnknown: true })
    registry.releaseCompleted(token.operationId)
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ phase: 'bound', receipt: { jobId: 'parent', turnId: 'turn' }, observedState: state, everPossiblyDispatched: true })
    expect(registry.beginRetry(token.operationId)).toBeNull(); expect(registry.abandonNotSent(token.operationId)).toBe(false)
  })
  it('preserves receipt IDs on conflicting read evidence', () => {
    const registry = createTurnRegistry(); const token = admit(registry)
    registry.settlePost(token, { kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'queued', dispatchUnknown: false })
    const check = registry.beginCheck(token.operationId)!; registry.settleCheck(check, { kind: 'bound', jobId: 'other', turnId: 'turn', state: 'succeeded' })
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ phase: 'unknown', reason: 'mismatch', receipt: { jobId: 'parent', turnId: 'turn' } })
    expect(registry.beginRetry(token.operationId)).toBeNull()
  })
  it('completion retains only safe metadata until explicit release and frees the byte/slot budget', () => {
    const registry = createTurnRegistry(); const token = admit(registry); registry.settlePost(token, { kind: 'unknown', reason: 'receipt' })
    const check = registry.beginCheck(token.operationId)!
    registry.settleCheck(check, { kind: 'complete', jobId: 'parent', turnId: 'turn', turn: { turn_id: 'turn', engine: 'independent', message: 'question', answer: 'PRIVATE ANSWER', citations: [], scope_snapshot: { source_version_ids: [] } } })
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ phase: 'complete', observedState: 'succeeded' })
    expect(JSON.stringify(registry.getSnapshot(token.notebookId))).not.toContain('PRIVATE ANSWER')
    expect(registry.beginRetry(token.operationId)).toBeNull(); expect(registry.beginCheck(token.operationId)).toBeNull()
    registry.releaseCompleted(token.operationId); expect(registry.getSnapshot(token.notebookId)).toBeNull()
    const next = admit(registry); registry.settleCheck(check, { kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'succeeded' })
    expect(registry.getSnapshot(token.notebookId)!.token).toBe(next)
  })
  it('rejects wrong action kinds, operation, epoch and attempt without changing stable snapshots', () => {
    const registry = createTurnRegistry(); const token = admit(registry); const original = registry.getSnapshot(token.notebookId)
    registry.settleCheck(token, { kind: 'unknown', reason: 'not-found' })
    for (const patch of [{ epoch: 4 }, { operationId: 'old' }, { attempt: 2 }, { notebookId: 'other' }]) registry.settlePost({ ...token, ...patch }, { kind: 'not-dispatched' })
    expect(registry.getSnapshot(token.notebookId)).toBe(original)
  })
  it('never retains an arbitrary reason string from a structurally forged safe match', () => {
    const registry = createTurnRegistry(); const token = admit(registry); registry.settlePost(token, { kind: 'unknown', reason: 'transport' })
    const check = registry.beginCheck(token.operationId)!
    registry.settleCheck(check, { kind: 'unknown', reason: 'RAW PRIVATE ERROR' } as never)
    expect(registry.getSnapshot(token.notebookId)?.reason).toBe('malformed')
    expect(JSON.stringify(registry.getSnapshot(token.notebookId))).not.toContain('RAW PRIVATE ERROR')
  })
  it('retains existing receipt IDs through an inconclusive check without enabling retry', () => {
    const registry = createTurnRegistry(); const token = admit(registry)
    registry.settlePost(token, { kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'queued', dispatchUnknown: false })
    const check = registry.beginCheck(token.operationId)!
    registry.settleCheck(check, { kind: 'unknown', reason: 'malformed' })
    expect(registry.getSnapshot(token.notebookId)?.receipt).toEqual({ jobId: 'parent', turnId: 'turn' })
    expect(registry.beginRetry(token.operationId)).toBeNull()
  })
  it('invalidates synchronously, drops payload references and never revives stale promises', () => {
    const registry = createTurnRegistry(); const listener = vi.fn(); const unsubscribe = registry.subscribe(listener); const token = admit(registry)
    registry.invalidate(); expect(registry.getSnapshot(token.notebookId)).toBeNull(); expect(listener).toHaveBeenCalledTimes(2)
    registry.settlePost(token, { kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'queued', dispatchUnknown: false })
    expect(registry.getSnapshot(token.notebookId)).toBeNull(); expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe(); admit(registry); expect(listener).toHaveBeenCalledTimes(2)
  })
})
