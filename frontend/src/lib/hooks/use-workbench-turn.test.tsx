import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnOperationProvider } from '@/components/providers/TurnOperationProvider'
import { workbenchApi } from '@/lib/api/workbench'
import { RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { invalidateTurnContext, publishTurnTarget, suspendTurnTarget } from '@/lib/workbench/turn-context'
import { useWorkbenchTurn } from './use-workbench-turn'
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { turn: vi.fn(), turns: vi.fn(), workspace: vi.fn(), job: vi.fn() } }))
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
const input = () => ({ sessionId: 'session', owner: { mountId: 'mount', questionRevision: 1 }, available: true,
  request: { notebook_id: 'notebook', task: 'question' as const, engine: 'independent' as const, selection_origin: 'local' as const, source_version_ids: ['v2', 'v1'], remote_source_ids: [], remote_notebook_id: null, message: 'Original' } })
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3, staleTime: Infinity }, mutations: { retry: 3 } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><TurnOperationProvider>{children}</TurnOperationProvider></QueryClientProvider>
  return { client, ...renderHook(() => useWorkbenchTurn('notebook', { independentAvailable: true, googleAvailable: true, googleLink: null }), { wrapper }) }
}
beforeEach(() => {
  vi.resetAllMocks(); invalidateTurnContext(); publishTurnTarget(target, true)
  sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
  vi.mocked(workbenchApi.workspace).mockResolvedValue({ notebook: { id: 'notebook' }, jobs: [], turns: [] } as never)
  vi.mocked(workbenchApi.turns).mockResolvedValue([])
})
describe('document-owned turn interactions', () => {
  it('latches mixed submissions and explicit retries synchronously, retains the exact emitted DTO and never uses mutation cache', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValue(new Error('Lost ACK'))
    const { result, client } = setup(); const original = input()
    act(() => { result.current.submit(original); result.current.submit({ ...input(), request: { ...input().request, task: 'outline' } }) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('unknown'))
    expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(workbenchApi.turn).mock.calls[0]
    original.request.message = 'Edited'; original.request.source_version_ids.reverse()
    act(() => { result.current.retryOriginal(); result.current.retryOriginal() })
    await waitFor(() => expect(result.current.operation?.postAttempts).toBe(2))
    expect(workbenchApi.turn).toHaveBeenCalledTimes(2)
    expect(vi.mocked(workbenchApi.turn).mock.calls[1]).toEqual(sent)
    expect(sent[1]).toMatchObject({ message: 'Original', source_version_ids: ['v2', 'v1'] })
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })
  it('forces a fresh tagged read on every explicit check despite infinite default staleTime and never submits on auth/focus/refetch', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValue(new Error('Lost ACK'))
    const { result, client } = setup()
    act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('unknown'))
    for (let n = 1; n <= 2; n++) {
      act(() => { result.current.checkOriginal(); result.current.checkOriginal() })
      await waitFor(() => expect(result.current.operation?.busy).toBeNull())
      expect(workbenchApi.workspace).toHaveBeenCalledTimes(n)
      expect(workbenchApi.turns).toHaveBeenCalledTimes(n)
    }
    act(() => { suspendTurnTarget(); sessionCoordinator.setPhase('refresh-needed'); useAuthStore.setState({ phase: 'refresh-needed' }) })
    expect(result.current.ready).toBe(false)
    act(() => { publishTurnTarget(target, true); sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' }) })
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); await client.refetchQueries() })
    expect(result.current.ready).toBe(true)
    expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
    expect(workbenchApi.job).not.toHaveBeenCalled()
  })
  it('binds an HTTP 400 uncertainty receipt without clearing acceptance or ever permitting replay', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValue({ response: { status: 400, data: { detail: 'WORKER_UNAVAILABLE', dispatch_receipt: { dispatch_ack: 'unknown', retry_safe: false, job_id: 'parent', turn_id: 'turn' } } } })
    const { result } = setup()
    act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.receipt).toEqual({ jobId: 'parent', turnId: 'turn' }))
    act(() => { result.current.retryOriginal() })
    expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
    expect(result.current.acceptance).toBeNull()
  })
  it('allows abandon only for the first branded unsent attempt, not a later unsent retry after uncertainty', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValueOnce(new RequestNotDispatchedError('authentication'))
    const { result } = setup()
    act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('not-sent'))
    act(() => { result.current.abandonUnsent() })
    expect(result.current.operation).toBeNull()
    vi.mocked(workbenchApi.turn).mockRejectedValueOnce(new Error('Lost ACK'))
    act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('unknown'))
    vi.mocked(workbenchApi.turn).mockRejectedValueOnce(new RequestNotDispatchedError('authentication'))
    act(() => { result.current.retryOriginal() })
    await waitFor(() => expect(result.current.operation?.busy).toBeNull())
    act(() => { result.current.abandonUnsent() })
    expect(result.current.operation?.phase).toBe('unknown')
  })
  it('ignores late results after synchronous privacy invalidation and does not revive old answer data', async () => {
    let resolve!: (value: { job_id: string; turn_id: string; state: string }) => void
    vi.mocked(workbenchApi.turn).mockReturnValue(new Promise(done => { resolve = done }))
    const { result } = setup(); act(() => { result.current.submit(input()) })
    act(() => { invalidateTurnContext() })
    await act(async () => { resolve({ job_id: 'late', turn_id: 'late', state: 'queued' }) })
    expect(result.current.operation).toBeNull(); expect(result.current.acceptance).toBeNull()
    expect(result.current.completion).toBeNull(); expect(workbenchApi.turns).not.toHaveBeenCalled()
  })
})

describe('read-only recovery boundaries', () => {
  it('does not automatically check or poll a dispatch-unknown 2xx receipt even if its state says queued', async () => {
    vi.mocked(workbenchApi.turn).mockResolvedValue({ job_id: 'parent', turn_id: 'turn', state: 'queued', dispatch_receipt: { dispatch_ack: 'unknown', retry_safe: false, job_id: 'parent', turn_id: 'turn' } })
    const { result } = setup(); act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.busy).toBeNull())
    expect(result.current.acceptance).toBeNull(); expect(workbenchApi.workspace).not.toHaveBeenCalled()
    expect(result.current.operation?.receipt).toEqual({ jobId: 'parent', turnId: 'turn' })
    expect(result.current.replayAvailable).toBe(false)
  })
  it('binds a discovered parent despite history read failure; explicit repeated checks remain fresh and check-only', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValue(new Error('Lost ACK'))
    const { result } = setup(); act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('unknown'))
    const capture = result.current.operation!.capture
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ notebook: { id: 'notebook' }, jobs: [{ job_id: 'parent', turn_id: 'turn', notebook_id: 'notebook', chat_session_id: 'session', operation: 'chat', idempotency_key: capture.operationId, request_snapshot: { ...capture.dto, model_id: null }, state: 'succeeded', submission_state: 'confirmed' }] } as never)
    vi.mocked(workbenchApi.turns).mockRejectedValue(new Error('private raw read failure'))
    act(() => { result.current.checkOriginal() })
    await waitFor(() => expect(result.current.readFailed).toBe(true))
    expect(result.current.operation?.receipt).toEqual({ jobId: 'parent', turnId: 'turn' })
    expect(result.current.replayAvailable).toBe(false)
    act(() => { result.current.retryOriginal(); result.current.checkOriginal() })
    await waitFor(() => expect(result.current.operation?.busy).toBeNull())
    expect(workbenchApi.workspace).toHaveBeenCalledTimes(2); expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
  })
  it('rejects unsupported availability and over-budget requests before dispatch', () => {
    const { result } = setup()
    act(() => { result.current.submit({ ...input(), available: false }) })
    expect(result.current.rejection).toBe('invalid')
    act(() => { result.current.submit({ ...input(), request: { ...input().request, source_version_ids: ['x'.repeat(1_048_576)] } }) })
    expect(result.current.rejection).toBe('size'); expect(result.current.operation).toBeNull()
    expect(workbenchApi.turn).not.toHaveBeenCalled()
  })
  it.each([undefined, 'notebooklm'])('observed Google link A → B → missing → A never auto-replays with captured label %s', async label => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><TurnOperationProvider>{children}</TurnOperationProvider></QueryClientProvider>
    const initial = { independentAvailable: true, googleAvailable: true, googleLink: { remote_notebook_id: 'remote-A', connection_id: label } as { remote_notebook_id: string; connection_id?: string } | null }
    const { result, rerender } = renderHook(environment => useWorkbenchTurn('notebook', environment), { wrapper, initialProps: initial })
    vi.mocked(workbenchApi.turn).mockRejectedValue(new Error('Lost ACK'))
    act(() => { result.current.submit({ ...input(), googleConnectionId: label, request: { ...input().request, engine: 'notebooklm', remote_notebook_id: 'remote-A' } }) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('unknown'))
    const original = vi.mocked(workbenchApi.turn).mock.calls[0]
    rerender({ ...initial, googleLink: { remote_notebook_id: 'remote-B', connection_id: label } })
    expect(result.current.replayAvailable).toBe(false); act(() => { result.current.retryOriginal() })
    rerender({ ...initial, googleLink: null }); expect(result.current.replayAvailable).toBe(false)
    if (label) {
      rerender({ ...initial, googleLink: { remote_notebook_id: 'remote-A' } }); expect(result.current.replayAvailable).toBe(false)
    }
    rerender(initial); expect(result.current.replayAvailable).toBe(true)
    expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
    act(() => { result.current.retryOriginal() })
    await waitFor(() => expect(result.current.operation?.busy).toBeNull())
    expect(vi.mocked(workbenchApi.turn).mock.calls[1]).toEqual(original)
  })
  it('ignores a complete answer arriving after local privacy invalidation', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValue(new Error('Lost ACK'))
    const { result } = setup(); act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('unknown'))
    let finish!: (value: never) => void
    vi.mocked(workbenchApi.turns).mockReturnValue(new Promise(resolve => { finish = resolve }))
    act(() => { result.current.checkOriginal() })
    act(() => { invalidateTurnContext() })
    await act(async () => finish([{ turn_id: 'private', answer: 'private late answer' }] as never))
    expect(result.current.operation).toBeNull(); expect(result.current.turns).toEqual([]); expect(result.current.completion).toBeNull()
  })
})

describe('mounted known-active polling and new-request state', () => {
  it('polls only acknowledged known-active parents every two seconds while mounted', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(workbenchApi.turn).mockResolvedValue({ job_id: 'parent', turn_id: 'turn', state: 'queued' })
      vi.mocked(workbenchApi.workspace).mockImplementation(async () => ({ notebook: { id: 'notebook' }, jobs: [{ job_id: 'parent', turn_id: 'turn', operation: 'chat', state: 'running', notebook_id: 'notebook', chat_session_id: 'session', idempotency_key: vi.mocked(workbenchApi.turn).mock.calls[0][1].idempotency_key, request_snapshot: vi.mocked(workbenchApi.turn).mock.calls[0][1] }] }) as never)
      const { result, unmount } = setup()
      await act(async () => { result.current.submit(input()) })
      expect(workbenchApi.workspace).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
      expect(workbenchApi.workspace).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(workbenchApi.workspace).toHaveBeenCalledTimes(2)
      unmount()
      await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
      expect(workbenchApi.workspace).toHaveBeenCalledTimes(2)
      expect(workbenchApi.turn).toHaveBeenCalledTimes(1); expect(workbenchApi.job).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('does not carry an old read failure into a new operation after proven-unsent abandonment', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValueOnce(new RequestNotDispatchedError('authentication'))
    const { result } = setup(); act(() => { result.current.submit(input()) })
    await waitFor(() => expect(result.current.operation?.phase).toBe('not-sent'))
    vi.mocked(workbenchApi.workspace).mockRejectedValue(new Error('read failed'))
    act(() => { result.current.checkOriginal() })
    await waitFor(() => expect(result.current.readFailed).toBe(true))
    act(() => { result.current.abandonUnsent() })
    vi.mocked(workbenchApi.turn).mockReturnValue(new Promise(() => {}))
    act(() => { result.current.submit(input()) })
    expect(result.current.readFailed).toBe(false)
  })
})
