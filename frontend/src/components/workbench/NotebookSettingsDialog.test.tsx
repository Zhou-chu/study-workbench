import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { notebooklmApi } from '@/lib/api/notebooklm'
import { projectWorkbenchSelection } from '@/lib/utils/workbench-read-model'
import { NotebookSettingsDialog } from './NotebookSettingsDialog'

vi.mock('@/lib/api/notebooklm', () => ({ notebooklmApi: { sync: vi.fn(), importSources: vi.fn(), associateSource: vi.fn(), audio: vi.fn() } }))
vi.mock('@/lib/hooks/use-notebooklm', () => ({
  useNotebookLMStatus: () => ({ data: { state: 'connected' } }),
  useNotebookLMCapabilities: () => ({ data: { operations: [{ name: 'generate_audio', support: 'available' }] } }),
  useNotebookLMFlow: () => ({}),
  useRemoteNotebooks: () => ({}),
  useRemoteSources: () => ({}),
  useRemoteArtifacts: () => ({}),
}))
const supported = { engine: 'notebooklm', selection_origin: 'local', source_version_ids: ['sv_known'], remote_source_ids: ['remote:known'] }
const unsupported = { ...supported, engine: { future: true } }
const scoped = ['workbench.syncSelected', 'workbench.importSelected', 'workbench.associateSource', 'workbench.audio']
function view(raw: unknown, client = new QueryClient()) {
  return <QueryClientProvider client={client}><NotebookSettingsDialog notebookId="notebook:synthetic" open onOpenChange={vi.fn()} selection={projectWorkbenchSelection(raw)} onSelectionChange={vi.fn()} link={{ remote_notebook_id: 'remote:synthetic' }} onChanged={vi.fn()} modelStatus="workbench.modelConfigured" connectionStatus="workbench.connectionStates.connected" /></QueryClientProvider>
}
function expectNoScopedWrites() {
  expect(notebooklmApi.sync).not.toHaveBeenCalled()
  expect(notebooklmApi.importSources).not.toHaveBeenCalled()
  expect(notebooklmApi.associateSource).not.toHaveBeenCalled()
  expect(notebooklmApi.audio).not.toHaveBeenCalled()
}
beforeEach(() => vi.clearAllMocks())

it.each([
  { ...supported, remote_source_ids: null },
  unsupported,
])('blocks scoped integration writes while retaining safe connection/listing and repair: %j', raw => {
  render(view(raw))
  expect(screen.getByLabelText('workbench.engine')).toBeEnabled()
  expect(screen.getByLabelText('workbench.scope')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'workbench.connect' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'workbench.loadRemoteSources' })).toBeEnabled()
  for (const name of scoped) {
    const button = screen.getByRole('button', { name })
    expect(button).toBeDisabled()
    fireEvent.click(button)
  }
  expect(screen.queryByRole('button', { name: 'common.confirm' })).not.toBeInTheDocument()
  expectNoScopedWrites()
})

it.each(scoped)('blocks %s when a supported selection becomes opaque while confirmation is open', name => {
  const client = new QueryClient()
  const page = render(view(supported, client))
  fireEvent.click(screen.getByRole('button', { name }))
  expect(screen.getByRole('button', { name: 'common.confirm' })).toBeEnabled()
  page.rerender(view(unsupported, client))
  const confirm = screen.getByRole('button', { name: 'common.confirm' })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expectNoScopedWrites()
})

it.each(scoped)('rechecks %s immediately before dispatch after an asynchronous mutation admission', async name => {
  let release!: () => void
  const admission = new Promise<void>(resolve => { release = resolve })
  const entered = vi.fn(() => admission)
  const client = new QueryClient({ defaultOptions: { mutations: { onMutate: entered, retry: false } } })
  const page = render(view(supported, client))
  fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
  await waitFor(() => expect(entered).toHaveBeenCalledTimes(1))
  page.rerender(view(unsupported, client))
  await act(async () => { release(); await admission })
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expectNoScopedWrites()
})

it.each(scoped)('blocks deferred %s when an opaque origin unmounts the panel', async name => {
  let release!: () => void
  const admission = new Promise<void>(resolve => { release = resolve })
  const entered = vi.fn(() => admission)
  const client = new QueryClient({ defaultOptions: { mutations: { onMutate: entered, retry: false } } })
  const page = render(view(supported, client))
  fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
  await waitFor(() => expect(entered).toHaveBeenCalledTimes(1))
  page.rerender(view({ ...supported, selection_origin: { future: true } }, client))
  await act(async () => { release(); await admission })
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expectNoScopedWrites()
})
