import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { PortableControls } from './PortableControls'
import { portableApi } from '@/lib/api/portable'
vi.mock('@/lib/api/portable', () => ({ portableApi: { restore: vi.fn(async () => ({ notebook_id: 'notebook:restored' })), export: vi.fn() } }))
describe('portable restore confirmation', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    await waitFor(() => expect(portableApi.restore).toHaveBeenCalledWith(file))
    expect(await screen.findByRole('link', { name: 'workbench.restoredNotebook' })).toHaveAttribute('href', '/notebooks/notebook%3Arestored/study')
  })
})
