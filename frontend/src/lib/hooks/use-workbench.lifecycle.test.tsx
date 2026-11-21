import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workbenchApi } from '@/lib/api/workbench'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { WorkspaceSelection } from '@/lib/types/personal'
import { invalidateTurnContext, publishTurnTarget, suspendTurnTarget } from '@/lib/workbench/turn-context'
import { useSaveWorkbenchSelection } from './use-workbench'
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { workspace: vi.fn(), saveSelection: vi.fn() } }))
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
const selection: WorkspaceSelection = { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_old'], remote_source_ids: [], reading: { source_version_id: 'sv_old', page_index: 7 } }
function deferred() { let resolve!: (value?: unknown) => void; let reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function show(scope = structuredClone(selection)) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0 }, queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, ...renderHook(({ notebookId, scope }) => useSaveWorkbenchSelection(notebookId, scope), { initialProps: { notebookId: 'notebook:1', scope }, wrapper }) }
}
beforeEach(() => {
  vi.resetAllMocks(); invalidateTurnContext(); publishTurnTarget(target, true)
  sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
  vi.mocked(workbenchApi.saveSelection).mockResolvedValue({})
})
afterEach(() => { onlineManager.setOnline(true); vi.useRealTimers() })
describe('selection persistence feedback and ownership', () => {
  it.each(['privacy', 'target', 'auth', 'readiness', 'notebook'] as const)('retires queued dispatch and late acknowledgement after %s changes', async change => {
    const pending = deferred(); vi.mocked(workbenchApi.saveSelection).mockReturnValueOnce(pending.promise)
    const { result, rerender } = show()
    act(() => result.current.mutate(selection))
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.mutate({ ...selection, source_version_ids: ['sv_new'] })
      if (change === 'privacy') invalidateTurnContext()
      else if (change === 'target') publishTurnTarget({ ...target, apiBase: 'https://other.example/api' }, true)
      else if (change === 'auth') { sessionCoordinator.setPhase('reauth-required'); useAuthStore.setState({ phase: 'reauth-required' }); sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' }) }
      else if (change === 'readiness') { suspendTurnTarget(); publishTurnTarget(target, true) }
    })
    if (change === 'notebook') rerender({ notebookId: 'notebook:2', scope: selection })
    await act(async () => pending.resolve({}))
    await waitFor(() => expect(result.current.status).not.toBe('saving'))
    expect(result.current.status).not.toBe('saved'); expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1)
  })
  it.each(['notebook', 'privacy'] as const)('does not rebind a retained selection handler after %s changes', async change => {
    const { result, rerender } = show()
    const oldIntent = result.current.mutate
    if (change === 'notebook') rerender({ notebookId: 'notebook:2', scope: { ...selection, source_version_ids: ['sv_new'] } })
    else act(() => invalidateTurnContext())
    await act(async () => { oldIntent(selection); await Promise.resolve() })
    expect(workbenchApi.saveSelection).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
  it('does not pause an explicit mutation for hidden reconnect replay', async () => {
    onlineManager.setOnline(false); vi.mocked(workbenchApi.saveSelection).mockRejectedValue(new Error('offline'))
    const { result } = show(); act(() => result.current.mutate(selection))
    await waitFor(() => expect(result.current.status).toBe('unconfirmed'))
    act(() => onlineManager.setOnline(true)); expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1)
  })
})
