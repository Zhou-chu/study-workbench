import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateTurnContext, publishTurnTarget, readTurnContext, subscribeTurnContext, suspendTurnTarget } from './dispatch-context.js'
const a = { mode: 'device_sessions' as const, apiBase: 'http://localhost:3000/api', protocol: 'bff-memory-v1' }
const b = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
beforeEach(() => { invalidateTurnContext() })
describe('non-secret document turn context', () => {
  it('notifies invalidation synchronously even before discovering a target', () => {
    expect(readTurnContext()).toBeNull()
    const listener = vi.fn(); const unsubscribe = subscribeTurnContext(listener)
    invalidateTurnContext(); expect(listener).toHaveBeenCalledTimes(1); expect(readTurnContext()).toBeNull(); unsubscribe()
  })
  it('keeps identity through readiness changes, but not A to B to A', () => {
    publishTurnTarget(a, true); const first = readTurnContext()!
    suspendTurnTarget(); expect(readTurnContext()).toEqual({ ...first, ready: false })
    publishTurnTarget({ ...a }, true); expect(readTurnContext()).toEqual(first)
    publishTurnTarget(b, false); const second = readTurnContext()!
    expect(second.epoch).toBeGreaterThan(first.epoch); expect(second.ready).toBe(false)
    publishTurnTarget(a, true); expect(readTurnContext()!.epoch).toBeGreaterThan(second.epoch)
  })
  it('notifies synchronously on invalidation and only stores frozen scalars', () => {
    const listener = vi.fn(); const unsubscribe = subscribeTurnContext(listener)
    publishTurnTarget(a, true); const first = readTurnContext()!
    expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.target)).toBe(true)
    invalidateTurnContext(); expect(listener).toHaveBeenCalled(); expect(readTurnContext()!.epoch).toBeGreaterThan(first.epoch)
    const calls = listener.mock.calls.length; unsubscribe(); invalidateTurnContext(); expect(listener).toHaveBeenCalledTimes(calls)
    expect(Object.keys(readTurnContext()!).sort()).toEqual(['epoch', 'ready', 'target'])
  })
})
