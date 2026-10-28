import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evidenceApi } from '@/lib/api/evidence'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { WorkspaceSelection } from '@/lib/types/personal'
import { invalidateTurnContext, publishTurnTarget, suspendTurnTarget } from '@/lib/workbench/turn-context'
import { useWorkbenchEvidenceSearch } from './use-workbench-evidence-search'

vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { search: vi.fn() } }))
type Result = Awaited<ReturnType<typeof evidenceApi.search>>
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
const selection: WorkspaceSelection = { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_old'], remote_source_ids: [] }
const hit = { evidence_id: 'ev:1', extraction_id: 'ex:1', source_version_id: 'sv_old', quote: 'Current evidence', locator: { page_index: 2 } }
const found: Result = { hits: [hit], retrieval_method: 'lexical' }
function deferred() { let resolve!: (value: Result) => void; let reject!: (error: unknown) => void; const promise = new Promise<Result>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function show(notebookId = 'notebook:1', scope = structuredClone(selection)) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 }, queries: { retry: false } } })
  return renderHook(({ notebookId, scope }) => useWorkbenchEvidenceSearch(notebookId, scope), {
    initialProps: { notebookId, scope },
    wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}
describe('explicit workbench evidence search ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks(); invalidateTurnContext(); publishTurnTarget(target, true)
    sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
    vi.mocked(evidenceApi.search).mockResolvedValue(found)
  })
  it('captures immutable trimmed query, exact ordered local IDs and context without a reading field', async () => {
    const scope = { ...selection, source_version_ids: ['sv_old', 'sv_new'], reading: { source_version_id: 'unselected', page_index: 3 } }
    const { result } = show('notebook:1', scope)
    act(() => { result.current.setQuery('  exact query  '); result.current.submit(); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
    const [query, ids, context] = vi.mocked(evidenceApi.search).mock.calls[0]
    expect(query).toBe('exact query'); expect(ids).toEqual(['sv_old', 'sv_new']); expect(ids).not.toBe(scope.source_version_ids)
    expect(Object.isFrozen(ids)).toBe(true); expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context?.target)).toBe(true)
    expect(context).toEqual({ ready: true, epoch: expect.any(Number), target })
    expect(result.current.hits).toEqual([hit]); expect(result.current.isCurrent()).toBe(true)
  })
  it.each(['query', 'scope', 'privacy', 'target', 'auth'] as const)('rejects %s invalidation before the queued mutation dispatch', async change => {
    const { result } = show()
    act(() => {
      result.current.setQuery('query'); result.current.submit()
      if (change === 'query') result.current.setQuery('other')
      else if (change === 'scope') result.current.selectionChanged({ ...selection, source_version_ids: ['sv_new'] })
      else if (change === 'privacy') invalidateTurnContext()
      else if (change === 'target') publishTurnTarget({ ...target, apiBase: 'https://other.example/api' }, true)
      else { sessionCoordinator.setPhase('reauth-required'); useAuthStore.setState({ phase: 'reauth-required' }) }
    })
    await act(async () => { await Promise.resolve() })
    expect(evidenceApi.search).not.toHaveBeenCalled()
    expect(result.current.hits).toEqual([])
  })
  it.each(['success', 'error'] as const)('does not restore a retired %s when query changes after completion', async outcome => {
    if (outcome === 'error') vi.mocked(evidenceApi.search).mockRejectedValue(new Error('private error'))
    const { result } = show()
    act(() => { result.current.setQuery('first'); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe(outcome))
    const activate = result.current.isCurrent
    act(() => { result.current.setQuery('second'); result.current.setQuery('first') })
    expect(result.current.status).toBe('obsolete'); expect(result.current.hits).toEqual([]); expect(activate()).toBe(false)
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
  it.each(['success', 'error'] as const)('does not let an older late %s overwrite a newer successful search', async oldOutcome => {
    const old = deferred(); const current = deferred()
    vi.mocked(evidenceApi.search).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const { result } = show()
    act(() => { result.current.setQuery('first'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    act(() => { result.current.setQuery('second'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(2))
    await act(async () => current.resolve(found))
    await waitFor(() => expect(result.current.status).toBe('success'))
    await act(async () => { if (oldOutcome === 'success') old.resolve({ hits: [{ ...hit, quote: 'Retired result' }], retrieval_method: 'lexical' }); else old.reject(new Error('Retired private error')) })
    expect(result.current.status).toBe('success'); expect(result.current.hits).toEqual([hit]); expect(result.current.isCurrent()).toBe(true)
  })
  it('does not let an older settlement unlock the current pending latch', async () => {
    const old = deferred(); const current = deferred()
    vi.mocked(evidenceApi.search).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const { result } = show()
    act(() => { result.current.setQuery('first'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    act(() => { result.current.setQuery('second'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(2))
    await act(async () => old.resolve(found))
    act(() => result.current.submit())
    expect(result.current.status).toBe('loading'); expect(evidenceApi.search).toHaveBeenCalledTimes(2)
    await act(async () => current.resolve(found))
  })
  it.each(['pending', 'completed'] as const)('invalidates notebook changes %s and cannot revive A on an A→B→A route', async phase => {
    const pending = deferred(); vi.mocked(evidenceApi.search).mockReturnValue(pending.promise)
    const { result, rerender } = show()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    if (phase === 'completed') { await act(async () => pending.resolve(found)); await waitFor(() => expect(result.current.status).toBe('success')) }
    rerender({ notebookId: 'notebook:2', scope: selection }); rerender({ notebookId: 'notebook:1', scope: selection })
    if (phase === 'pending') await act(async () => pending.resolve(found))
    expect(result.current.status).toBe('obsolete'); expect(result.current.hits).toEqual([])
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
  it('keeps pending search current across reading-only changes', async () => {
    const pending = deferred(); vi.mocked(evidenceApi.search).mockReturnValue(pending.promise)
    const { result, rerender } = show()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    rerender({ notebookId: 'notebook:1', scope: { ...selection, reading: { source_version_id: 'sv_other', page_index: 42, evidence_id: 'ev_other' } } })
    expect(result.current.status).toBe('loading')
    await act(async () => pending.resolve(found))
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.hits).toEqual([hit]); expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
  it.each(['scope', 'origin', 'readiness', 'privacy'] as const)('rejects an old result activation synchronously on %s A→B→A', async change => {
    const { result } = show()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    const activate = result.current.isCurrent
    act(() => {
      if (change === 'scope') { result.current.selectionChanged({ ...selection, source_version_ids: ['sv_new'] }); result.current.selectionChanged(selection) }
      else if (change === 'origin') { result.current.selectionChanged({ ...selection, selection_origin: 'remote' }); result.current.selectionChanged(selection) }
      else if (change === 'readiness') { suspendTurnTarget(); publishTurnTarget(target, true) }
      else invalidateTurnContext()
      expect(activate()).toBe(false)
    })
    expect(result.current.status).toBe('obsolete'); expect(result.current.hits).toEqual([])
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
  it('does not dispatch a paused search automatically when reconnecting', async () => {
    onlineManager.setOnline(false)
    try {
      vi.mocked(evidenceApi.search).mockRejectedValue(new Error('offline'))
      const { result } = show()
      act(() => { result.current.setQuery('query'); result.current.submit() })
      await waitFor(() => expect(result.current.status).toBe('error'))
      act(() => onlineManager.setOnline(true))
      expect(evidenceApi.search).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('error')
    } finally { onlineManager.setOnline(true) }
  })
  it('cannot activate or settle search results after unmount', async () => {
    const pending = deferred(); vi.mocked(evidenceApi.search).mockReturnValue(pending.promise)
    const { result, unmount } = show()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    const activate = result.current.isCurrent
    unmount(); await act(async () => pending.resolve(found))
    expect(activate()).toBe(false); expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
})
