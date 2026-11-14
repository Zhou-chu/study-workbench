import { matchesEmbeddingDisclosure, queryDisclosureIdentityFromRequest, type EmbeddingDisclosure } from './embedding-disclosure.js'
import type { ObservedTurnState, SafeTurnPostOutcome, TurnReceipt, TurnRequest, TurnView } from '@study/contracts'
export type { ObservedTurnState, TurnReceipt } from '@study/contracts'
import { safeHttpTarget, utf8Bytes } from './values.js'
import { copyRetrievalOptions, validRetrievalOptions, type TurnContext } from './context.js'

export const MAX_PENDING_NOTEBOOKS = 8
export const MAX_CAPTURE_BYTES = 1_048_576
export type TurnOwner = Readonly<{ mountId: string; questionRevision?: number; requestGeneration?: number; editor?: Readonly<{ session: number; revision: number }> }>
export type AttemptToken = Readonly<{ notebookId: string; operationId: string; epoch: number; attempt: number }>
/** Availability/model/capability checks belong to the admitting feature; the core revalidates the DTO. */
export type ValidatedTurnCapture = Readonly<{
  sessionId: string; context: TurnContext; owner: TurnOwner
  request: Omit<TurnRequest, 'idempotency_key'>; googleConnectionId?: string; embeddingDisclosure?: EmbeddingDisclosure
}>
export type AdmissionResult = { ok: true; token: AttemptToken } | { ok: false; reason: 'busy' | 'unavailable' | 'invalid' | 'capacity' | 'size' }
export type UnknownTurnReason = 'not-found' | 'ambiguous' | 'malformed' | 'mismatch' | 'unconfirmed' | 'answer-unavailable'
export type SafePostOutcome = SafeTurnPostOutcome | { kind: 'not-dispatched' } | { kind: 'unknown'; reason: 'unavailable' }
export type TurnMatch = { kind: 'unknown'; reason: UnknownTurnReason } |
  { kind: 'bound'; jobId: string; turnId: string; state: ObservedTurnState; reason?: UnknownTurnReason | undefined } |
  { kind: 'complete'; jobId: string; turnId: string; turn: TurnView }
export type TurnCapture = Readonly<{
  operationId: string; sessionId: string; context: TurnContext; owner: TurnOwner
  dto: Readonly<TurnRequest>; bytes: number; googleConnectionId?: string; embeddingDisclosure?: EmbeddingDisclosure
}>
export type TurnOperation = Readonly<{
  capture: TurnCapture; token: AttemptToken; phase: 'posting' | 'not-sent' | 'unknown' | 'bound' | 'complete'
  busy: 'post' | 'check' | null; postAttempts: number; everPossiblyDispatched: boolean
  receipt?: TurnReceipt; observedState: ObservedTurnState; reason?: UnknownTurnReason | undefined
}>
export interface TurnRegistry {
  admit(input: ValidatedTurnCapture): AdmissionResult
  beginRetry(operationId: string): AttemptToken | null
  beginCheck(operationId: string): AttemptToken | null
  settlePost(token: AttemptToken, result: SafePostOutcome): void
  settleCheck(token: AttemptToken, result: TurnMatch): void
  abandonNotSent(operationId: string): boolean
  releaseCompleted(operationId: string): void
  invalidate(): void
  getSnapshot(notebookId: string): TurnOperation | null
  subscribe(listener: () => void): () => void
}
const states = new Set<ObservedTurnState>(['queued', 'running', 'waiting_remote', 'succeeded', 'failed', 'needs_reauth', 'submission_unknown', 'cancelled_local'])
export function observedTurnState(value: unknown): ObservedTurnState {
  return typeof value === 'string' && states.has(value as ObservedTurnState) ? value as ObservedTurnState : 'unknown'
}
const reasons = new Set<UnknownTurnReason>(['not-found', 'ambiguous', 'malformed', 'mismatch', 'unconfirmed', 'answer-unavailable'])
const safeReason = (reason: UnknownTurnReason): UnknownTurnReason => reasons.has(reason) ? reason : 'malformed'
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
function validInput(input: ValidatedTurnCapture): boolean {
  if (!input || !nonempty(input.sessionId) || !input.owner || !nonempty(input.owner.mountId)) return false
  const { owner, context, request } = input
  if (owner.requestGeneration !== undefined && !revision(owner.requestGeneration)) return false
  if (owner.questionRevision !== undefined && !revision(owner.questionRevision)) return false
  if (owner.editor !== undefined && (!owner.editor || !revision(owner.editor.session) || !revision(owner.editor.revision))) return false
  if (input.googleConnectionId !== undefined && !nonempty(input.googleConnectionId)) return false
  if (!context || !revision(context.epoch) || typeof context.ready !== 'boolean' || !context.target) return false
  const target = context.target
  if (!['legacy_password', 'device_sessions'].includes(target.mode) || !nonempty(target.apiBase) || !(target.protocol === null || nonempty(target.protocol))) return false
  if (!safeHttpTarget(target.apiBase)) return false
  if (!request || !validRetrievalOptions(request) || !nonempty(request.notebook_id) || !['question', 'outline'].includes(request.task) || !['independent', 'notebooklm'].includes(request.engine)) return false
  if (!['local', 'remote'].includes(request.selection_origin) || !nonempty(request.message) || [...request.message].length > 50_000) return false
  if (![request.source_version_ids, request.remote_source_ids].every(ids => Array.isArray(ids) && ids.length <= 20 && Array.from(ids).every(nonempty))) return false
  if (request.remote_notebook_id !== undefined && request.remote_notebook_id !== null && !nonempty(request.remote_notebook_id)) return false
  if (request.selection_origin === 'local' ? !request.source_version_ids.length || !!request.remote_source_ids.length : !request.remote_source_ids.length || !!request.source_version_ids.length) return false
  if (request.engine === 'independent' && request.selection_origin !== 'local') return false
  if (request.retrieval_mode === 'hybrid' && !matchesEmbeddingDisclosure(input.embeddingDisclosure, queryDisclosureIdentityFromRequest(request))) return false
  if (request.retrieval_mode === 'hybrid' && (request.engine !== 'independent' || request.selection_origin !== 'local' || request.task !== 'question')) return false
  return request.engine !== 'notebooklm' || nonempty(request.remote_notebook_id)
}
function copyCapture(input: ValidatedTurnCapture, operationId: string): TurnCapture {
  const request = input.request
  const dto: TurnRequest = {
    task: request.task, notebook_id: request.notebook_id, engine: request.engine, selection_origin: request.selection_origin,
    source_version_ids: [...request.source_version_ids], remote_source_ids: [...request.remote_source_ids],
    ...(request.remote_notebook_id !== undefined ? { remote_notebook_id: request.remote_notebook_id } : {}),
    message: request.message, idempotency_key: operationId, ...copyRetrievalOptions(request),
  }
  Object.freeze(dto.source_version_ids); Object.freeze(dto.remote_source_ids); Object.freeze(dto)
  const { epoch, ready, target } = input.context
  const context = Object.freeze({ epoch, ready, target: Object.freeze({ mode: target.mode, apiBase: target.apiBase, protocol: target.protocol }) })
  const owner = Object.freeze({
    mountId: input.owner.mountId,
    ...(input.owner.requestGeneration !== undefined ? { requestGeneration: input.owner.requestGeneration } : {}),
    ...(input.owner.questionRevision !== undefined ? { questionRevision: input.owner.questionRevision } : {}),
    ...(input.owner.editor ? { editor: Object.freeze({ session: input.owner.editor.session, revision: input.owner.editor.revision }) } : {}),
  })
  return Object.freeze({ operationId, sessionId: input.sessionId, context, owner, dto,
    bytes: utf8Bytes(JSON.stringify(dto)) + (request.retrieval_mode === 'hybrid' && input.embeddingDisclosure ? utf8Bytes(JSON.stringify(input.embeddingDisclosure)) : 0),
    ...(request.retrieval_mode === 'hybrid' && input.embeddingDisclosure ? { embeddingDisclosure: input.embeddingDisclosure } : {}),
    ...(input.googleConnectionId !== undefined ? { googleConnectionId: input.googleConnectionId } : {}),
  })
}

export function canReplayCapturedTurn(capture: Pick<TurnCapture, 'dto' | 'embeddingDisclosure'>): boolean {
  return validRetrievalOptions(capture.dto) && (capture.dto.retrieval_mode !== 'hybrid' || matchesEmbeddingDisclosure(capture.embeddingDisclosure, queryDisclosureIdentityFromRequest(capture.dto)))
}

/** Pure, document-owned metadata. No timer, transport, persistence or answer payload. */
export function createTurnRegistry(createOperationId: () => string): TurnRegistry {
  const operations = new Map<string, TurnOperation>()
  const listeners = new Set<() => void>()
  let bytes = 0
  const notify = () => listeners.forEach(listener => listener())
  const find = (operationId: string) => [...operations.values()].find(operation => operation.capture.operationId === operationId)
  const save = (operation: TurnOperation) => { operations.set(operation.capture.dto.notebook_id, Object.freeze(operation)); notify() }
  const remove = (operation: TurnOperation) => { operations.delete(operation.capture.dto.notebook_id); bytes -= operation.capture.bytes; notify() }
  const current = (token: AttemptToken, busy: 'post' | 'check') => {
    const operation = operations.get(token.notebookId)
    return operation && operation.busy === busy && operation.token.operationId === token.operationId &&
      operation.capture.context.epoch === token.epoch && operation.token.attempt === token.attempt ? operation : null
  }
  const canAbandon = (operation: TurnOperation) => operation.postAttempts === 1 && !operation.everPossiblyDispatched && !operation.receipt && operation.phase === 'not-sent'
  const begin = (operationId: string, busy: 'post' | 'check'): AttemptToken | null => {
    const operation = find(operationId)
    if (!operation || operation.busy || operation.phase === 'complete' || (busy === 'post' && (operation.receipt || !canReplayCapturedTurn(operation.capture)))) return null
    const token = Object.freeze({ ...operation.token, attempt: operation.token.attempt + 1 })
    save({ ...operation, token, busy, phase: busy === 'post' ? 'posting' : operation.phase, postAttempts: operation.postAttempts + (busy === 'post' ? 1 : 0), reason: undefined })
    return token
  }
  const bind = (operation: TurnOperation, result: TurnReceipt, state: ObservedTurnState, complete: boolean, reason?: UnknownTurnReason | undefined) => {
    if (!nonempty(result.jobId) || !nonempty(result.turnId)) {
      save({ ...operation, busy: null, phase: 'unknown', observedState: 'unknown', everPossiblyDispatched: true, reason: 'malformed' })
    } else if (operation.receipt && (operation.receipt.jobId !== result.jobId || operation.receipt.turnId !== result.turnId)) {
      save({ ...operation, busy: null, phase: 'unknown', observedState: 'unknown', everPossiblyDispatched: true, reason: 'mismatch' })
    } else {
      save({ ...operation, busy: null, phase: complete ? 'complete' : 'bound', observedState: state, everPossiblyDispatched: true,
        receipt: Object.freeze({ jobId: result.jobId, turnId: result.turnId }), reason })
    }
  }
  return {
    admit(input) {
      if (!validInput(input)) return { ok: false, reason: 'invalid' }
      if (!input.context.ready) return { ok: false, reason: 'unavailable' }
      if (operations.has(input.request.notebook_id)) return { ok: false, reason: 'busy' }
      if (operations.size >= MAX_PENDING_NOTEBOOKS) return { ok: false, reason: 'capacity' }
      let operationId: string
      try { operationId = createOperationId() } catch { return { ok: false, reason: 'unavailable' } }
      if (!nonempty(operationId) || find(operationId)) return { ok: false, reason: 'unavailable' }
      const capture = copyCapture(input, operationId)
      if (capture.bytes + bytes > MAX_CAPTURE_BYTES) return { ok: false, reason: 'size' }
      const token = Object.freeze({ notebookId: capture.dto.notebook_id, operationId, epoch: capture.context.epoch, attempt: 1 })
      bytes += capture.bytes
      save({ capture, token, phase: 'posting', busy: 'post', postAttempts: 1, everPossiblyDispatched: false, observedState: 'unknown' })
      return { ok: true, token }
    },
    beginRetry: operationId => begin(operationId, 'post'),
    beginCheck: operationId => begin(operationId, 'check'),
    settlePost(token, result) {
      const operation = current(token, 'post'); if (!operation) return
      if (result.kind === 'bound') { bind(operation, result, observedTurnState(result.state), false); return }
      const unsent = result.kind === 'not-dispatched'
      save({ ...operation, busy: null, phase: unsent && operation.postAttempts === 1 && !operation.everPossiblyDispatched && !operation.receipt ? 'not-sent' : 'unknown',
        everPossiblyDispatched: operation.everPossiblyDispatched || !unsent, observedState: 'unknown',
        reason: result.kind === 'unknown' ? (result.reason === 'conflict' ? 'mismatch' : result.reason === 'receipt' ? 'malformed' : 'unconfirmed') : undefined })
    },
    settleCheck(token, result) {
      const operation = current(token, 'check'); if (!operation) return
      if (result.kind !== 'unknown') { bind(operation, result, result.kind === 'complete' ? 'succeeded' : observedTurnState(result.state), result.kind === 'complete', result.kind === 'bound' && result.reason !== undefined ? safeReason(result.reason) : undefined); return }
      save({ ...operation, busy: null, phase: canAbandon(operation) ? 'not-sent' : 'unknown', observedState: 'unknown', reason: safeReason(result.reason) })
    },
    abandonNotSent(operationId) {
      const operation = find(operationId)
      if (!operation || operation.busy || !canAbandon(operation)) return false
      remove(operation); return true
    },
    releaseCompleted(operationId) { const operation = find(operationId); if (operation?.phase === 'complete' && !operation.busy) remove(operation) },
    invalidate() { if (!operations.size) return; operations.clear(); bytes = 0; notify() },
    getSnapshot: notebookId => operations.get(notebookId) ?? null,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
