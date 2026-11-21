import { isRecord, parseDispatchReceipt } from './workspace-view.js'

/** Generic local handle only, not completion evidence or a replay authority. */
export interface OperationReceipt { job_id: string; turn_id?: string; state?: string }
export type OperationState = 'idle' | 'submitting' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'canceled_locally'
export interface TurnReceipt { jobId: string; turnId: string }
export type ObservedTurnState = 'queued' | 'running' | 'waiting_remote' | 'succeeded' | 'failed' | 'needs_reauth' | 'submission_unknown' | 'cancelled_local' | 'unknown'
export type SafeTurnPostOutcome = ({ kind: 'bound'; state: ObservedTurnState; dispatchUnknown: boolean } & TurnReceipt) | { kind: 'unknown'; reason: 'receipt' | 'transport' | 'conflict' }
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim() }
function observed(value: unknown): ObservedTurnState {
  switch (value) {
    case 'queued': case 'running': case 'waiting_remote': case 'succeeded': case 'failed': case 'needs_reauth': case 'submission_unknown': case 'cancelled_local': return value
    default: return 'unknown'
  }
}
/** Receives the actual HTTP status and raw POST body, never a projected job. */
export function readTurnPostOutcome(status: number, body: unknown, receipt?: TurnReceipt): SafeTurnPostOutcome {
  if (!isRecord(body)) return { kind: 'unknown', reason: 'receipt' }
  let found: TurnReceipt
  let state: unknown
  let dispatchUnknown = false
  if (status >= 200 && status < 300) {
    if (!text(body.job_id) || !text(body.turn_id)) return { kind: 'unknown', reason: 'receipt' }
    found = { jobId: body.job_id, turnId: body.turn_id }; state = body.state
    if (Object.hasOwn(body, 'dispatch_receipt')) {
      const evidence = parseDispatchReceipt(body.dispatch_receipt)
      // This path requires raw exact evidence, not a projected validity wrapper.
      if (!isRecord(body.dispatch_receipt) || Object.hasOwn(body.dispatch_receipt, 'validity') || evidence.validity !== 'valid' || found.jobId !== evidence.receipt.job_id || found.turnId !== evidence.receipt.turn_id) return { kind: 'unknown', reason: 'receipt' }
      dispatchUnknown = true
    }
  } else if (status === 400 && body.detail === 'WORKER_UNAVAILABLE') {
    const evidence = parseDispatchReceipt(body.dispatch_receipt)
    if (!isRecord(body.dispatch_receipt) || Object.hasOwn(body.dispatch_receipt, 'validity') || evidence.validity !== 'valid') return { kind: 'unknown', reason: 'receipt' }
    if ((Object.hasOwn(body, 'job_id') && body.job_id !== evidence.receipt.job_id) || (Object.hasOwn(body, 'turn_id') && body.turn_id !== evidence.receipt.turn_id)) return { kind: 'unknown', reason: 'receipt' }
    found = { jobId: evidence.receipt.job_id, turnId: evidence.receipt.turn_id }; dispatchUnknown = true
  } else return { kind: 'unknown', reason: 'transport' }
  if (receipt && (receipt.jobId !== found.jobId || receipt.turnId !== found.turnId)) return { kind: 'unknown', reason: 'conflict' }
  return { kind: 'bound', ...found, state: observed(state), dispatchUnknown }
}
