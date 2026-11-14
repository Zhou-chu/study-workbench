import { useEffect, useReducer, useRef } from 'react'
import { asRequestNotDispatchedError, isAuthRecoveryError, assertResourceDispatch, assertTurnDispatch, RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workbenchApi } from '@/lib/api/workbench'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { projectWorkbenchSelection, projectWorkbenchVersion } from '@/lib/utils/workbench-read-model'
import type { WorkbenchSelection, WorkspaceSelection } from '@/lib/types/personal'
import { isKnownEngine, isKnownSelectionOrigin } from '@/lib/utils/workbench'
import { readTurnContext, subscribeTurnContext, type TurnContext } from '@/lib/workbench/turn-context'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useToast } from './use-toast'
import { useTranslation } from './use-translation'

export const activeJob = (state?: string) => ['queued', 'running', 'waiting_remote'].includes(state || '')
export function useWorkbench(notebookId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.workbench(notebookId), queryFn: () => workbenchApi.workspace(notebookId), retry: false,
    refetchInterval: (query) => {
      if (isAuthRecoveryError(query.state.error)) return false
      const data = query.state.data
      return data?.jobs?.some(job => activeJob(job.state)) || data?.sources?.some(source => source.versions.some(value => { const version = projectWorkbenchVersion(value); return ['queued', 'running', 'pending', 'extracting'].includes(version.status || version.extraction_status || '') })) ? 2000 : false
    },
  })
}
type SelectionCapture = Readonly<{ notebookId: string; boundary: number; generation: number; selection: WorkbenchSelection; context: TurnContext }>
type SelectionFeedback = { notebookId: string; boundary: number; generation: number; status: 'saving' | 'saved' | 'unconfirmed'; unconfirmed: boolean; notDispatched: boolean; signature: string }

/** Local feedback only: the component owns its draft; Query data stays untouched. */
export function useSaveWorkbenchSelection(notebookId: string, selection: WorkspaceSelection | null) {
  const { toast } = useToast()
  const { t } = useTranslation()
  const latest = useRef({ notebookId, selection })
  latest.current = { notebookId, selection }
  const owner = useRef({ fingerprint: '', boundary: 0, generation: 0 })
  const feedback = useRef<SelectionFeedback | null>(null)
  const mounted = useRef(false)
  const [, render] = useReducer(value => value + 1, 0)
  const sync = () => {
    const fingerprint = JSON.stringify([latest.current.notebookId, readTurnContext(), useAuthStore.getState().phase, sessionCoordinator.resourcePhase(), sessionCoordinator.current()])
    if (fingerprint !== owner.current.fingerprint) owner.current = { ...owner.current, fingerprint, boundary: owner.current.boundary + 1 }
    return owner.current.boundary
  }
  const boundary = sync()
  // Ownership is independent of readiness/support: current local edits may
  // still be retained with unsent feedback while persistence is unavailable.
  const ownsIntent = () => mounted.current && notebookId === latest.current.notebookId && boundary === sync()
  const changed = () => { const before = owner.current.boundary; if (sync() !== before) render() }
  const changedRef = useRef(changed)
  changedRef.current = changed
  useEffect(() => {
    mounted.current = true
    const unsubscribeContext = subscribeTurnContext(() => changedRef.current())
    const unsubscribeAuth = useAuthStore.subscribe(() => changedRef.current())
    return () => { mounted.current = false; owner.current.boundary++; unsubscribeContext(); unsubscribeAuth() }
  }, [])
  const available = () => {
    const context = readTurnContext()
    return !!context?.ready && useAuthStore.getState().phase === 'authenticated' && sessionCoordinator.resourcePhase() === 'authenticated'
  }
  // A queued intent may outlive a privacy/authentication transition, even an
  // A → B → A transition batched into one React render. Never rebind it.
  const dispatchable = (capture: SelectionCapture) => {
    if (!mounted.current || sync() !== capture.boundary || capture.notebookId !== latest.current.notebookId || !available()) return false
    try { assertTurnDispatch(capture.context); assertResourceDispatch(); return true } catch { return false }
  }
  const current = (capture: SelectionCapture) => dispatchable(capture) && capture.generation === owner.current.generation
  const mutation = useMutation({
    mutationFn: (capture: SelectionCapture) => {
      if (!dispatchable(capture)) throw new RequestNotDispatchedError('superseded')
      return workbenchApi.saveSelection(capture.notebookId, capture.selection, capture.context)
    },
    scope: { id: `workbench-selection:${notebookId}` }, retry: false, networkMode: 'always',
    onSuccess: (_result, capture) => {
      if (!current(capture)) return
      feedback.current = { ...feedback.current!, status: 'saved', unconfirmed: false, notDispatched: false }
    },
    onError: (error, capture) => {
      if (!current(capture)) return
      feedback.current = { ...feedback.current!, status: 'unconfirmed', unconfirmed: true, notDispatched: !!asRequestNotDispatchedError(error) }
      toast({ title: t('workbench.selectionUnconfirmed'), variant: 'destructive' })
    },
  })
  const mutate = (value: WorkspaceSelection) => {
    // Retained reader/settings callbacks cannot rebind an old UI intent.
    if (!ownsIntent()) return
    latest.current.selection = value
    const liveBoundary = sync()
    const view = projectWorkbenchSelection(value)
    const signature = JSON.stringify([view.supported, view.engine, view.selection_origin, view.source_version_ids, view.remote_source_ids, view.reading])
    const previous = feedback.current
    if (previous?.boundary === liveBoundary && previous.status === 'saving' && previous.signature === signature) return
    const generation = ++owner.current.generation
    const unconfirmed = !!previous && (previous.unconfirmed || previous.boundary !== liveBoundary)
    feedback.current = { notebookId: latest.current.notebookId, boundary: liveBoundary, generation, signature, status: 'unconfirmed', unconfirmed: true, notDispatched: true }
    if (!view.supported || !isKnownEngine(view.engine) || !isKnownSelectionOrigin(view.selection_origin) || !available()) { render(); return }
    // Snapshot only supported write fields, including reading; do not replace
    // or normalize the opaque workspace cache. Capture before entering scope.
    const dto: WorkbenchSelection = { engine: view.engine, selection_origin: view.selection_origin, source_version_ids: [...view.source_version_ids], remote_source_ids: [...view.remote_source_ids], reading: view.reading ? { ...view.reading } : null }
    Object.freeze(dto.source_version_ids); Object.freeze(dto.remote_source_ids)
    if (dto.reading) Object.freeze(dto.reading)
    Object.freeze(dto)
    const context = readTurnContext()!
    const capture: SelectionCapture = Object.freeze({ notebookId: latest.current.notebookId, boundary: liveBoundary, generation, selection: dto, context: Object.freeze({ ...context, target: Object.freeze({ ...context.target }) }) })
    feedback.current = { ...feedback.current, status: 'saving', unconfirmed, notDispatched: false }
    render()
    mutation.mutate(capture)
  }
  const state = feedback.current?.notebookId === notebookId ? feedback.current : null
  const retired = !!state && state.boundary !== boundary
  const status = retired ? 'unconfirmed' : state?.status ?? 'idle'
  const view = projectWorkbenchSelection(selection)
  const ready = available()
  const canRetry = status === 'unconfirmed' && view.supported && ready
  const retry = () => {
    sync()
    const state = feedback.current
    const view = projectWorkbenchSelection(latest.current.selection)
    if (!state || state.notebookId !== latest.current.notebookId || (state.boundary === owner.current.boundary && state.status !== 'unconfirmed') || !view.supported || !available() || !latest.current.selection) return
    mutate(latest.current.selection)
  }
  return { ownsIntent, mutate, retry, status, unconfirmed: retired || !!state?.unconfirmed, notDispatched: !retired && !!state?.notDispatched, canRetry, ready }
}
export function useWorkbenchAction<T>(notebookId: string, action: () => Promise<T>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  return useMutation({ mutationFn: action, retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) }),
    onError: () => toast({ title: t('workbench.error'), variant: 'destructive' }),
  })
}
