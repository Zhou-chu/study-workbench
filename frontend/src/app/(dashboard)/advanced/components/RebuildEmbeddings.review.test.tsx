import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { RebuildEmbeddings } from './RebuildEmbeddings'
import { embeddingApi } from '@/lib/api/embedding'

vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/api/embedding', () => ({ embeddingApi: { rebuildEmbeddings: vi.fn(), getRebuildStatus: vi.fn() } }))

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><RebuildEmbeddings /></QueryClientProvider>)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

it('review: remount while submission is pending follows the accepted command', async () => {
  const submission = deferred<Awaited<ReturnType<typeof embeddingApi.rebuildEmbeddings>>>()
  vi.mocked(embeddingApi.rebuildEmbeddings).mockReturnValue(submission.promise)
  vi.mocked(embeddingApi.getRebuildStatus).mockResolvedValue({command_id: 'command:late', status: 'running'})
  const first = mount()
  fireEvent.click(screen.getByRole('button', {name: 'advanced.rebuild.startBtn'}))
  await waitFor(() => expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(1))
  first.unmount()
  mount()
  expect(screen.getByRole('button', { name: 'advanced.rebuild.starting' })).toBeDisabled()
  await act(async () => submission.resolve({command_id: 'command:late', message: '', estimated_items: 1}))
  await waitFor(() => expect(embeddingApi.getRebuildStatus).toHaveBeenCalledWith('command:late'))
  expect(screen.queryByRole('button', { name: 'advanced.rebuild.startBtn' })).not.toBeInTheDocument()
  expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(1)
  cleanup()
  vi.mocked(embeddingApi.getRebuildStatus).mockResolvedValue({ command_id: 'command:late', status: 'completed' })
  mount()
  await screen.findByText('advanced.rebuild.completed')
})

it('publishes late uncertainty to the remounted view without replaying the pending request', async () => {
  const submission = deferred<Awaited<ReturnType<typeof embeddingApi.rebuildEmbeddings>>>()
  vi.mocked(embeddingApi.rebuildEmbeddings).mockReturnValue(submission.promise)
  const first = mount()
  fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
  await waitFor(() => expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(1))
  first.unmount()
  mount()
  expect(screen.getByRole('button', { name: 'advanced.rebuild.starting' })).toBeDisabled()
  await act(async () => submission.reject({ response: { status: 409, data: { detail: {
    code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'SECRET', resource_id: 'source:not-a-command'
  } } } }))
  await screen.findByText(/commandSubmission.warning/)
  expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
  expect(embeddingApi.getRebuildStatus).not.toHaveBeenCalled()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
  await waitFor(() => expect(confirm).toHaveBeenCalled())
  expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(1)
})
