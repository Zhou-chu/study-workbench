import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('Rebuild submission safety', () => {
  it('retains the accepted command gate before first status, on status errors, and across remount until terminal', async () => {
    const firstStatus = deferred<Awaited<ReturnType<typeof embeddingApi.getRebuildStatus>>>()
    vi.mocked(embeddingApi.rebuildEmbeddings).mockResolvedValue({ command_id: 'command:accepted', message: '', estimated_items: 2 })
    vi.mocked(embeddingApi.getRebuildStatus).mockReturnValue(firstStatus.promise)
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(embeddingApi.getRebuildStatus).toHaveBeenCalledWith('command:accepted'))
    expect(screen.queryByRole('button', { name: 'advanced.rebuild.startBtn' })).not.toBeInTheDocument()
    await act(async () => firstStatus.reject(new Error('SECRET status failure')))
    expect(screen.getByText('commandSubmission.observing')).toBeInTheDocument()
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    view.unmount()
    vi.mocked(embeddingApi.getRebuildStatus).mockRejectedValue(new Error('SECRET'))
    const restored = mount()
    expect(screen.queryByRole('button', { name: 'advanced.rebuild.startBtn' })).not.toBeInTheDocument()
    await waitFor(() => expect(embeddingApi.getRebuildStatus).toHaveBeenCalledTimes(2))
    expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(1)
    restored.unmount()
    vi.mocked(embeddingApi.getRebuildStatus).mockResolvedValue({ command_id: 'command:accepted', status: 'completed' })
    mount()
    await waitFor(() => expect(screen.getByText('advanced.rebuild.completed')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' })).toBeEnabled()
  })

  it('keeps definite validation failure localized and available for correction', async () => {
    vi.mocked(embeddingApi.rebuildEmbeddings).mockRejectedValue({ response: { status: 422, data: { detail: 'SECRET validation' } } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(screen.getByText('advanced.rebuild.failed')).toBeInTheDocument())
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' })).toBeEnabled()
  })

  it('preserves uncertainty on remount and requires explicit cost acknowledgement before a new attempt', async () => {
    const unknown = { response: { status: 409, data: { detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'SECRET', resource_id: 'source:not-a-job' } } } }
    vi.mocked(embeddingApi.rebuildEmbeddings).mockRejectedValue(unknown)
    const first = mount()
    fireEvent.click(screen.getByRole('checkbox', { name: 'common.notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(screen.getByText(/commandSubmission.warning/)).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'common.notes' })).not.toBeChecked()
    expect(embeddingApi.rebuildEmbeddings).toHaveBeenLastCalledWith(expect.objectContaining({ include_notes: false }))
    expect(screen.queryByText('advanced.rebuild.failed')).not.toBeInTheDocument()
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    expect(embeddingApi.getRebuildStatus).not.toHaveBeenCalled()
    first.unmount()
    mount()
    expect(screen.getByText(/commandSubmission.warning/)).toBeInTheDocument()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('commandSubmission.newAttemptConfirm'))
    expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' })).toBeEnabled())
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(2))
    expect(embeddingApi.getRebuildStatus).not.toHaveBeenCalled()
  })

  it('observes only a genuinely supplied command ID and remains gated until its terminal status', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const terminal = deferred<Awaited<ReturnType<typeof embeddingApi.getRebuildStatus>>>()
    vi.mocked(embeddingApi.rebuildEmbeddings).mockRejectedValue({ response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'SECRET',
      command_id: 'command:acknowledged', resource_id: 'source:separate'
    } } } })
    vi.mocked(embeddingApi.getRebuildStatus).mockReturnValue(terminal.promise)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(embeddingApi.getRebuildStatus).toHaveBeenCalledWith('command:acknowledged'))
    expect(screen.queryByRole('button', { name: 'advanced.rebuild.startBtn' })).not.toBeInTheDocument()
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    await act(async () => terminal.resolve({ command_id: 'command:acknowledged', status: 'failed', error_message: 'SECRET provider detail' }))
    expect(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' })).toBeEnabled()
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
  })
})
