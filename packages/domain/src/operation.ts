import type { OperationReceipt, OperationState } from '@study/contracts'
import { canDispatch, freezeDispatchContext, type DispatchContext } from './context.js'
export type OperationModel = Readonly<{
  context: DispatchContext; operationKey: string; serverIdempotency: boolean; sessionGeneration: number
  state: OperationState; attempt: number; receipt: Readonly<OperationReceipt> | null; remoteCanceled: boolean
}>
export type OperationEvent =
  | { type: 'begin' | 'retry'; context: DispatchContext; sessionGeneration: number }
  | { type: 'accepted'; attempt: number; receipt: OperationReceipt }
  | { type: 'unknown' | 'not-sent' | 'running' | 'succeeded' | 'failed' | 'remote-canceled'; attempt: number }
  | { type: 'stop-waiting' }
export function createOperation(context: DispatchContext, operationKey: string, options: { serverIdempotency: boolean; sessionGeneration: number }): OperationModel {
  return Object.freeze({ context: freezeDispatchContext(context), operationKey, serverIdempotency: options.serverIdempotency, sessionGeneration: options.sessionGeneration, state: 'idle', attempt: 0, receipt: null, remoteCanceled: false })
}
export function reduceOperation(state: OperationModel, event: OperationEvent): OperationModel {
  const update = (patch: Partial<OperationModel>): OperationModel => Object.freeze({ ...state, ...patch })
  if (event.type === 'begin' || event.type === 'retry') {
    if (!canDispatch(state.context, event.context) || event.sessionGeneration !== state.sessionGeneration) return state
    if (state.state !== 'idle' && !(event.type === 'retry' && state.state === 'unknown' && state.serverIdempotency && !state.receipt)) return state
    return update({ state: 'submitting', attempt: state.attempt + 1 })
  }
  if (event.type === 'stop-waiting') return ['submitting','accepted','running','unknown'].includes(state.state) ? update({ state: 'canceled_locally' }) : state
  if (!('attempt' in event) || event.attempt !== state.attempt || event.attempt < 1 || ['succeeded','failed'].includes(state.state)) return state
  switch (event.type) {
    case 'accepted': {
      const receipt = event.receipt
      if (!receipt.job_id.trim() || (state.receipt && (state.receipt.job_id !== receipt.job_id || state.receipt.turn_id !== receipt.turn_id))) return update({ state: 'unknown' })
      return update({ state: 'accepted', receipt: Object.freeze({ job_id: receipt.job_id, ...(receipt.turn_id !== undefined ? { turn_id: receipt.turn_id } : {}), ...(receipt.state !== undefined ? { state: receipt.state } : {}) }) })
    }
    case 'not-sent': return state.state === 'submitting' && state.attempt === 1 && !state.receipt ? update({ state: 'idle' }) : update({ state: 'unknown' })
    case 'remote-canceled': return update({ state: 'canceled_locally', remoteCanceled: true })
    default: return update({ state: event.type })
  }
}
