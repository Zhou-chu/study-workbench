import { describe, expect, it } from 'vitest'
import liveRecovery from './fixtures/live-turn-recovery.js'
import { createTurnRegistry, type TurnReceipt } from './turn-operations.js'
import { reconcileTurn } from './turn-reconciliation.js'
import { reconciliationFixture } from '../test/fixtures/turn-reconciliation.js'

const receipt: TurnReceipt = { jobId: 'parent:one', turnId: 'turn:one' }

function fixture() {
  const f = reconciliationFixture()
  const capture = f.capture
  const registry = createTurnRegistry(() => capture.operationId)
  const admitted = registry.admit({ sessionId: capture.sessionId, context: capture.context, owner: capture.owner, request: capture.dto })
  if (!admitted.ok) throw new Error('Fixture rejected')
  const ownedCapture = registry.getSnapshot(capture.dto.notebook_id)!.capture
  return { ...f, capture: ownedCapture, registry, token: admitted.token }
}
function match(f: ReturnType<typeof fixture>) { return reconcileTurn(f.capture, f.workspace, f.history) }

describe('turn reconciliation and registry settlement', () => {
  it('releases the sanitized live persisted turn alongside unrelated extraction history', () => {
    const live = structuredClone(liveRecovery)
    const parent = live.workspace.jobs.find(job => job.operation === 'chat')!
    const capture = { dto: parent.request_snapshot, sessionId: parent.chat_session_id } as unknown as Parameters<typeof reconcileTurn>[0]
    const result = reconcileTurn(capture, live.workspace, live.history, { jobId: parent.job_id, turnId: parent.turn_id! }, 'workspace-view-v1')
    expect(result.kind).toBe('complete')
    const registry = createTurnRegistry(() => parent.idempotency_key)
    const admitted = registry.admit({ sessionId: capture.sessionId, request: capture.dto, owner: { mountId: 'live-test' }, context: { epoch: 1, ready: true, target: { mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null } } })
    if (!admitted.ok) throw Error('Invalid fixture admission')
    registry.settlePost(admitted.token, { kind: 'bound', jobId: parent.job_id, turnId: parent.turn_id!, state: 'unknown', dispatchUnknown: false })
    const check = registry.beginCheck(parent.idempotency_key)!
    registry.settleCheck(check, result)
    registry.releaseCompleted(parent.idempotency_key)
    expect(registry.getSnapshot(parent.notebook_id)).toBeNull()
    live.workspace.jobs.push({ ...parent, projection_status: 'unknown' } as typeof parent)
    expect(reconcileTurn(capture, live.workspace, live.history, { jobId: parent.job_id, turnId: parent.turn_id! }, 'workspace-view-v1').kind).not.toBe('complete')
  })
  it.each(['queued', 'running', 'failed', 'needs_reauth', 'cancelled_local', 'future', 'succeeded'])('binds a verified %s parent with no canonical turn, making recovery check-only', state => {
    const f = fixture(); f.parent.state = state; f.history = []
    const result = match(f)
    expect(result).toMatchObject({ kind: 'bound', ...receipt, state: ['future', 'succeeded'].includes(state) ? 'unknown' : state })
    f.registry.settlePost(f.token, { kind: 'unknown', reason: 'transport' })
    const check = f.registry.beginCheck(f.token.operationId)!
    f.registry.settleCheck(check, result)
    expect(f.registry.getSnapshot(f.token.notebookId)?.receipt).toEqual(receipt)
    expect(f.registry.beginRetry(f.token.operationId)).toBeNull()
  })
})
