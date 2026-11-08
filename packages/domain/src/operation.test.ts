import { describe, expect, it } from 'vitest'
import { createOperation, reduceOperation } from './operation.js'
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
      op = reduceOperation(op, { type: 'unknown', attempt: 1 })
      expect(reduceOperation(op, { type: 'begin', context, sessionGeneration: 0 })).toBe(op)
      const retried = reduceOperation(op, { type: 'retry', context, sessionGeneration: 0 })
      expect(retried.state).toBe(serverIdempotency ? 'submitting' : 'unknown')
      expect(retried.operationKey).toBe('same-key')
    }
  })
  it('a receipt only binds and stop-waiting never claims remote cancellation', () => {
    let op = createOperation(context, 'k', { serverIdempotency: true, sessionGeneration: 0 })
    op = reduceOperation(op, { type: 'begin', context, sessionGeneration: 0 })
    op = reduceOperation(op, { type: 'accepted', attempt: 1, receipt: { job_id: 'j', turn_id: 't', state: 'succeeded' } })
    expect(op.state).toBe('accepted')
    expect(reduceOperation(op, { type: 'retry', context, sessionGeneration: 0 })).toBe(op)
    op = reduceOperation(op, { type: 'stop-waiting' }); expect(op.state).toBe('canceled_locally'); expect(op.remoteCanceled).toBe(false)
    expect(reduceOperation(op, { type: 'succeeded', attempt: 0 })).toBe(op)
  })
})

it('retains only declared operation metadata, not caller extensions', () => {
  const options = { serverIdempotency: false,sessionGeneration: 0,password:'excluded' }
  const op = createOperation(context,'k',options)
  expect(op).not.toHaveProperty('password')
})
