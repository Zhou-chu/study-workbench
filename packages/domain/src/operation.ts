import type { OperationReceipt, OperationState } from '@study/contracts'
import { canDispatch, freezeDispatchContext, sameTurnTarget, type DispatchContext } from './context.js'
/** Immutable local ownership of one attempt; never server replay authority. */
export type OperationToken = Readonly<{
  operationKey: string; context: DispatchContext; sessionGeneration: number; attempt: number
}>
export type OperationModel = Readonly<{
  context: DispatchContext; operationKey: string; serverIdempotency: boolean; sessionGeneration: number
  state: OperationState; attempt: number; token: OperationToken | null; receipt: Readonly<OperationReceipt> | null; remoteCanceled: boolean
}>
export type OperationEvent =
  | { type: 'begin' | 'retry'; context: DispatchContext; sessionGeneration: number }
  | { type: 'accepted'; token: OperationToken; receipt: OperationReceipt }
  | { type: 'unknown' | 'not-sent' | 'running' | 'succeeded' | 'failed' | 'remote-canceled'; token: OperationToken }
  | { type: 'stop-waiting' }
export function createOperation(context: DispatchContext, operationKey: string, options: { serverIdempotency: boolean; sessionGeneration: number }): OperationModel {
  return Object.freeze({ context: freezeDispatchContext(context), operationKey, serverIdempotency: options.serverIdempotency, sessionGeneration: options.sessionGeneration, state: 'idle', attempt: 0, token: null, receipt: null, remoteCanceled: false })
}
export function reduceOperation(state: OperationModel, event: OperationEvent): OperationModel {
  const update = (patch: Partial<OperationModel>): OperationModel => Object.freeze({ ...state, ...patch })
  if (event.type === 'begin' || event.type === 'retry') {
    if (!canDispatch(state.context, event.context) || event.sessionGeneration !== state.sessionGeneration) return state
    if (state.state !== 'idle' && !(event.type === 'retry' && state.state === 'unknown' && state.serverIdempotency && !state.receipt)) return state
    const token = Object.freeze({ operationKey: state.operationKey, context: state.context, sessionGeneration: state.sessionGeneration, attempt: state.attempt + 1 })
    return update({ state: 'submitting', attempt: token.attempt, token })
  }
  if (event.type === 'stop-waiting') return ['submitting','accepted','running','unknown'].includes(state.state) ? update({ state: 'canceled_locally' }) : state
  if (!('token' in event) || !event.token || !state.token || ['succeeded','failed'].includes(state.state)) return state
  const token = event.token
  if (token.operationKey !== state.operationKey || token.sessionGeneration !== state.sessionGeneration || token.attempt !== state.attempt || token.attempt < 1 ||
    !token.context || token.context.epoch !== state.context.epoch || token.context.ready !== state.context.ready || !token.context.target || !sameTurnTarget(token.context.target, state.context.target)) return state
  switch (event.type) {
    case 'accepted': {
      const receipt = event.receipt
      if (!receipt.job_id.trim() || (state.receipt && (state.receipt.job_id !== receipt.job_id || state.receipt.turn_id !== receipt.turn_id))) return update({ state: 'unknown' })
      return update({ state: 'accepted', receipt: Object.freeze({ job_id: receipt.job_id, ...(receipt.turn_id !== undefined ? { turn_id: receipt.turn_id } : {}), ...(receipt.state !== undefined ? { state: receipt.state } : {}) }) })
    }
    case 'not-sent': return state.state === 'submitting' && state.attempt === 1 && !state.receipt ? update({ state: 'idle', token: null }) : update({ state: 'unknown' })
    case 'remote-canceled': return update({ state: 'canceled_locally', remoteCanceled: true })
    default: return update({ state: event.type })
  }
}
