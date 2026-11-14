import liveRecovery from '../../domain/src/fixtures/live-turn-recovery.js'
import { expect, it, vi } from 'vitest'
import { createTurnRegistry } from '@study/domain'
import { checkTurnRecovery } from './recovery.js'
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function fixture() {
  const registry = createTurnRegistry(() => 'key'); registry.admit({ sessionId: 'chat:one', owner: { mountId: 'm' }, context: { epoch: 1, ready: true, target: { mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null } }, request: { notebook_id: 'notebook:one', engine: 'independent', task: 'question', message: 'Q', selection_origin: 'local', source_version_ids: ['v'], remote_source_ids: [] } })
  const capture = registry.getSnapshot('notebook:one')!.capture
  const turn = { turn_id: 't', notebook_id: 'notebook:one', chat_session_id: 'chat:one', engine: 'independent', message: 'Q', idempotency_key: 'key', status: 'succeeded', answer: 'A', scope_snapshot: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v'], remote_source_ids: [], remote_notebook_id: null }, citations: [] }
  const parent = { operation: 'chat', job_id: 'j', turn_id: 't', notebook_id: 'notebook:one', chat_session_id: 'chat:one', idempotency_key: 'key', state: 'succeeded', submission_state: 'confirmed', request_snapshot: { ...capture.dto }, result: structuredClone(turn) }
  const workspace = { schema_version: 'workspace-view-v1', notebook: { id: 'notebook:one' }, sources: [], notes: [], turns: [turn], jobs: [parent], selection: null, link: null, legacy_history: [] }
  return { capture, turn, parent, workspace }
}
it('requires canonical history through only two explicit read endpoints, never generic job GET', async () => {
  const f = fixture(); const send = vi.fn().mockResolvedValueOnce(json(f.workspace)).mockResolvedValueOnce(json([f.turn]))
  expect((await checkTurnRecovery({ send }, f.capture)).kind).toBe('complete')
  expect(send.mock.calls.map(([r]) => [r.method,r.path])).toEqual([['GET','/personal/notebooks/notebook%3Aone/workspace-view'],['GET','/personal/chats/chat%3Aone/turns']])
  send.mockResolvedValueOnce(json(f.workspace)).mockResolvedValueOnce(json([]))
  expect(await checkTurnRecovery({ send }, f.capture)).toMatchObject({ kind: 'bound', reason: 'answer-unavailable' })
})
it.each(['unknown request','marker','restored','null receipt','future receipt','scope mismatch','retrieval mismatch','adjacent malformed'])('retains non-actionable %s evidence through the contracts adapters', async variant => {
  const f = fixture(); const history: unknown[] = [f.turn]
  if (variant === 'unknown request') Object.assign(f.parent.request_snapshot, { future: 'no stripping' })
  if (variant === 'marker') Object.assign(f.parent, { projection_status: 'unknown' })
  if (variant === 'restored') Object.assign(f.parent, { restored_history: true, replay_allowed: false })
  if (variant === 'null receipt') Object.assign(f.parent, { dispatch_receipt: null })
  if (variant === 'future receipt') Object.assign(f.parent, { dispatch_receipt: { validity: 'valid', receipt: { dispatch_ack: 'unknown', job_id: 'j', turn_id: 't', retry_safe: false, extra: 'bad' } } })
  if (variant === 'scope mismatch') f.parent.result.scope_snapshot.source_version_ids.reverse(), f.parent.result.scope_snapshot.source_version_ids.push('other')
  if (variant === 'retrieval mismatch') Object.assign(f.parent.result, { retrieval: { retrieval_method: 'other' } })
  if (variant === 'adjacent malformed') history.push(null)
  const send = vi.fn().mockResolvedValueOnce(json(f.workspace)).mockResolvedValueOnce(json(history))
  expect((await checkTurnRecovery({ send }, f.capture)).kind).not.toBe('complete'); expect(send).toHaveBeenCalledTimes(2)
})
it('accepts an exact projected receipt for check-only binding, not body-inferred legacy evidence', async () => {
  const f = fixture(); Object.assign(f.parent, { state: 'submission_unknown', dispatch_receipt: { validity: 'valid', receipt: { dispatch_ack: 'unknown', job_id: 'j', turn_id: 't', retry_safe: false } } })
  const send = vi.fn().mockResolvedValueOnce(json(f.workspace)).mockResolvedValueOnce(json([f.turn]))
  expect(await checkTurnRecovery({ send }, f.capture)).toEqual({ kind: 'bound', jobId: 'j', turnId: 't', state: 'submission_unknown' })
})

it.each(['success', 'root marker', 'duplicate parent', 'unknown job', 'missing receipt'])('handles actual projected extraction history without erasing %s', async variant => {
  const live = structuredClone(liveRecovery)
  const parent = live.workspace.jobs.find(j => j.operation === 'chat')!
  const capture = { dto: parent.request_snapshot, sessionId: parent.chat_session_id } as unknown as Parameters<typeof checkTurnRecovery>[1]
  if (variant === 'root marker') Object.assign(live.workspace, { projection_status: 'unknown' })
  if (variant === 'duplicate parent') live.workspace.jobs.push({ ...parent, projection_status: 'unknown' } as typeof parent)
  if (variant === 'unknown job') Object.assign(live.workspace.jobs[0]!, { operation: 'future' })
  const send = vi.fn().mockResolvedValueOnce(json(live.workspace)).mockResolvedValueOnce(json(live.history))
  const receipt = variant === 'missing receipt' ? undefined : { jobId: parent.job_id, turnId: parent.turn_id! }
  expect((await checkTurnRecovery({ send }, capture, receipt)).kind === 'complete').toBe(variant === 'success' || variant === 'missing receipt')
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls.every(([spec]) => spec.method === 'GET')).toBe(true)
})
