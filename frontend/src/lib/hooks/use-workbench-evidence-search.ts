'use client'

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { evidenceApi } from '@/lib/api/evidence'
import { assertResourceDispatch, assertTurnDispatch, RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { Workspace, WorkspaceSelection, RetrievalOptions, RetrievalResult } from '@/lib/types/personal'
import { selectedSourceBlockers, selectedSourceReadinessFingerprint } from '@/lib/utils/workbench-readiness'
import { projectWorkbenchSelection } from '@/lib/utils/workbench-read-model'
import { copyRetrievalOptions, readTurnContext, subscribeTurnContext, type TurnContext } from '@/lib/workbench/turn-context'

import { currentSemanticStatus, semanticOptionsAllowed } from './use-semantic-status'

type Result = Awaited<ReturnType<typeof evidenceApi.search>>
type Capture = Readonly<{ generation: number; notebookId: string; query: string; versionIds: readonly string[]; context: TurnContext; options?: Readonly<RetrievalOptions>; retrievalGeneration?: number }>
type SearchState = { capture: Capture; status: 'loading' | 'success' | 'empty' | 'error'; hits: Result['hits']; metadata?: Partial<Omit<RetrievalResult, 'hits'>> }
const serverContext = () => null

/** Explicit, document-local reads. Neither query observers nor reconnects submit searches. */
export function useWorkbenchEvidenceSearch(notebookId: string, selection: WorkspaceSelection | null, sources: Workspace['sources'] | undefined, retrieval?: RetrievalOptions, retrievalGeneration?: number | (() => number)) {
  const queryClient = useQueryClient()
  const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, serverContext)
  const authPhase = useAuthStore(state => state.phase)
  const [query, setQueryState] = useState('')
  const queryRef = useRef('')
  const latest = useRef({ notebookId, selection, sources, retrieval, retrievalGeneration })
  const retrievalProp = useRef(retrieval)
  const generationProp = useRef(retrievalGeneration)
  if (generationProp.current !== retrievalGeneration) { latest.current.retrievalGeneration = retrievalGeneration; generationProp.current = retrievalGeneration }
  if (retrievalProp.current !== retrieval) { latest.current.retrieval = retrieval; retrievalProp.current = retrieval }
  Object.assign(latest.current, { notebookId, selection, sources })
  const cacheOwner = useRef({ notebookId, seen: false })
  const currentSources = () => {
    const id = latest.current.notebookId
    if (cacheOwner.current.notebookId !== id) cacheOwner.current = { notebookId: id, seen: false }
    const cached = queryClient.getQueryState<Workspace>(QUERY_KEYS.workbench(id))
    if (cached) cacheOwner.current.seen = true
    // A removed/empty authoritative cache cannot borrow an older observer prop.
    return cached ? cached.data?.sources : cacheOwner.current.seen ? undefined : latest.current.sources
  }
  const owner = useRef({ fingerprint: '', generation: 0 })
  const pending = useRef<Capture | null>(null)
  const mounted = useRef(false)
  const [state, setState] = useState<SearchState | null>(null)
  const [, renderGeneration] = useReducer(value => value + 1, 0)

  const readRetrievalGeneration = () => typeof latest.current.retrievalGeneration === 'function' ? latest.current.retrievalGeneration() : latest.current.retrievalGeneration
  const sync = () => {
    const view = projectWorkbenchSelection(latest.current.selection)
    // Reading position deliberately does not belong to the search scope.
    const fingerprint = JSON.stringify([latest.current.notebookId, queryRef.current, view.supported, view.engine, view.selection_origin, view.source_version_ids, view.remote_source_ids, view.selection_origin === 'local' ? selectedSourceReadinessFingerprint(view.source_version_ids, currentSources()) : null, readTurnContext(), readRetrievalGeneration(), latest.current.retrieval, latest.current.retrieval?.retrieval_mode === 'hybrid' ? (() => { const status = currentSemanticStatus(queryClient, latest.current.notebookId, view.source_version_ids); return status ? [status.enabled, status.snapshot, status.profiles.find(row => row.profile.profile_id === latest.current.retrieval?.embedding_profile_id)?.profile] : null })() : null, useAuthStore.getState().phase, sessionCoordinator.resourcePhase()])
    if (owner.current.fingerprint !== fingerprint) {
      owner.current = { fingerprint, generation: owner.current.generation + 1 }
      pending.current = null
    }
    return owner.current.generation
  }
  // Observe every committed input generation, not just equality at settlement:
  // an A → B → A transition must never reactivate an A response.
  const generation = sync()
  const changed = () => {
    const previous = owner.current.generation
    if (sync() !== previous) renderGeneration()
  }
  const syncRef = useRef(changed)
  syncRef.current = changed
  useEffect(() => {
    mounted.current = true
    const unsubscribeContext = subscribeTurnContext(() => { syncRef.current() })
    const unsubscribeAuth = useAuthStore.subscribe(() => { syncRef.current() })
    // Cache notifications are synchronous; React Query observer renders may
    // coalesce ready → blocked → ready and must not erase either transition.
    const unsubscribeCache = queryClient.getQueryCache().subscribe(event => {
      if (event.type !== 'updated' && event.type !== 'removed') return
      const key = QUERY_KEYS.workbench(latest.current.notebookId)
      if (event.query.queryKey[0] === 'personal' && event.query.queryKey[1] === 'semantic-index' && event.query.queryKey[2] === latest.current.notebookId) syncRef.current()
      if (event.query.queryKey.length === key.length && key.every((part, index) => event.query.queryKey[index] === part)) syncRef.current()
    })
    return () => { mounted.current = false; pending.current = null; owner.current.generation++; unsubscribeContext(); unsubscribeAuth(); unsubscribeCache() }
  }, [queryClient])
  const isCurrent = (capture: Capture) => {
    if (!mounted.current || sync() !== capture.generation) return false
    const current = projectWorkbenchSelection(latest.current.selection)
    if (!semanticOptionsAllowed(queryClient, latest.current.notebookId, current.source_version_ids, latest.current.retrieval)) return false
    if (current.selection_origin !== 'local' || selectedSourceBlockers(current.source_version_ids, currentSources()).length) return false
    try { assertTurnDispatch(capture.context); assertResourceDispatch() } catch { return false }
    return useAuthStore.getState().phase === 'authenticated'
  }
  const mutation = useMutation({
    retry: false, networkMode: 'always',
    mutationFn: (capture: Capture) => {
      if (!isCurrent(capture)) throw new RequestNotDispatchedError('superseded')
      return evidenceApi.search(capture.query, capture.versionIds, capture.context, capture.options ? { notebook_id: capture.notebookId, ...capture.options } : undefined)
    },
    onSuccess: (result, capture) => {
      if (isCurrent(capture)) setState({ capture, status: result.hits.length ? 'success' : 'empty', hits: result.hits, metadata: result.retrieval ?? undefined })
    },
    onError: (_error, capture) => {
      if (isCurrent(capture)) setState({ capture, status: 'error', hits: [] })
    },
    onSettled: (_result, _error, capture) => { if (pending.current === capture) pending.current = null },
  })
  const view = projectWorkbenchSelection(selection)
  const sourceBlockers = view.selection_origin === 'local' ? selectedSourceBlockers(view.source_version_ids, currentSources()) : []
  const scopeAvailable = view.supported && view.selection_origin === 'local' && view.source_version_ids.length > 0
  const retrievalReady = semanticOptionsAllowed(queryClient, notebookId, view.source_version_ids, latest.current.retrieval)
  const ready = retrievalReady && !!context?.ready && authPhase === 'authenticated' && sessionCoordinator.resourcePhase() === 'authenticated'
  const currentState = state?.capture.generation === generation ? state : null
  const status = currentState?.status ?? (state ? 'obsolete' : 'idle')
  // Generation changes must render even if React batches text A → B → A
  // into an unchanged final value; a ref-only fence would leave obsolete UI.
  const setQuery = (value: string) => { queryRef.current = value; changed(); setQueryState(value) }
  // Selection edits invalidate synchronously, before React's next render.
  const selectionChanged = (value: WorkspaceSelection | null) => { latest.current.selection = value; changed() }
  const retrievalChanged = (value: RetrievalOptions | undefined, generation?: number | (() => number)) => { latest.current.retrieval = value ? copyRetrievalOptions(value) : undefined; if (generation !== undefined) latest.current.retrievalGeneration = generation; changed() }
  const submit = () => {
    sync()
    const current = projectWorkbenchSelection(latest.current.selection)
    const liveContext = readTurnContext()
    if (!semanticOptionsAllowed(queryClient, latest.current.notebookId, current.source_version_ids, latest.current.retrieval) || pending.current || !queryRef.current.trim() || !current.supported || current.selection_origin !== 'local' || !current.source_version_ids.length || selectedSourceBlockers(current.source_version_ids, currentSources()).length > 0 || !liveContext?.ready || useAuthStore.getState().phase !== 'authenticated' || sessionCoordinator.resourcePhase() !== 'authenticated') return
    const capture: Capture = Object.freeze({
      generation: ++owner.current.generation, retrievalGeneration: readRetrievalGeneration(), notebookId: latest.current.notebookId, query: queryRef.current.trim(),
      versionIds: Object.freeze([...current.source_version_ids]),
      ...(latest.current.retrieval ? { options: copyRetrievalOptions(latest.current.retrieval) } : {}),
      context: Object.freeze({ ...liveContext, target: Object.freeze({ ...liveContext.target }) }),
    })
    pending.current = capture
    setState({ capture, status: 'loading', hits: [] })
    mutation.mutate(capture)
  }
  return {
    query, setQuery, selectionChanged, retrievalChanged, retrievalMode: latest.current.retrieval?.retrieval_mode ?? 'lexical', submit, scopeAvailable, ready, status, sourceBlockers,
    canSubmit: scopeAvailable && sourceBlockers.length === 0 && ready && !!query.trim() && status !== 'loading',
    hits: currentState?.hits ?? [], metadata: currentState?.metadata,
    // A retired result handler must also recheck live context at activation.
    isCurrent: () => !!currentState && currentState.status === 'success' && isCurrent(currentState.capture),
  }
}
