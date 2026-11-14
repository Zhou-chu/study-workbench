import { describe, expect, it } from 'vitest'
import { createOperation, reduceOperation, type OperationEvent } from './operation.js'
const context = { epoch: 1, ready: true, target: { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null } }
describe('generic operation reduction', () => {
  it('captures a frozen target and synchronously rejects duplicate begin', () => {
    const initial = createOperation(context, 'local-1', { serverIdempotency: false, sessionGeneration: 3 })
    const active = reduceOperation(initial, { type: 'begin', context, sessionGeneration: 3 })
    expect(active.state).toBe('submitting'); expect(active.attempt).toBe(1)
    expect(reduceOperation(active, { type: 'begin', context, sessionGeneration: 3 })).toBe(active)
    expect(Object.isFrozen(active.context.target)).toBe(true)
  })
  it('rejects an A to B to A capture and independently checks session generation', () => {
    const initial = createOperation(context, 'key', { serverIdempotency: true, sessionGeneration: 3 })
    expect(reduceOperation(initial, { type: 'begin', context: { ...context, epoch: 3 }, sessionGeneration: 3 })).toBe(initial)
    expect(reduceOperation(initial, { type: 'begin', context, sessionGeneration: 4 })).toBe(initial)
  })
  it('unknown creates are check-only, while explicit same-key retries require no receipt', () => {
    for (const serverIdempotency of [false, true]) {
      let op = createOperation(context, 'same-key', { serverIdempotency, sessionGeneration: 0 })
      op = reduceOperation(op, { type: 'begin', context, sessionGeneration: 0 })
      op = reduceOperation(op, { type: 'unknown', token: op.token! })
      expect(reduceOperation(op, { type: 'begin', context, sessionGeneration: 0 })).toBe(op)
      const retried = reduceOperation(op, { type: 'retry', context, sessionGeneration: 0 })
      expect(retried.state).toBe(serverIdempotency ? 'submitting' : 'unknown')
      expect(retried.operationKey).toBe('same-key')
    }
  })
  it('a receipt only binds and stop-waiting never claims remote cancellation', () => {
    let op = createOperation(context, 'k', { serverIdempotency: true, sessionGeneration: 0 })
    op = reduceOperation(op, { type: 'begin', context, sessionGeneration: 0 })
    op = reduceOperation(op, { type: 'accepted', token: op.token!, receipt: { job_id: 'j', turn_id: 't', state: 'succeeded' } })
    expect(op.state).toBe('accepted')
    expect(reduceOperation(op, { type: 'retry', context, sessionGeneration: 0 })).toBe(op)
    op = reduceOperation(op, { type: 'stop-waiting' }); expect(op.state).toBe('canceled_locally'); expect(op.remoteCanceled).toBe(false)
    expect(reduceOperation(op, { type: 'succeeded', token: { ...op.token!, attempt: 0 } })).toBe(op)
  })
})

it('retains only declared operation metadata, not caller extensions', () => {
  const options = { serverIdempotency: false,sessionGeneration: 0,password:'excluded' }
  const op = createOperation(context,'k',options)
  expect(op).not.toHaveProperty('password')
})

function submitting(key = 'old', captured = context, sessionGeneration = 3) {
  return reduceOperation(createOperation(captured, key, { serverIdempotency: true, sessionGeneration }), { type: 'begin', context: captured, sessionGeneration })
}
it.each(['accepted', 'succeeded'] as const)('cannot apply a late %s from another attempt-1 operation', type => {
  const old = submitting()
  const current = submitting('new', { ...context, epoch: 2 }, 4)
  const token = Object.freeze({ operationKey: old.operationKey, context: old.context, sessionGeneration: old.sessionGeneration, attempt: old.attempt })
  const late = { type, attempt: old.attempt, token, receipt: { job_id: 'old-job' } } as OperationEvent
  expect(reduceOperation(current, late)).toBe(current)
  expect(current.receipt).toBeNull(); expect(current.state).toBe('submitting')
})
it.each(['key', 'epoch', 'mode', 'apiBase', 'protocol', 'ready', 'generation', 'attempt'] as const)('checks the settlement token %s independently', field => {
  const current = submitting('same-key')
  const token = Object.freeze({
    operationKey: field === 'key' ? 'other-key' : current.operationKey,
    context: Object.freeze({ ...current.context, epoch: field === 'epoch' ? 0 : current.context.epoch, ready: field === 'ready' ? false : current.context.ready, target: Object.freeze({
      ...current.context.target, mode: field === 'mode' ? 'device_sessions' as const : current.context.target.mode,
      apiBase: field === 'apiBase' ? 'https://other.example/api' : current.context.target.apiBase, protocol: field === 'protocol' ? 'bff-memory-v1' : current.context.target.protocol,
    }) }),
    sessionGeneration: field === 'generation' ? 2 : current.sessionGeneration,
    attempt: field === 'attempt' ? 0 : current.attempt,
  })
  const late = { type: 'accepted' as const, attempt: current.attempt, token, receipt: { job_id: 'wrong-job' } }
  expect(reduceOperation(current, late)).toBe(current)
})
it('does not accept legacy attempt-only settlement events', () => {
  const current = submitting()
  expect(reduceOperation(current, { type: 'succeeded', attempt: 1 } as unknown as OperationEvent)).toBe(current)
})
it('publishes an immutable attempt token and accepts its own settlement', () => {
  const active = submitting('current')
  expect(active.token).toEqual({ operationKey: 'current', context, sessionGeneration: 3, attempt: 1 })
  expect(Object.isFrozen(active.token)).toBe(true); expect(Object.isFrozen(active.token!.context)).toBe(true); expect(Object.isFrozen(active.token!.context.target)).toBe(true)
  const accepted = reduceOperation(active, { type: 'accepted', token: active.token!, receipt: { job_id: 'current-job' } })
  expect(accepted.receipt?.job_id).toBe('current-job')
  expect(reduceOperation(accepted, { type: 'succeeded', token: active.token! }).state).toBe('succeeded')
})
