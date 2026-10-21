import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PortableControls } from './PortableControls'
import { portableApi } from '@/lib/api/portable'
vi.mock('@/lib/hooks/use-translation', async () => {
  const { workbenchEn } = await import('@/lib/locales/workbench')
  return { useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => key === 'workbench.packageTooLarge'
    ? workbenchEn.packageTooLarge.replace('{{bytes}}', values?.bytes || '').replace('{{limit}}', values?.limit || '') : key }) }
})
vi.mock('@/lib/api/portable', () => ({ portableApi: { limits: vi.fn(), restore: vi.fn(async () => ({ notebook_id: 'notebook:restored' })), export: vi.fn() } }))
const limits = { max_archive_bytes: 10, max_manifest_bytes: 50, multipart_overhead_bytes: 10, max_expanded_bytes: 100, max_entity_bytes: 80, max_request_bytes: 20, max_entries: 100, max_compression_ratio: 200 }
function setup(client = new QueryClient()) {
  render(<QueryClientProvider client={client}><PortableControls notebookId="notebook:1" onChanged={vi.fn()} /></QueryClientProvider>)
  fireEvent.click(screen.getByText('workbench.exportDetails'))
  return (size = 3) => {
    const file = new File(['x'.repeat(size)], 'project.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('workbench.restoreProject'), { target: { files: [file] } })
    return file
  }
}
const confirm = () => screen.getByRole('button', { name: 'common.confirm' })
describe('portable restore confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(portableApi.limits).mockResolvedValue(limits) })
  it('waits for actual limits without uploading', async () => {
    vi.mocked(portableApi.limits).mockReturnValue(new Promise(() => {}))
    setup()()
    expect(confirm()).toBeDisabled()
    expect(portableApi.limits).toHaveBeenCalledTimes(1)
    expect(portableApi.restore).not.toHaveBeenCalled()
  })
  it('blocks oversized archives but allows the exact server limit', async () => {
    const select = setup()
    select(11)
    expect(await screen.findByText('This package is 11 bytes; the server limit is 10 bytes. Choose a smaller package or ask the server administrator to increase the limit.')).toBeVisible()
    expect(confirm()).toBeDisabled()
    fireEvent.click(confirm())
    expect(portableApi.restore).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    const file = select(10)
    await waitFor(() => expect(confirm()).toBeEnabled())
    fireEvent.click(confirm())
    await waitFor(() => expect(portableApi.restore).toHaveBeenCalledWith(file))
  })
  it('fails closed on stale cached limits and retries only explicitly', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3, staleTime: Infinity } } })
    client.setQueryData(['personal', 'portable', 'limits'], limits)
    vi.mocked(portableApi.limits).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(limits)
    setup(client)()
    expect(confirm()).toBeDisabled()
    expect(await screen.findByText('workbench.portableLimitsError')).toBeVisible()
    expect(confirm()).toBeDisabled()
    expect(portableApi.limits).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'workbench.retry' }))
    expect(confirm()).toBeDisabled()
    await waitFor(() => expect(confirm()).toBeEnabled())
    expect(portableApi.limits).toHaveBeenCalledTimes(2)
    expect(portableApi.restore).not.toHaveBeenCalled()
  })
  it.each([0, -1, NaN, Infinity, undefined])('blocks invalid archive limit %s', async value => {
    vi.mocked(portableApi.limits).mockResolvedValue({ ...limits, max_archive_bytes: value } as typeof limits)
    setup()()
    expect(await screen.findByText('workbench.portableLimitsError')).toBeVisible()
    expect(confirm()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'workbench.retry' })).toBeEnabled()
  })
  it('blocks a refetch failure after a successful limits check', async () => {
    const client = new QueryClient()
    setup(client)()
    await waitFor(() => expect(confirm()).toBeEnabled())
    vi.mocked(portableApi.limits).mockRejectedValueOnce(new Error('offline'))
    await client.invalidateQueries({ queryKey: ['personal', 'portable', 'limits'] })
    expect(await screen.findByText('workbench.portableLimitsError')).toBeVisible()
    expect(confirm()).toBeDisabled()
    fireEvent.click(confirm())
    expect(portableApi.restore).not.toHaveBeenCalled()
  })
  it('clears cancellation and refetches on reopening', async () => {
    const select = setup()
    select()
    await waitFor(() => expect(confirm()).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(portableApi.restore).not.toHaveBeenCalled()
    vi.mocked(portableApi.limits).mockReturnValue(new Promise(() => {}))
    select()
    expect(confirm()).toBeDisabled()
    expect(portableApi.limits).toHaveBeenCalledTimes(2)
  })
  it('keeps backup actions and export scope in an accessible compact disclosure', () => {
    render(<QueryClientProvider client={new QueryClient()}><PortableControls notebookId="notebook:1" onChanged={vi.fn()} /></QueryClientProvider>)
    const disclosure = screen.getByText('workbench.exportDetails').closest('details')
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('workbench.exportDetails'))
    expect(screen.getByRole('button', { name: 'workbench.exportProject' })).toBeVisible()
    expect(screen.getByText('workbench.exportCoverage')).toBeVisible()
  })
  it('validates only after the selected package is confirmed and links the restored notebook', async () => {
    render(<QueryClientProvider client={new QueryClient()}><PortableControls notebookId="notebook:1" onChanged={vi.fn()} /></QueryClientProvider>)
    fireEvent.click(screen.getByText('workbench.exportDetails'))
    const file = new File(['zip'], 'project.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('workbench.restoreProject'), { target: { files: [file] } })
    expect(portableApi.restore).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('project.zip')
    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-lg')
    await waitFor(() => expect(confirm()).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => expect(portableApi.restore).toHaveBeenCalledWith(file))
    expect(await screen.findByRole('link', { name: 'workbench.restoredNotebook' })).toHaveAttribute('href', '/notebooks/notebook%3Arestored/study')
  })
})
