import { describe, expect, it } from 'vitest'
import { fixture, receipt, match } from '@/test/turn-reconciliation-fixture'

describe('read-only turn reconciliation', () => {
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
