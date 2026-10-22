import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { SnapshotPromotionButton } from './SnapshotPromotionButton'
import { sourceSnapshotsApi } from '@/lib/api/source-snapshots'
import type { SourceSnapshotResult } from '@/lib/types/source-snapshots'

vi.mock('@/lib/api/source-snapshots', () => ({ sourceSnapshotsApi: { create: vi.fn() } }))
const result: SourceSnapshotResult = {
  source_id: 'source:snapshot', source_version_id: 'sv_snapshot', job_id: 'job_snapshot',
  status: 'ready', existing: false, embedding_status: 'not_requested',
  provenance: { kind: 'derived', origin_kind: 'note', origin_id: 'note:one', note_revision: 3, origin_title: 'A note', captured_at: '2026-10-22T00:00:00Z', content_sha256: 'a'.repeat(64), authorship: 'unknown', scope_snapshot: { source_version_ids: [] }, citations: [] },
}
const note = { kind: 'note', id: 'note:one', revision: 3 } as const
function setup(origin = note, onAdded = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const view = render(<SnapshotPromotionButton notebookId="notebook:one" origin={origin} onAdded={onAdded} />, { wrapper })
  return { ...view, onAdded, invalidate }
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('saved-material source snapshot action', () => {
  it('reconstructs the same idempotency key after an unknown acknowledgement and remount', async () => {
    vi.mocked(sourceSnapshotsApi.create).mockRejectedValueOnce(new Error('Lost acknowledgement')).mockResolvedValue({ ...result, existing: true })
    const firstView = setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    await screen.findByRole('alert')
    const originalRequest = vi.mocked(sourceSnapshotsApi.create).mock.calls[0]
    firstView.unmount()
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    await screen.findByRole('button', { name: 'sourceSnapshots.alreadyAdded' })
    expect(vi.mocked(sourceSnapshotsApi.create).mock.calls[1]).toEqual(originalRequest)
  })

  it('blocks duplicate clicks while the deterministic key is still hashing', async () => {
    let resolve!: (value: ArrayBuffer) => void
    vi.spyOn(webcrypto.subtle, 'digest').mockImplementationOnce(() => new Promise(done => { resolve = done }))
    vi.mocked(sourceSnapshotsApi.create).mockResolvedValue(result)
    setup()
    const button = screen.getByRole('button', { name: 'sourceSnapshots.add' })
    fireEvent.click(button); fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'sourceSnapshots.adding' })).toBeDisabled()
    expect(sourceSnapshotsApi.create).not.toHaveBeenCalled()
    expect(webcrypto.subtle.digest).toHaveBeenCalledTimes(1)
    await act(async () => resolve(new Uint8Array(32).buffer))
    await screen.findByRole('button', { name: 'sourceSnapshots.added' })
    expect(sourceSnapshotsApi.create).toHaveBeenCalledTimes(1)
  })

  it('snapshots the captured saved revision once and waits for a confirmed receipt', async () => {
    let resolve!: (value: SourceSnapshotResult) => void
    vi.mocked(sourceSnapshotsApi.create).mockImplementation(() => new Promise(done => { resolve = done }))
    const { onAdded, invalidate } = setup()
    const button = screen.getByRole('button', { name: 'sourceSnapshots.add' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(sourceSnapshotsApi.create).toHaveBeenCalledTimes(1))
    expect(sourceSnapshotsApi.create).toHaveBeenCalledWith('notebook:one', { origin_kind: 'note', note_id: 'note:one', expected_revision: 3, idempotency_key: expect.any(String) })
    expect(screen.getByRole('button', { name: 'sourceSnapshots.adding' })).toBeDisabled()
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.queryByText('sourceSnapshots.added')).not.toBeInTheDocument()
    await act(async () => resolve(result))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(result))
    expect(screen.getByRole('button', { name: 'sourceSnapshots.added' })).toBeDisabled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['personal', 'workspace', 'notebook:one'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sources'] })
  })

  it('does not automatically retry an unknown result and reuses the original request on manual retry', async () => {
    vi.mocked(sourceSnapshotsApi.create).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ ...result, existing: true })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('sourceSnapshots.unknownOutcome')
    expect(sourceSnapshotsApi.create).toHaveBeenCalledTimes(1)
    const first = vi.mocked(sourceSnapshotsApi.create).mock.calls[0]
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.retry' }))
    await screen.findByRole('button', { name: 'sourceSnapshots.alreadyAdded' })
    expect(sourceSnapshotsApi.create).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sourceSnapshotsApi.create).mock.calls[1]).toEqual(first)
  })

  it.each([
    [409, 'NOTE_REVISION_CONFLICT', 'conflict'],
    [409, 'SNAPSHOT_IDEMPOTENCY_CONFLICT', 'conflict'],
    [400, 'EMPTY_SNAPSHOT', 'empty'],
    [410, 'SNAPSHOT_UNAVAILABLE', 'failed'],
    [413, 'SNAPSHOT_TOO_LARGE', 'tooLarge'],
  ])('keeps a %s %s rejection visible without retrying the unchanged input', async (status, code, key) => {
    vi.mocked(sourceSnapshotsApi.create).mockRejectedValue({ response: { status, data: { detail: { code } } } })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('sourceSnapshots.' + key)
    expect(screen.queryByRole('button', { name: 'sourceSnapshots.retry' })).not.toBeInTheDocument()
    expect(sourceSnapshotsApi.create).toHaveBeenCalledTimes(1)
  })

  it('allows a not-ready result to be retried without changing its key', async () => {
    vi.mocked(sourceSnapshotsApi.create).mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: 'RESULT_NOT_READY' } } } }).mockResolvedValue(result)
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('sourceSnapshots.resultNotReady')
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.retry' }))
    await screen.findByRole('button', { name: 'sourceSnapshots.added' })
    expect(vi.mocked(sourceSnapshotsApi.create).mock.calls[1]).toEqual(vi.mocked(sourceSnapshotsApi.create).mock.calls[0])
  })

  it('uses the turn identity without inventing a note revision or client content', async () => {
    vi.mocked(sourceSnapshotsApi.create).mockResolvedValue(result)
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><SnapshotPromotionButton notebookId="notebook:one" origin={{ kind: 'turn', id: 'turn:one' }} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    await screen.findByRole('button', { name: 'sourceSnapshots.added' })
    expect(sourceSnapshotsApi.create).toHaveBeenCalledWith('notebook:one', { origin_kind: 'turn', turn_id: 'turn:one', idempotency_key: expect.any(String) })
  })

  it('isolates a late completion from a newer origin and restores the earlier operation on return', async () => {
    let resolve!: (value: SourceSnapshotResult) => void
    vi.mocked(sourceSnapshotsApi.create).mockImplementation(() => new Promise(done => { resolve = done }))
    const { rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    await waitFor(() => expect(sourceSnapshotsApi.create).toHaveBeenCalledTimes(1))
    rerender(<SnapshotPromotionButton notebookId="notebook:two" origin={{ kind: 'note', id: 'note:two', revision: 1 }} />)
    expect(screen.getByRole('button', { name: 'sourceSnapshots.add' })).toBeEnabled()
    await act(async () => resolve(result))
    expect(screen.getByRole('button', { name: 'sourceSnapshots.add' })).toBeEnabled()
    expect(screen.queryByText('sourceSnapshots.added')).not.toBeInTheDocument()
    rerender(<SnapshotPromotionButton notebookId="notebook:one" origin={note} />)
    expect(screen.getByRole('button', { name: 'sourceSnapshots.added' })).toBeDisabled()
  })

  it('retains an unknown request key when viewing another revision and returning', async () => {
    vi.mocked(sourceSnapshotsApi.create).mockRejectedValueOnce(new Error('Lost')).mockResolvedValue(result)
    const { rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.add' }))
    await screen.findByRole('alert')
    const original = vi.mocked(sourceSnapshotsApi.create).mock.calls[0]
    rerender(<SnapshotPromotionButton notebookId="notebook:one" origin={{ ...note, revision: 4 }} />)
    expect(screen.getByRole('button', { name: 'sourceSnapshots.add' })).toBeEnabled()
    rerender(<SnapshotPromotionButton notebookId="notebook:one" origin={note} />)
    fireEvent.click(screen.getByRole('button', { name: 'sourceSnapshots.retry' }))
    await screen.findByRole('button', { name: 'sourceSnapshots.added' })
    expect(vi.mocked(sourceSnapshotsApi.create).mock.calls[1]).toEqual(original)
  })
})
