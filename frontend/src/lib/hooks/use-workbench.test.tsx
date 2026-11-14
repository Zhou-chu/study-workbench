import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workbenchApi } from '@/lib/api/workbench'
import { RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { WorkspaceSelection } from '@/lib/types/personal'
import { invalidateTurnContext, publishTurnTarget, readTurnContext, suspendTurnTarget } from '@/lib/workbench/turn-context'
import { useSaveWorkbenchSelection, useWorkbench } from './use-workbench'
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
  it('captures complete immutable selection and context before the serial queue, without mutating read data', async () => {
    const a = deferred(); const b = deferred()
    vi.mocked(workbenchApi.saveSelection).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const raw = structuredClone(selection); const { result } = show(raw)
    act(() => result.current.mutate(raw))
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1))
    const next = { ...raw, source_version_ids: ['sv_new'], reading: { source_version_id: 'sv_new', page_index: 9 } }
    act(() => result.current.mutate(next))
    expect(result.current.status).toBe('saving')
    next.source_version_ids.push('later'); next.reading.page_index = 99
    expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1)
    await act(async () => a.resolve({}))
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2))
    const [notebookId, dto, context] = vi.mocked(workbenchApi.saveSelection).mock.calls[1]
    expect(notebookId).toBe('notebook:1')
    expect(dto).toEqual({ engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_new'], remote_source_ids: [], reading: { source_version_id: 'sv_new', page_index: 9 } })
    expect(context).toEqual(readTurnContext()); expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context?.target)).toBe(true)
    expect(raw).toEqual(selection)
    await act(async () => b.resolve({}))
    await waitFor(() => expect(result.current.status).toBe('saved'))
  })
  it.each([['error', 'success', 'saved'], ['success', 'error', 'unconfirmed']] as const)('keeps latest B feedback when A is %s and B is %s', async (oldOutcome, latestOutcome, expected) => {
    const a = deferred(); const b = deferred()
    vi.mocked(workbenchApi.saveSelection).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const { result } = show()
    act(() => result.current.mutate(selection))
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1))
    act(() => result.current.mutate({ ...selection, source_version_ids: ['sv_new'] }))
    await act(async () => { if (oldOutcome === 'error') a.reject(new Error('private old failure')); else a.resolve({}) })
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2))
    expect(result.current.status).toBe('saving'); expect(result.current.unconfirmed).toBe(false)
    await act(async () => { if (latestOutcome === 'error') b.reject(new Error('private latest failure')); else b.resolve({}) })
    await waitFor(() => expect(result.current.status).toBe(expected))
    expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2)
  })
  it('retains unconfirmed feedback through an explicit synchronous-safe retry of the latest complete selection', async () => {
    const retry = deferred()
    vi.mocked(workbenchApi.saveSelection).mockRejectedValueOnce(new Error('outcome unknown')).mockReturnValueOnce(retry.promise)
    const { result, rerender } = show()
    act(() => result.current.mutate(selection))
    await waitFor(() => expect(result.current.status).toBe('unconfirmed'))
    expect(result.current.notDispatched).toBe(false)
    const latest = { ...selection, source_version_ids: ['sv_new'], reading: { source_version_id: 'sv_old', page_index: 12 } }
    const retryLatest = result.current.retry
    rerender({ notebookId: 'notebook:1', scope: latest })
    act(() => { retryLatest(); retryLatest() })
    expect(result.current.status).toBe('saving'); expect(result.current.unconfirmed).toBe(true)
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2))
    expect(vi.mocked(workbenchApi.saveSelection).mock.calls[1][1]).toEqual(latest)
    await act(async () => retry.resolve({}))
    await waitFor(() => expect(result.current.status).toBe('saved'))
    expect(result.current.unconfirmed).toBe(false)
  })
  it.each([[new RequestNotDispatchedError('authentication'), true], [{ name: 'RequestNotDispatchedError', reason: 'authentication', not_dispatched: true }, false]] as const)('uses only locally branded evidence for an unsent attempt (%s)', async (error, notDispatched) => {
    vi.mocked(workbenchApi.saveSelection).mockRejectedValue(error)
    const { result } = show()
    act(() => result.current.mutate(selection))
    await waitFor(() => expect(result.current.status).toBe('unconfirmed'))
    expect(result.current.notDispatched).toBe(notDispatched)
    expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1)
  })
  it('does not acknowledge an unsupported latest draft or retry a formerly supported payload', async () => {
    const pending = deferred(); vi.mocked(workbenchApi.saveSelection).mockReturnValueOnce(pending.promise)
    const { result, rerender } = show()
    act(() => result.current.mutate(selection))
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1))
    const unsupported = { ...selection, engine: 'future-engine' }
    act(() => result.current.mutate(unsupported)); rerender({ notebookId: 'notebook:1', scope: unsupported })
    await act(async () => pending.resolve({}))
    expect(result.current.status).toBe('unconfirmed'); expect(result.current.canRetry).toBe(false)
    act(() => result.current.retry())
    expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1)
  })
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
it('preserves existing active-workspace read polling across ordinary refresh errors without replaying writes', async () => {
  vi.useFakeTimers()
  const cached = { notebook: { id: 'notebook:1', name: 'Cached' }, selection, sources: [], notes: [], turns: [], jobs: [{ job_id: 'j', state: 'queued' }], link: null }
  vi.mocked(workbenchApi.workspace).mockResolvedValue(cached as never).mockResolvedValueOnce(cached as never).mockRejectedValueOnce(new Error('refresh failed'))
  const client = new QueryClient(); const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useWorkbench('notebook:1'), { wrapper })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(result.current.data).toEqual(cached); expect(result.current.isRefetchError).toBe(false)
  await act(async () => { await result.current.refetch(); await vi.advanceTimersByTimeAsync(10) })
  expect(result.current.data).toEqual(cached); expect(result.current.isRefetchError).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(2010) })
  expect(result.current.isRefetchError).toBe(false); expect(workbenchApi.workspace).toHaveBeenCalledTimes(3)
  expect(workbenchApi.saveSelection).not.toHaveBeenCalled()
})
