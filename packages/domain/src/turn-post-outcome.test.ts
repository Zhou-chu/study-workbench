import { describe, expect, it } from 'vitest'
import { readTurnPostOutcome } from './turn-reconciliation.js'

const receipt = { jobId: 'parent:one', turnId: 'turn:one' }

describe('safe POST outcome projection', () => {
  const body = { job_id: receipt.jobId, turn_id: receipt.turnId, state: 'queued' }
  const evidence = { dispatch_ack: 'unknown', job_id: receipt.jobId, turn_id: receipt.turnId, retry_safe: false }
  it('accepts absent optional receipt and only binds IDs, even for succeeded/future state', () => {
    for (const state of ['queued', 'succeeded', 'future', null]) expect(readTurnPostOutcome(200, { ...body, state })).toEqual({ kind: 'bound', ...receipt, state: ['queued', 'succeeded'].includes(state as string) ? state : 'unknown', dispatchUnknown: false })
  })
  it('recognizes only the fixed HTTP 400 WORKER_UNAVAILABLE sibling receipt', () => {
    expect(readTurnPostOutcome(400, { detail: 'WORKER_UNAVAILABLE', dispatch_receipt: evidence })).toEqual({ kind: 'bound', ...receipt, state: 'unknown', dispatchUnknown: true })
    for (const status of [401, 403, 409, 500]) expect(readTurnPostOutcome(status, { detail: 'WORKER_UNAVAILABLE', dispatch_receipt: evidence }).kind).toBe('unknown')
    expect(readTurnPostOutcome(400, { detail: 'Other', dispatch_receipt: evidence }).kind).toBe('unknown')
  })
  it('validates receipt consistency on a successful response', () => {
    expect(readTurnPostOutcome(202, { ...body, dispatch_receipt: evidence })).toEqual({ kind: 'bound', ...receipt, state: 'queued', dispatchUnknown: true })
    expect(readTurnPostOutcome(200, body, { jobId: 'other', turnId: receipt.turnId })).toEqual({ kind: 'unknown', reason: 'conflict' })
  })
  it.each([null, false, {}, { ...evidence, retry_safe: true }, { ...evidence, dispatch_ack: 'future' }, { ...evidence, job_id: 'other' }, { ...evidence, turn_id: null }, { ...evidence, future: true }])('treats present malformed/future receipt %j as inconclusive, unlike absence', dispatch_receipt => {
    expect(readTurnPostOutcome(200, { ...body, dispatch_receipt })).toEqual({ kind: 'unknown', reason: 'receipt' })
  })
  it.each([null, {}, { ...body, job_id: '' }, { ...body, turn_id: 4 }])('rejects missing/malformed top IDs %j', value => {
    expect(readTurnPostOutcome(200, value)).toEqual({ kind: 'unknown', reason: 'receipt' })
  })
  it('projects only safe fields and does not retain body/error/answer content', () => {
    const value = { ...body, answer: 'PRIVATE', error: { message: 'SECRET' }, request_snapshot: { password: 'SECRET' } }
    expect(readTurnPostOutcome(200, value)).toEqual({ kind: 'bound', ...receipt, state: 'queued', dispatchUnknown: false })
  })
})
