import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotebookLMPanel } from './NotebookLMPanel'
import { notebooklmApi } from '@/lib/api/notebooklm'
vi.mock('@/lib/api/notebooklm', () => ({ notebooklmApi: {
  status: vi.fn(), capabilities: vi.fn(), notebooks: vi.fn(), sources: vi.fn(), sync: vi.fn(), link: vi.fn(), connect: vi.fn(), audio: vi.fn(), importSources: vi.fn(),
} }))
const props = { notebookId: 'notebook:1', selectedVersionIds: ['sv_exact'], remoteSourceIds: [], link: { remote_notebook_id: 'remote1' }, onRemoteSelection: vi.fn(), onChanged: vi.fn() }
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } } })}><NotebookLMPanel {...props} /></QueryClientProvider>) }
describe('NotebookLM explicit actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(notebooklmApi.status).mockResolvedValue({ state: 'connected', quota: null, account_label: 'account' } as never)
    vi.mocked(notebooklmApi.capabilities).mockResolvedValue({ operations: [{ name: 'upload_source', support: 'available' }] } as never)
    vi.mocked(notebooklmApi.sync).mockResolvedValue({ job_id: 'j1', state: 'queued' } as never)
  })
  it('does not silently upload selected local sources when rendered', async () => {
    show()
    await screen.findByText('workbench.connectionStates.connected')
    expect(notebooklmApi.sync).not.toHaveBeenCalled()
    expect(screen.getByText('workbench.quotaUnknown')).toBeInTheDocument()
  })
  it('confirms the exact target and explicit version snapshot before syncing', async () => {
    show()
    await screen.findByText('workbench.connectionStates.connected')
    fireEvent.click(screen.getByRole('button', { name: 'workbench.syncSelected' }))
    expect(notebooklmApi.sync).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('remote1')
    expect(screen.getByRole('dialog')).toHaveTextContent('sv_exact')
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => expect(notebooklmApi.sync).toHaveBeenCalledWith('notebook:1', expect.objectContaining({ remote_notebook_id: 'remote1', source_version_ids: ['sv_exact'], idempotency_key: expect.any(String) })))
  })
  it('does not replay a Google write after an uncertain network failure', async () => {
    vi.mocked(notebooklmApi.sync).mockRejectedValueOnce(new Error('network timeout'))
    show()
    await screen.findByText('workbench.connectionStates.connected')
    fireEvent.click(screen.getByRole('button', { name: 'workbench.syncSelected' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await screen.findByRole('alert')
    expect(notebooklmApi.sync).toHaveBeenCalledTimes(1)
  })

})
