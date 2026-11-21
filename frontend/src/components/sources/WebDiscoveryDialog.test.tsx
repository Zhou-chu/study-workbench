import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebDiscoveryDialog } from './WebDiscoveryDialog'

const state = vi.hoisted(() => ({
  status: { data: { state: 'ready', configured: true } as { state: string; configured: boolean; access_mode?: 'api_key' | 'keyless_trial' | null }, isError: false, refetch: vi.fn() },
  search: vi.fn(), importSource: vi.fn(),
}))

vi.mock('@/lib/hooks/use-web-discovery', () => ({
  useWebSearchStatus: () => state.status,
  useWebSearch: () => ({ mutateAsync: state.search, isPending: false, reset: vi.fn() }),
  useImportWebSource: () => ({ mutateAsync: state.importSource }),
}))

const results = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `Source ${index}`, url: `https://example.com/${index}`, snippet: `Snippet ${index}`, domain: 'example.com' }))
const props = { notebookId: 'notebook:a', open: true, onOpenChange: vi.fn(), onImported: vi.fn() }

async function search() {
  fireEvent.change(screen.getByLabelText('webDiscovery.queryLabel'), { target: { value: 'Research topic' } })
  expect(state.search).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.search' }))
  await screen.findByText('Source 0')
}

describe('WebDiscoveryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.status = { data: { state: 'ready', configured: true }, isError: false, refetch: vi.fn() }
    state.search.mockResolvedValue({ results, total_count: 6, provider: 'firecrawl' })
    state.importSource.mockResolvedValue({ state: 'queued' })
  })

  it('shows real configuration-required state, not fake search results', () => {
    state.status.data = { state: 'configuration_required', configured: false }
    render(<WebDiscoveryDialog {...props} />)
    expect(screen.getByText('webDiscovery.configurationRequired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'webDiscovery.openSettings' })).toHaveAttribute('href', '/settings#web-search')
    expect(screen.getByRole('link', { name: 'webDiscovery.openSettings' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByText('webDiscovery.configurationHelp')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('webDiscovery.queryLabel')).not.toBeInTheDocument()
    expect(state.search).not.toHaveBeenCalled()
    expect(state.importSource).not.toHaveBeenCalled()
  })

  it('labels explicit ready trial mode and its privacy/quota boundary without automatic requests', () => {
    state.status.data = { state: 'ready', configured: true, access_mode: 'keyless_trial' }
    render(<WebDiscoveryDialog {...props} />)
    expect(screen.getByText('webDiscovery.trialMode')).toBeInTheDocument()
    expect(screen.getByText('webDiscovery.trialQuota')).toBeInTheDocument()
    expect(screen.getByText('webDiscovery.trialPrivacy')).toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.privacyNotice')).not.toBeInTheDocument()
    expect(state.search).not.toHaveBeenCalled()
    expect(state.importSource).not.toHaveBeenCalled()
  })

  it('does not present stale trial status as ready after a status error', () => {
    state.status.data = { state: 'ready', configured: true, access_mode: 'keyless_trial' }
    state.status.isError = true
    render(<WebDiscoveryDialog {...props} />)
    expect(screen.queryByText('webDiscovery.trialMode')).not.toBeInTheDocument()
    expect(screen.getByText('webDiscovery.statusUnavailable')).toBeInTheDocument()
  })

  it('requires explicit search and selection/import; previews plain text without remote images', async () => {
    render(<WebDiscoveryDialog {...props} />)
    await search()
    expect(screen.getByText('Snippet 0')).toBeInTheDocument()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(state.importSource).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source 0' }))
    expect(state.importSource).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await waitFor(() => expect(state.importSource).toHaveBeenCalledTimes(1))
    expect(state.importSource.mock.calls[0][0].notebookId).toBe('notebook:a')
    await screen.findByText('webDiscovery.imported')
  })

  it('bounds selections to five and in-flight imports to two; cancel stops undispatched items', async () => {
    const resolve: Array<(value: { state: string }) => void> = []
    state.importSource.mockImplementation(() => new Promise(done => resolve.push(done)))
    render(<WebDiscoveryDialog {...props} />)
    await search()
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('checkbox', { name: `Source ${index}` }))
    expect(screen.getByRole('checkbox', { name: 'Source 5' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await waitFor(() => expect(state.importSource).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.cancel' }))
    await act(async () => { resolve.forEach(done => done({ state: 'queued' })) })
    expect(state.importSource).toHaveBeenCalledTimes(2)
    expect(screen.getByText('webDiscovery.cancelled')).toBeInTheDocument()
  })

  it('keeps an unresolved idempotency key across close/reopen and retries local recovery explicitly', async () => {
    state.importSource.mockRejectedValueOnce({ response: { data: { detail: 'WEB_IMPORT_OUTCOME_UNKNOWN' } } }).mockResolvedValueOnce({ state: 'queued' })
    const view = render(<WebDiscoveryDialog {...props} />)
    await search()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await screen.findByText(/webDiscovery.errors.outcomeUnknown/)
    const firstKey = state.importSource.mock.calls[0][0].idempotencyKey
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.close' }))
    view.rerender(<WebDiscoveryDialog {...props} open={false} />)
    view.rerender(<WebDiscoveryDialog {...props} open />)
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await screen.findByText('webDiscovery.imported')
    expect(state.importSource.mock.calls[1][0].idempotencyKey).toBe(firstKey)
  })

  it('does not present saved-but-not-queued snapshots as successful imports', async () => {
    state.importSource.mockResolvedValue({ state: 'saved', warning: 'WEB_EXTRACTION_NOT_QUEUED' })
    render(<WebDiscoveryDialog {...props} />)
    await search()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await screen.findByText(/webDiscovery.partialNotice/)
    expect(screen.queryByText('webDiscovery.imported')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'webDiscovery.importSelected' })).toBeEnabled()
  })

  it('uses a fresh key only on explicit retry of a proven quota rejection', async () => {
    state.importSource.mockRejectedValueOnce({ response: { data: { detail: 'WEB_PROVIDER_RATE_LIMIT' } } }).mockResolvedValueOnce({ state: 'queued' })
    render(<WebDiscoveryDialog {...props} />)
    await search()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await screen.findByText(/webDiscovery.errors.rateLimit/)
    const firstKey = state.importSource.mock.calls[0][0].idempotencyKey
    expect(state.importSource).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await screen.findByText('webDiscovery.imported')
    expect(state.importSource.mock.calls[1][0].idempotencyKey).not.toBe(firstKey)
  })

  it('releases successful selections so a sixth result remains importable', async () => {
    render(<WebDiscoveryDialog {...props} />)
    await search()
    for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('checkbox', { name: `Source ${index}` }))
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.importSelected' }))
    await waitFor(() => expect(screen.getAllByText('webDiscovery.imported')).toHaveLength(5))
    expect(screen.getByRole('checkbox', { name: 'Source 5' })).toBeEnabled()
  })

  it('distinguishes provider failure from an empty search result', async () => {
    state.search.mockRejectedValue({ response: { data: { detail: 'WEB_PROVIDER_RATE_LIMIT' } } })
    render(<WebDiscoveryDialog {...props} />)
    fireEvent.change(screen.getByLabelText('webDiscovery.queryLabel'), { target: { value: 'Research topic' } })
    fireEvent.click(screen.getByRole('button', { name: 'webDiscovery.search' }))
    await screen.findByText('webDiscovery.errors.rateLimit')
    expect(screen.queryByText('webDiscovery.empty')).not.toBeInTheDocument()
  })
})
