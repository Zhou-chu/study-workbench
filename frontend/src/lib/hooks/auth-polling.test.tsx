import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNotebookLMFlow } from './use-notebooklm'
import { usePodcastEpisodes } from './use-podcasts'
import { useWorkbench } from './use-workbench'
import { useSourceStatus } from './use-sources'
import { notebooklmApi } from '@/lib/api/notebooklm'
import { podcastsApi } from '@/lib/api/podcasts'
import { workbenchApi } from '@/lib/api/workbench'
import { sourcesApi } from '@/lib/api/sources'
vi.mock('@/lib/api/notebooklm', () => ({ notebooklmApi: { flow: vi.fn() } }))
vi.mock('@/lib/api/podcasts', () => ({ podcastsApi: { listEpisodes: vi.fn() } }))
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { workspace: vi.fn() } }))
vi.mock('@/lib/api/sources', () => ({ sourcesApi: { status: vi.fn() } }))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
describe('auth-aware explicit query intervals', () => {
  it.each(['flow', 'podcast', 'workspace', 'source'] as const)('pauses %s polling on app expiry and resumes only on explicit read revalidation', async kind => {
    const api = { flow: notebooklmApi.flow, podcast: podcastsApi.listEpisodes, workspace: workbenchApi.workspace, source: sourcesApi.status }[kind]
    const data = { flow: { state: 'awaiting_user_login' }, podcast: [{ id: 'ep1', job_status: 'running' }], workspace: { jobs: [{ state: 'running' }], sources: [] }, source: { status: 'running' } }[kind]
    vi.mocked(api).mockResolvedValue(data as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = { flow: function useFlow() { return useNotebookLMFlow('flow1') }, podcast: function useEpisodes() { return usePodcastEpisodes() }, workspace: function useWorkspace() { return useWorkbench('notebook1') }, source: function useStatus() { return useSourceStatus('source1') } }[kind]
    vi.useFakeTimers()
    const { unmount } = renderHook(hook as () => unknown, { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(api).toHaveBeenCalledTimes(1)
    expect(client.getQueryCache().getAll()[0].state.status).toBe('success')
    vi.mocked(api).mockRejectedValueOnce({ response: { status: 401, data: { error: { code: 'ACCESS_EXPIRED' } } } })
    await act(async () => { await client.refetchQueries() })
    expect(client.getQueryCache().getAll()[0].state.status).toBe('error')
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(api).toHaveBeenCalledTimes(2)
    await act(async () => { await client.refetchQueries() })
    expect(api).toHaveBeenCalledTimes(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(3)
    unmount(); client.clear()
  })
})
