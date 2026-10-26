import type { TurnRecord } from '@/lib/types/personal'
import { observedTurnState, type SafePostOutcome, type TurnCapture, type TurnMatch, type TurnReceipt, type UnknownTurnReason } from './turn-operations'

type Row = Record<string, unknown>
const record = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const has = (row: Row, field: string) => Object.prototype.hasOwnProperty.call(row, field)
const ids = (value: unknown): value is string[] => Array.isArray(value) && Array.from(value).every(text)
const nullableText = (value: unknown) => value === null || typeof value === 'string'
const unknown = (reason: UnknownTurnReason): TurnMatch => ({ kind: 'unknown', reason })
const equalReceipt = (a: TurnReceipt, b: TurnReceipt) => a.jobId === b.jobId && a.turnId === b.turnId
function readReceipt(value: unknown): TurnReceipt | null {
  if (!record(value) || Object.keys(value).length !== 4 || value.dispatch_ack !== 'unknown' || value.retry_safe !== false || !text(value.job_id) || !text(value.turn_id)) return null
  return { jobId: value.job_id, turnId: value.turn_id }
}

/** Reduce response data immediately. No response/error object or answer escapes into the registry. */
export function readTurnPostOutcome(status: number, body: unknown, receipt?: TurnReceipt): SafePostOutcome {
  if (!record(body)) return { kind: 'unknown', reason: 'receipt' }
  let found: TurnReceipt
  let state: unknown
  let dispatchUnknown = false
  if (status >= 200 && status < 300) {
    if (!text(body.job_id) || !text(body.turn_id)) return { kind: 'unknown', reason: 'receipt' }
    found = { jobId: body.job_id, turnId: body.turn_id }; state = body.state
    if (has(body, 'dispatch_receipt')) {
      const evidence = readReceipt(body.dispatch_receipt)
      if (!evidence || !equalReceipt(found, evidence)) return { kind: 'unknown', reason: 'receipt' }
      dispatchUnknown = true
    }
  } else if (status === 400 && body.detail === 'WORKER_UNAVAILABLE') {
    const evidence = readReceipt(body.dispatch_receipt)
    if (!evidence) return { kind: 'unknown', reason: 'receipt' }
    found = evidence; dispatchUnknown = true
  } else {
    return { kind: 'unknown', reason: 'transport' }
  }
  if (receipt && !equalReceipt(receipt, found)) return { kind: 'unknown', reason: 'conflict' }
  return { kind: 'bound', ...found, state: observedTurnState(state), dispatchUnknown }
}

/** Compare JSON content; object key order is irrelevant, array order is not. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b && (a === null || ['string', 'boolean'].includes(typeof a) || (typeof a === 'number' && Number.isFinite(a)))) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameJson(value, b[index]))
  if (!record(a) || !record(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => has(b, key) && sameJson(a[key], b[key]))
}
const requestFields = new Set(['notebook_id', 'engine', 'message', 'selection_origin', 'source_version_ids', 'remote_notebook_id', 'remote_source_ids', 'idempotency_key', 'model_id', 'task'])
function normalizedRequest(value: unknown): Row | null {
  if (!record(value) || Object.keys(value).some(key => !requestFields.has(key))) return null
  // These are the defaults in api.routers.evidence.TurnRequest, not hash logic.
  const request: Row = { selection_origin: 'local', source_version_ids: [], remote_notebook_id: null, remote_source_ids: [], model_id: null, task: 'question', ...value }
  if (!text(request.notebook_id) || !['independent', 'notebooklm'].includes(request.engine as string) || !text(request.message) || [...request.message].length > 50_000) return null
  if (!text(request.idempotency_key) || [...request.idempotency_key].length > 200 || !['question', 'outline'].includes(request.task as string) || !['local', 'remote'].includes(request.selection_origin as string)) return null
  if (!ids(request.source_version_ids) || request.source_version_ids.length > 20 || !ids(request.remote_source_ids) || request.remote_source_ids.length > 20 || !nullableText(request.remote_notebook_id) || !nullableText(request.model_id)) return null
  return request
}
function turnIdentity(turn: Row, capture: TurnCapture, turnId: string): boolean {
  return turn.turn_id === turnId && turn.notebook_id === capture.dto.notebook_id && turn.chat_session_id === capture.sessionId &&
    turn.engine === capture.dto.engine && turn.message === capture.dto.message &&
    (has(turn, 'idempotency_key') ? turn.idempotency_key === capture.dto.idempotency_key : capture.dto.engine === 'notebooklm')
}
function succeeded(value: Row): boolean {
  return value.status === 'succeeded' && (!has(value, 'state') || value.state === 'succeeded') &&
    (!has(value, 'generation_status') || value.generation_status === 'succeeded')
}
function validScope(value: unknown, capture: TurnCapture): boolean {
  if (!record(value) || value.engine !== capture.dto.engine || value.selection_origin !== capture.dto.selection_origin || !ids(value.source_version_ids) || !ids(value.remote_source_ids)) return false
  if (capture.dto.engine === 'notebooklm' ? value.remote_notebook_id !== capture.dto.remote_notebook_id : value.remote_notebook_id !== null) return false
  return !has(value, 'scope_hash') || text(value.scope_hash)
}
function validCitations(value: unknown): boolean {
  return Array.isArray(value) && value.every(citation => {
    if (!record(citation) || !text(citation.citation_id) || !['local_evidence', 'remote_text_snapshot', 'remote_unmapped', 'derived_snapshot'].includes(citation.kind as string) || typeof citation.quote !== 'string' || !text(citation.reference_validity)) return false
    if (![citation.source_version_id, citation.evidence_id, citation.source_title].every(nullableText)) return false
    // Retained nullable metadata is not proof of independent corroboration.
    if (has(citation, 'independent_support') && citation.independent_support !== null && typeof citation.independent_support !== 'boolean') return false
    if (has(citation, 'remote_reference') && citation.remote_reference !== null && !record(citation.remote_reference)) return false
    if (has(citation, 'locator') && citation.locator !== null) {
      const locator = citation.locator
      if (!record(locator)) return false
      if (['page_index', 'start_offset', 'end_offset'].some(key => has(locator, key) && locator[key] !== null && (!Number.isSafeInteger(locator[key]) || (locator[key] as number) < 0))) return false
      if (['page_label', 'block_id'].some(key => has(locator, key) && !nullableText(locator[key]))) return false
      if (has(locator, 'bbox') && locator.bbox !== null && (!Array.isArray(locator.bbox) || !locator.bbox.every(number => typeof number === 'number' && Number.isFinite(number)))) return false
    }
    return true
  })
}

/** Workspace/history only. Never invokes the dispatch-capable generic GET-job API.
 * Receipt is separate from immutable capture and must be passed by the caller when known. */
export function reconcileTurn(capture: TurnCapture, workspace: unknown, history: unknown, receipt?: TurnReceipt): TurnMatch {
  if (!record(workspace) || !record(workspace.notebook) || !Array.isArray(workspace.jobs)) return unknown('malformed')
  if (workspace.notebook.id !== capture.dto.notebook_id) return unknown('mismatch')
  const parents: Row[] = []
  for (const job of workspace.jobs) {
    if (!record(job)) return unknown('malformed')
    const snapshot = record(job.request_snapshot) ? job.request_snapshot : null
    const knownId = !!receipt && (job.job_id === receipt.jobId || job.turn_id === receipt.turnId)
    if (job.operation === 'ask') {
      if (receipt && job.job_id === receipt.jobId) return unknown('mismatch')
      continue
    }
    const candidate = knownId || job.idempotency_key === capture.dto.idempotency_key || snapshot?.idempotency_key === capture.dto.idempotency_key ||
      (job.operation === 'chat' && !text(job.idempotency_key) && !text(snapshot?.idempotency_key))
    if (!candidate) continue
    if ((has(job, 'restored_history') && typeof job.restored_history !== 'boolean') || (has(job, 'replay_allowed') && typeof job.replay_allowed !== 'boolean')) return unknown('malformed')
    if (job.restored_history === true || job.replay_allowed === false) continue
    if (job.operation !== 'chat') return unknown('malformed')
    parents.push(job)
  }
  if (!parents.length) return unknown('not-found')
  if (parents.length !== 1) return unknown('ambiguous')
  const parent = parents[0]
  if (!text(parent.job_id) || !text(parent.turn_id) || !text(parent.notebook_id) || !text(parent.chat_session_id) || !text(parent.idempotency_key)) return unknown('malformed')
  const binding = { jobId: parent.job_id, turnId: parent.turn_id }
  if (parent.notebook_id !== capture.dto.notebook_id || parent.chat_session_id !== capture.sessionId || parent.idempotency_key !== capture.dto.idempotency_key || (receipt && !equalReceipt(receipt, binding))) return unknown('mismatch')
  // The first match discovers IDs even without a POST receipt. A different-key
  // row colliding with those IDs is not provably unrelated and cannot be filtered
  // away merely because it did not participate in the initial key lookup.
  for (const row of workspace.jobs) {
    if (row === parent || !record(row) || (row.job_id !== binding.jobId && row.turn_id !== binding.turnId)) continue
    if ((has(row, 'restored_history') && typeof row.restored_history !== 'boolean') || (has(row, 'replay_allowed') && typeof row.replay_allowed !== 'boolean')) return unknown('malformed')
    if (row.restored_history === true || row.replay_allowed === false) continue
    if (row.operation === 'ask' && row.job_id !== binding.jobId) continue
    return unknown('ambiguous')
  }
  const request = normalizedRequest(parent.request_snapshot)
  if (!request) return unknown('malformed')
  if (!sameJson(request, normalizedRequest(capture.dto))) return unknown('mismatch')
  if (has(parent, 'dispatch_receipt')) {
    const evidence = readReceipt(parent.dispatch_receipt)
    if (!evidence) return unknown('malformed')
    if (!equalReceipt(evidence, binding)) return unknown('mismatch')
  }
  if (has(parent, 'status') && parent.status !== parent.state) return unknown('mismatch')
  const state = observedTurnState(parent.state)
  if (state !== 'succeeded') return { kind: 'bound', ...binding, state }
  // Identity is proven independently from answer recovery. A discovered parent is
  // check-only even while canonical history/result evidence is unavailable.
  const incomplete = (reason: UnknownTurnReason): TurnMatch => ({ kind: 'bound', ...binding, state: 'unknown', reason })
  if (parent.submission_state !== 'confirmed') return incomplete('unconfirmed')
  if (!Array.isArray(history)) return incomplete('malformed')
  const turns: Row[] = []
  for (const value of history) {
    if (!record(value) || !text(value.turn_id)) return incomplete('malformed')
    if (value.turn_id === parent.turn_id || value.idempotency_key === capture.dto.idempotency_key) turns.push(value)
  }
  if (!turns.length) return incomplete('answer-unavailable')
  if (turns.length !== 1) return incomplete('ambiguous')
  const turn = turns[0]
  if (!turnIdentity(turn, capture, parent.turn_id)) return incomplete('mismatch')
  if (!succeeded(turn)) return incomplete('unconfirmed')
  const result = parent.result
  if (!record(result) || !succeeded(result)) return incomplete('unconfirmed')
  // Google result.job_id is the child ID; the top-level parent already owns binding.
  if (!turnIdentity(result, capture, parent.turn_id)) return incomplete('mismatch')
  if (!text(turn.answer) || !text(result.answer)) return incomplete('answer-unavailable')
  if (!validScope(turn.scope_snapshot, capture) || !validScope(result.scope_snapshot, capture) || !validCitations(turn.citations) || !validCitations(result.citations)) return incomplete('malformed')
  if (turn.answer !== result.answer || !sameJson(turn.scope_snapshot, result.scope_snapshot) || !sameJson(turn.citations, result.citations)) return incomplete('mismatch')
  return { kind: 'complete', ...binding, turn: turn as unknown as TurnRecord }
}
