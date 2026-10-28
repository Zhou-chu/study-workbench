'use client'

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation } from '@tanstack/react-query'
import { evidenceApi } from '@/lib/api/evidence'
import { assertResourceDispatch, assertTurnDispatch, RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { WorkspaceSelection } from '@/lib/types/personal'
import { projectWorkbenchSelection } from '@/lib/utils/workbench-read-model'
import { readTurnContext, subscribeTurnContext, type TurnContext } from '@/lib/workbench/turn-context'

type Result = Awaited<ReturnType<typeof evidenceApi.search>>
type Capture = Readonly<{ generation: number; notebookId: string; query: string; versionIds: readonly string[]; context: TurnContext }>
type SearchState = { capture: Capture; status: 'loading' | 'success' | 'empty' | 'error'; hits: Result['hits'] }
const serverContext = () => null

/** Explicit, document-local reads. Neither query observers nor reconnects submit searches. */
export function useWorkbenchEvidenceSearch(notebookId: string, selection: WorkspaceSelection | null) {
  const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, serverContext)
  const authPhase = useAuthStore(state => state.phase)
  const [query, setQueryState] = useState('')
  const queryRef = useRef('')
  const latest = useRef({ notebookId, selection })
  latest.current = { notebookId, selection }
  const owner = useRef({ fingerprint: '', generation: 0 })
  const pending = useRef<Capture | null>(null)
  const mounted = useRef(false)
  const [state, setState] = useState<SearchState | null>(null)
  const [, renderGeneration] = useReducer(value => value + 1, 0)

  const sync = () => {
    const view = projectWorkbenchSelection(latest.current.selection)
    // Reading position deliberately does not belong to the search scope.
    const fingerprint = JSON.stringify([latest.current.notebookId, queryRef.current, view.supported, view.engine, view.selection_origin, view.source_version_ids, view.remote_source_ids, readTurnContext(), useAuthStore.getState().phase, sessionCoordinator.resourcePhase()])
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
    return () => { mounted.current = false; pending.current = null; owner.current.generation++; unsubscribeContext(); unsubscribeAuth() }
  }, [])
  const isCurrent = (capture: Capture) => {
    if (!mounted.current || sync() !== capture.generation) return false
    try { assertTurnDispatch(capture.context); assertResourceDispatch() } catch { return false }
    return useAuthStore.getState().phase === 'authenticated'
  }
  const mutation = useMutation({
    retry: false, networkMode: 'always',
    mutationFn: (capture: Capture) => {
      if (!isCurrent(capture)) throw new RequestNotDispatchedError('superseded')
      return evidenceApi.search(capture.query, capture.versionIds, capture.context)
    },
    onSuccess: (result, capture) => {
      if (isCurrent(capture)) setState({ capture, status: result.hits.length ? 'success' : 'empty', hits: result.hits })
    },
    onError: (_error, capture) => {
      if (isCurrent(capture)) setState({ capture, status: 'error', hits: [] })
    },
    onSettled: (_result, _error, capture) => { if (pending.current === capture) pending.current = null },
  })
  const view = projectWorkbenchSelection(selection)
  const scopeAvailable = view.supported && view.selection_origin === 'local' && view.source_version_ids.length > 0
  const ready = !!context?.ready && authPhase === 'authenticated' && sessionCoordinator.resourcePhase() === 'authenticated'
  const currentState = state?.capture.generation === generation ? state : null
  const status = currentState?.status ?? (state ? 'obsolete' : 'idle')
  // Generation changes must render even if React batches text A → B → A
  // into an unchanged final value; a ref-only fence would leave obsolete UI.
  const setQuery = (value: string) => { queryRef.current = value; changed(); setQueryState(value) }
  // Selection edits invalidate synchronously, before React's next render.
  const selectionChanged = (value: WorkspaceSelection | null) => { latest.current.selection = value; changed() }
  const submit = () => {
    sync()
    const current = projectWorkbenchSelection(latest.current.selection)
    const liveContext = readTurnContext()
    if (pending.current || !queryRef.current.trim() || !current.supported || current.selection_origin !== 'local' || !current.source_version_ids.length || !liveContext?.ready || useAuthStore.getState().phase !== 'authenticated' || sessionCoordinator.resourcePhase() !== 'authenticated') return
    const capture: Capture = Object.freeze({
      generation: ++owner.current.generation, notebookId: latest.current.notebookId, query: queryRef.current.trim(),
      versionIds: Object.freeze([...current.source_version_ids]),
      context: Object.freeze({ ...liveContext, target: Object.freeze({ ...liveContext.target }) }),
    })
    pending.current = capture
    setState({ capture, status: 'loading', hits: [] })
    mutation.mutate(capture)
  }
  return {
    query, setQuery, selectionChanged, submit, scopeAvailable, ready, status,
    canSubmit: scopeAvailable && ready && !!query.trim() && status !== 'loading',
    hits: currentState?.hits ?? [],
    // A retired result handler must also recheck live context at activation.
    isCurrent: () => !!currentState && currentState.status === 'success' && isCurrent(currentState.capture),
  }
}
