import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGeneratePodcast, useRetryPodcastEpisode } from './use-podcasts'
import { useCreateSource, useRetrySource } from './use-sources'
import type { PodcastGenerationRequest } from '@/lib/types/podcasts'
import type { CreateSourceRequest } from '@/lib/types/api'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), retryPodcast: vi.fn(), createSource: vi.fn(), retrySource: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api/podcasts', () => ({ podcastsApi: { generatePodcast: mocks.generate, retryEpisode: mocks.retryPodcast } }))
vi.mock('@/lib/api/sources', () => ({ sourcesApi: { create: mocks.createSource, retry: mocks.retrySource } }))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
const error = { response: { status: 409, data: { detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'private-secret' } } } }
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('queue mutation guards', () => {
  beforeEach(() => vi.clearAllMocks())
  it('warns once and gates generation after remount until explicit new-attempt acknowledgment', async () => {
    mocks.generate.mockRejectedValue(error)
    const payload = {} as PodcastGenerationRequest
    const first = renderHook(useGeneratePodcast, { wrapper })
    await act(async () => { await expect(first.result.current.mutateAsync(payload)).rejects.toBe(error) })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'commandSubmission.title', description: 'commandSubmission.warning commandSubmission.sessionOnly' })
    expect(JSON.stringify(mocks.toast.mock.calls)).not.toContain('private-secret')
    first.unmount()
    const next = renderHook(useGeneratePodcast, { wrapper })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { await expect(next.result.current.mutateAsync(payload)).rejects.toBeDefined() })
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    mocks.generate.mockResolvedValue({ episode_name: 'new intentional attempt' })
    await act(async () => { await next.result.current.mutateAsync(payload) })
    expect(mocks.generate).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledWith('commandSubmission.newAttemptConfirm')
    confirm.mockRestore()
  })
  it('applies the same localized boundary to source creation and both retry hooks', async () => {
    mocks.createSource.mockRejectedValue(error)
    mocks.retrySource.mockRejectedValue(error)
    mocks.retryPodcast.mockRejectedValue(error)
    const source = renderHook(useCreateSource, { wrapper })
    const retry = renderHook(useRetrySource, { wrapper })
    const podcast = renderHook(useRetryPodcastEpisode, { wrapper })
    await act(async () => {
      await expect(source.result.current.mutateAsync({} as CreateSourceRequest)).rejects.toBe(error)
      await expect(retry.result.current.mutateAsync('source:unique')).rejects.toBe(error)
      await expect(podcast.result.current.mutateAsync('episode:unique')).rejects.toBe(error)
    })
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(3))
    for (const [toast] of mocks.toast.mock.calls) expect(toast).toEqual({ title: 'commandSubmission.title', description: 'commandSubmission.warning commandSubmission.sessionOnly' })
  })
})
