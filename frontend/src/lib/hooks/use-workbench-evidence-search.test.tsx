import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evidenceApi } from '@/lib/api/evidence'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useWorkbench } from './use-workbench'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { Workspace, WorkspaceSelection } from '@/lib/types/personal'
import { invalidateTurnContext, publishTurnTarget, suspendTurnTarget } from '@/lib/workbench/turn-context'
import { useWorkbenchEvidenceSearch } from './use-workbench-evidence-search'

vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { workspace: vi.fn() } }))
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { search: vi.fn() } }))
type Result = Awaited<ReturnType<typeof evidenceApi.search>>
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
const selection: WorkspaceSelection = { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_old'], remote_source_ids: [] }
const hit = { evidence_id: 'ev:1', extraction_id: 'ex:1', source_version_id: 'sv_old', quote: 'Current evidence', locator: { page_index: 2 } }
const found: Result = { hits: [hit], retrieval_method: 'lexical' }
function deferred() { let resolve!: (value: Result) => void; let reject!: (error: unknown) => void; const promise = new Promise<Result>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const readySources = (scope: WorkspaceSelection): Workspace['sources'] => [{ source_id: 'source:fixture', title: 'Fixture', versions: (scope.source_version_ids as string[]).map(source_version_id => ({ source_version_id, status: 'ready' })) }]
function show(notebookId = 'notebook:1', scope = structuredClone(selection)) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 }, queries: { retry: false } } })
  const initialProps: { notebookId: string; scope: WorkspaceSelection; sources?: Workspace['sources'] } = { notebookId, scope }
  return renderHook(({ notebookId, scope, sources }) => useWorkbenchEvidenceSearch(notebookId, scope, sources ?? readySources(scope)), {
    initialProps,
    wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}
function showCached() {
  const notebookId = 'notebook:cached'
  const scope = { ...selection, source_version_ids: ['sv_new', 'sv_old'] }
  const workspace: Workspace = { notebook: { id: notebookId, name: 'Cache fixture' }, sources: readySources(scope), selection: scope, notes: [], turns: [], jobs: [], link: null }
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } })
  const key = QUERY_KEYS.workbench(notebookId)
  client.setQueryData(key, workspace)
  return { client, key, workspace, ...renderHook(() => {
    const observed = useWorkbench(notebookId).data
    return useWorkbenchEvidenceSearch(notebookId, observed?.selection ?? null, observed?.sources)
  }, { wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) }
}
describe('explicit workbench evidence search ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks(); invalidateTurnContext(); publishTurnTarget(target, true)
    sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
    vi.mocked(evidenceApi.search).mockResolvedValue(found)
  })
  it('checks authoritative workspace-cache readiness before observer delivery at activation', async () => {
    const { result, client, key, workspace } = showCached()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    const activate = result.current.isCurrent
    const blocked = structuredClone(workspace); blocked.sources[0].versions[1].status = 'empty'
    let active: boolean | undefined
    act(() => { client.setQueryData(key, blocked); active = activate() })
    expect(active).toBe(false)
    await waitFor(() => expect(result.current.sourceBlockers.map(item => item.versionId)).toEqual(['sv_old']))
    expect(result.current.hits).toEqual([])
  })
  it.each(['pending', 'completed'] as const)('retires %s results across authoritative workspace-cache ABA without intermediate observer renders', async phase => {
    const pending = deferred(); vi.mocked(evidenceApi.search).mockReturnValueOnce(pending.promise).mockResolvedValue(found)
    const { result, client, key, workspace } = showCached()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    if (phase === 'completed') { await act(async () => pending.resolve(found)); await waitFor(() => expect(result.current.status).toBe('success')) }
    const activate = result.current.isCurrent
    const blocked = structuredClone(workspace); blocked.sources[0].versions[1].status = 'empty'
    act(() => { client.setQueryData(key, blocked); client.setQueryData(key, structuredClone(workspace)) })
    if (phase === 'pending') await act(async () => pending.resolve(found))
    await waitFor(() => expect(result.current.status).toBe('obsolete'))
    expect(result.current.hits).toEqual([]); expect(activate()).toBe(false)
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
    act(() => result.current.submit())
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(evidenceApi.search).toHaveBeenCalledTimes(2)
    expect(vi.mocked(evidenceApi.search).mock.calls[1][1]).toEqual(['sv_new', 'sv_old'])
  })
  it.each(['submit', 'queued dispatch'] as const)('blocks %s against authoritative cached readiness before observer delivery', async phase => {
    const { result, client, key, workspace } = showCached()
    const blocked = structuredClone(workspace); blocked.sources[0].versions[1].status = 'queued'
    act(() => {
      result.current.setQuery('query')
      if (phase === 'queued dispatch') result.current.submit()
      client.setQueryData(key, blocked)
      if (phase === 'submit') result.current.submit()
    })
    await act(async () => { await Promise.resolve() })
    expect(evidenceApi.search).not.toHaveBeenCalled()
    expect(result.current.canSubmit).toBe(false)
    act(() => client.setQueryData(key, workspace))
    await waitFor(() => expect(result.current.canSubmit).toBe(true))
    expect(evidenceApi.search).not.toHaveBeenCalled()
  })
  it('retires results if the authoritative workspace cache is removed and restored before observer delivery', async () => {
    const { result, client, key, workspace } = showCached()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    const activate = result.current.isCurrent
    let active: boolean | undefined
    act(() => {
      client.removeQueries({ queryKey: key, exact: true })
      active = activate()
      client.setQueryData(key, workspace)
    })
    expect(active).toBe(false)
    expect(result.current.status).toBe('obsolete'); expect(result.current.hits).toEqual([])
    expect(activate()).toBe(false); expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
  it('does not retire results for unselected-source, other-notebook or non-workspace cache updates', async () => {
    const { result, client, key, workspace } = showCached()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    const activate = result.current.isCurrent
    const unrelated = structuredClone(workspace); unrelated.sources[0].versions.push({ source_version_id: 'unselected', status: 'failed' })
    act(() => {
      client.setQueryData(key, unrelated)
      client.setQueryData(QUERY_KEYS.workbench('notebook:other'), { ...workspace, sources: [] })
      client.setQueryData(['unrelated-readiness-probe'], { sources: [] })
      expect(activate()).toBe(true)
    })
    expect(result.current.status).toBe('success'); expect(result.current.hits).toEqual([hit])
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
  })
  it('readiness_blocks_submit_and_deferred_dispatch', async () => {
    const scope = { ...selection, source_version_ids: ['sv_new', 'sv_old'] }
    const blocked = readySources(scope)
    blocked[0].versions[1].status = 'queued'
    const { result, rerender } = show('notebook:1', scope)
    rerender({ notebookId: 'notebook:1', scope, sources: blocked })
    act(() => { result.current.setQuery('query'); result.current.submit() })
    expect(result.current.ready).toBe(true)
    expect(result.current.canSubmit).toBe(false)
    expect(result.current.sourceBlockers.map(item => item.versionId)).toEqual(['sv_old'])
    await act(async () => { await Promise.resolve() })
    expect(evidenceApi.search).not.toHaveBeenCalled()
    rerender({ notebookId: 'notebook:1', scope, sources: readySources(scope) })
    expect(result.current.canSubmit).toBe(true)
    expect(evidenceApi.search).not.toHaveBeenCalled()
    act(() => { result.current.submit(); rerender({ notebookId: 'notebook:1', scope, sources: blocked }) })
    await act(async () => { await Promise.resolve() })
    expect(evidenceApi.search).not.toHaveBeenCalled()
    rerender({ notebookId: 'notebook:1', scope, sources: readySources(scope) })
    expect(evidenceApi.search).not.toHaveBeenCalled()
    act(() => result.current.submit())
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
    expect(vi.mocked(evidenceApi.search).mock.calls[0][1]).toEqual(['sv_new', 'sv_old'])
  })
  it.each(['pending', 'completed'] as const)('readiness_aba_retires_hits: %s', async phase => {
    const pending = deferred(); vi.mocked(evidenceApi.search).mockReturnValue(pending.promise)
    const { result, rerender } = show()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(evidenceApi.search).toHaveBeenCalledTimes(1))
    if (phase === 'completed') { await act(async () => pending.resolve(found)); await waitFor(() => expect(result.current.status).toBe('success')) }
    const activate = result.current.isCurrent
    const blocked = readySources(selection); blocked[0].versions[0].status = 'empty'
    rerender({ notebookId: 'notebook:1', scope: selection, sources: blocked })
    expect(activate()).toBe(false)
    rerender({ notebookId: 'notebook:1', scope: selection, sources: readySources(selection) })
    if (phase === 'pending') await act(async () => pending.resolve(found))
    expect(result.current.status).toBe('obsolete'); expect(result.current.hits).toEqual([]); expect(activate()).toBe(false)
    expect(evidenceApi.search).toHaveBeenCalledTimes(1)
    act(() => result.current.submit())
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(evidenceApi.search).toHaveBeenCalledTimes(2)
  })
  it('keeps results for unrelated readiness changes but retires a duplicate selected identity', async () => {
    const { result, rerender } = show()
    act(() => { result.current.setQuery('query'); result.current.submit() })
    await waitFor(() => expect(result.current.status).toBe('success'))
    const sources = readySources(selection)
    sources[0].versions.push({ source_version_id: 'unselected', status: 'failed' })
    rerender({ notebookId: 'notebook:1', scope: selection, sources })
    expect(result.current.isCurrent()).toBe(true)
    rerender({ notebookId: 'notebook:1', scope: selection, sources: [...sources, ...readySources(selection)] })
    expect(result.current.hits).toEqual([]); expect(result.current.canSubmit).toBe(false)
    expect(result.current.sourceBlockers[0].reason).toBe('ambiguous')
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
