'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTurnOperationRegistry, useTurnOperationSnapshot } from '@/components/providers/TurnOperationProvider'
import { workbenchApi } from '@/lib/api/workbench'
import { asRequestNotDispatchedError } from '@/lib/api/browser-transport'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { readTurnContext, subscribeTurnContext } from '@/lib/workbench/turn-context'
import { readTurnPostOutcome, reconcileTurn } from '@/lib/workbench/turn-reconciliation'
import type { AdmissionResult, AttemptToken, SafePostOutcome, TurnOperation, ValidatedTurnCapture } from '@/lib/workbench/turn-operations'
import type { TurnRecord } from '@/lib/types/personal'
import { requestErrorCode } from '@/lib/utils/workbench'

export interface TurnEnvironment {
  independentAvailable: boolean
  googleAvailable: boolean
  googleLink: { remote_notebook_id?: string | null; connection_id?: string | null } | null
}
type SubmitInput = Omit<ValidatedTurnCapture, 'context'> & { available: boolean }
type Completion = { token: AttemptToken; turn: TurnRecord }
const serverContext = () => null
const active = (operation: TurnOperation) => ['queued', 'running', 'waiting_remote'].includes(operation.observedState)
const sameToken = (a: AttemptToken, b: AttemptToken) => a.operationId === b.operationId && a.epoch === b.epoch && a.attempt === b.attempt
function postFailure(error: unknown, operation: TurnOperation): { outcome: SafePostOutcome; unmapped: boolean } {
  if (asRequestNotDispatchedError(error)) return { outcome: { kind: 'not-dispatched' }, unmapped: false }
  const response = error && typeof error === 'object' && 'response' in error ? error.response as { status?: unknown; data?: unknown } | undefined : undefined
  return { outcome: response && typeof response.status === 'number' ? readTurnPostOutcome(response.status, response.data, operation.receipt) : { kind: 'unknown', reason: 'transport' }, unmapped: requestErrorCode(error) === 'UNMAPPED_SOURCE' }
}

/** Writes only on explicit actions. Query owns fresh reads, never operation identity. */
export function useWorkbenchTurn(notebookId: string, environment: TurnEnvironment) {
  const registry = useTurnOperationRegistry()
  const operation = useTurnOperationSnapshot(notebookId)
  const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, serverContext)
  const authPhase = useAuthStore(state => state.phase)
  const ready = !!context?.ready && authPhase === 'authenticated' && sessionCoordinator.resourcePhase() === 'authenticated'
  const queryClient = useQueryClient()
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [rejection, setRejection] = useState<Extract<AdmissionResult, { ok: false }>['reason'] | null>(null)
  const [accepted, setAccepted] = useState<AttemptToken | null>(null)
  const [completed, setCompleted] = useState<Completion | null>(null)
  const [read, setRead] = useState<{ token: AttemptToken; turns: TurnRecord[]; failed: boolean } | null>(null)
  const [postProblem, setPostProblem] = useState<{ token: AttemptToken; unmapped: boolean } | null>(null)
  useEffect(() => {
    let epoch = readTurnContext()?.epoch
    return subscribeTurnContext(() => {
      const next = readTurnContext()?.epoch
      if (next === epoch) return
      epoch = next
      setRead(null); setCompleted(null); setAccepted(null); setPostProblem(null); setRejection(null)
    })
  }, [])
  const current = useCallback((token: AttemptToken) => {
    const value = registry.getSnapshot(token.notebookId)
    return value && sameToken(value.token, token) ? value : null
  }, [registry])

  const postOriginal = async (token: AttemptToken) => {
    const value = current(token)
    if (!value) return
    let outcome: SafePostOutcome
    let unmapped = false
    try { outcome = readTurnPostOutcome(200, await workbenchApi.turn(value.capture.sessionId, value.capture.dto, value.capture.context), value.receipt) }
    catch (error) { ({ outcome, unmapped } = postFailure(error, value)) }
    if (!current(token)) return
    registry.settlePost(token, outcome.kind === 'bound' && outcome.dispatchUnknown ? { ...outcome, state: 'unknown' } : outcome)
    if (!mounted.current || !current(token)) return
    if (outcome.kind === 'bound' && !outcome.dispatchUnknown && ['queued', 'running', 'waiting_remote', 'succeeded'].includes(outcome.state)) setAccepted(token)
    if (outcome.kind !== 'bound' || outcome.dispatchUnknown) setPostProblem({ token, unmapped })
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(token.notebookId) })
  }

  const checkOriginal = useCallback(() => {
    const value = registry.getSnapshot(notebookId)
    if (!value) return
    const token = registry.beginCheck(value.capture.operationId)
    if (!token) return
    // Reserve the core latch first. Each read has a unique attempt key; neither a
    // stale cache hit nor a paused offline query may strand that reserved latch.
    // No Query observer is installed: focus/reconnect cannot restart these reads.
    const key = [...QUERY_KEYS.workbenchTurnCheck(notebookId), token.epoch, token.operationId, token.attempt]
    void queryClient.fetchQuery({ queryKey: key, staleTime: 0, gcTime: 0, retry: false, networkMode: 'always', queryFn: async () => {
      const [workspace, history] = await Promise.all([
        workbenchApi.workspace(notebookId, value.capture.context).then(data => ({ data, failed: false }), () => ({ data: null, failed: true })),
        workbenchApi.turns(value.capture.sessionId, value.capture.context).then(data => ({ data, failed: false }), () => ({ data: null, failed: true })),
      ])
      return { token, match: reconcileTurn(value.capture, workspace.data, history.data, value.receipt), turns: history.data ?? [], failed: workspace.failed || history.failed }
    } }).then(result => {
      if (!current(result.token)) return
      registry.settleCheck(result.token, result.match)
      if (!current(result.token)) return
      // Completion proof belongs to this tagged read, but history must survive
      // its consumer. Refresh an active replacement view, or mark the absent
      // view stale so its next mount cannot reuse a fresh-but-empty cache.
      if (result.match.kind === 'complete') void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(result.token.notebookId), exact: true, refetchType: 'active' })
      if (!mounted.current) return
      setRead({ token: result.token, turns: result.turns, failed: result.failed })
      if (result.match.kind === 'complete') setCompleted({ token: result.token, turn: result.match.turn })
    }).catch(() => {
      // Query cancellation/failure is not evidence of a rejected write.
      if (!current(token)) return
      registry.settleCheck(token, { kind: 'unknown', reason: 'unconfirmed' })
      if (mounted.current) setRead({ token, turns: [], failed: true })
    }).finally(() => { queryClient.removeQueries({ queryKey: key, exact: true }) })
  }, [current, notebookId, queryClient, registry])

  const inspected = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) { inspected.current = null; return }
    if (!operation || operation.busy || operation.phase !== 'bound' || (!active(operation) && operation.observedState !== 'succeeded')) return
    const id = operation.capture.operationId
    if (inspected.current !== id) { inspected.current = id; checkOriginal(); return }
    if (!active(operation)) return
    const timer = setTimeout(checkOriginal, 2000)
    return () => clearTimeout(timer)
  }, [ready, operation, checkOriginal])

  const canReplay = (value: TurnOperation) => value.capture.dto.engine === 'independent' ? environment.independentAvailable :
    environment.googleAvailable && !!environment.googleLink && environment.googleLink.remote_notebook_id === value.capture.dto.remote_notebook_id && environment.googleLink.connection_id === value.capture.googleConnectionId
  const submit = (input: SubmitInput): AdmissionResult => {
    const context = readTurnContext()
    const result: AdmissionResult = !input.available ? { ok: false, reason: 'invalid' } : !context ? { ok: false, reason: 'unavailable' } : registry.admit({ ...input, context })
    setRejection(result.ok ? null : result.reason)
    if (result.ok) { setPostProblem(null); setAccepted(null); setCompleted(null); void postOriginal(result.token) }
    return result
  }
  const retryOriginal = () => {
    const value = registry.getSnapshot(notebookId)
    if (!value || !canReplay(value)) return
    const token = registry.beginRetry(value.capture.operationId)
    if (token) { setPostProblem(null); void postOriginal(token) }
  }
  const acceptance = accepted && operation && accepted.epoch === operation.token.epoch && accepted.operationId === operation.token.operationId ? accepted : null
  const completion = completed && operation && sameToken(completed.token, operation.token) ? completed : null
  const visibleRead = read?.token.epoch === context?.epoch ? read : null
  return {
    operation, completion, acceptance, ready, rejection,
    turns: visibleRead?.turns ?? [], readFailed: !!visibleRead?.failed && visibleRead.token.operationId === operation?.capture.operationId,
    submissionFailed: !!postProblem && postProblem.token.operationId === operation?.capture.operationId,
    unmappedSources: !!postProblem?.unmapped && postProblem.token.operationId === operation?.capture.operationId,
    replayAvailable: !!operation && ready && !operation.receipt && !operation.busy && canReplay(operation),
    submit, checkOriginal, retryOriginal,
    abandonUnsent: () => { if (operation) registry.abandonNotSent(operation.capture.operationId) },
    releaseCompleted: (token: AttemptToken) => { if (current(token)?.phase === 'complete') registry.releaseCompleted(token.operationId) },
    isCurrent: (token: AttemptToken) => !!current(token),
  }
}
