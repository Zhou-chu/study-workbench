import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { GeneratePodcastDialog } from './GeneratePodcastDialog'
import { podcastsApi } from '@/lib/api/podcasts'
import { NotebookSelection } from './generate-podcast-selection'

const { showToast, notebooks } = vi.hoisted(() => ({ showToast: vi.fn(), notebooks: [{ id: 'notebook:test', name: 'Notebook' }] }))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast: showToast }) }))
vi.mock('@/lib/hooks/use-notebooks', () => ({ useNotebooks: () => ({ data: notebooks, isLoading: false }) }))
vi.mock('@/lib/api/podcasts', () => ({ podcastsApi: {
  listEpisodeProfiles: vi.fn().mockResolvedValue([{ id: 'profile:test', name: 'Test profile', speaker_config: 'speaker:test', speaker_config_name: 'Speaker' }]),
  generatePodcast: vi.fn(),
} }))
vi.mock('@/lib/api/sources', () => ({ sourcesApi: { list: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/api/notes', () => ({ notesApi: { list: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/api/chat', () => ({ chatApi: { buildContext: vi.fn().mockResolvedValue({ context: { text: 'Selected context' }, token_count: 2, char_count: 16 }) } }))
vi.mock('./ContentSelectionPanel', () => ({ ContentSelectionPanel: ({ onSourceModeChange, selections }: {
  onSourceModeChange: (notebook: string, source: string, mode: 'full') => void,
  selections: Record<string, NotebookSelection>,
}) => <>
  <button onClick={() => onSourceModeChange('notebook:test', 'source:test', 'full')}>Select context</button>
  <output aria-label="context selection">{selections['notebook:test']?.sources['source:test'] ?? 'off'}</output>
</> }))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: React.PropsWithChildren<{ onValueChange: (value: string) => void; value: string }>) => (
    <select aria-label="profile" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectValue: () => <option value="">Choose</option>,
  SelectContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children, value }: React.PropsWithChildren<{ value: string }>) => <option value={value}>{children}</option>,
}))

async function fillDraft() {
  await screen.findByRole('option', { name: 'Test profile' })
  fireEvent.change(screen.getByLabelText('profile'), { target: { value: 'profile:test' } })
  fireEvent.change(screen.getByLabelText('podcasts.episodeName'), { target: { value: 'My retained title' } })
  fireEvent.change(screen.getByLabelText('podcasts.additionalInstructions'), { target: { value: 'My retained instructions' } })
  fireEvent.click(screen.getByRole('button', { name: 'Select context' }))
}

function tree(open: boolean, onOpenChange: (value: boolean) => void, client: QueryClient) {
  return <QueryClientProvider client={client}><GeneratePodcastDialog open={open} onOpenChange={onOpenChange} /></QueryClientProvider>
}

describe('podcast uncertain submission dialog', () => {
  it('retains the draft on close/reopen and gates remounted new attempts without contradictory messages', async () => {
    const api = vi.mocked(podcastsApi.generatePodcast)
    const unknown = { response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'private-provider-secret',
    } } } }
    let reject!: (error: unknown) => void
    api.mockRejectedValue(unknown)
    api.mockReturnValueOnce(new Promise((_, rejectPromise) => { reject = rejectPromise }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onOpenChange = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const view = render(tree(true, onOpenChange, client))
    await fillDraft()
    fireEvent.click(screen.getByRole('button', { name: 'podcasts.generate' }))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    view.rerender(tree(false, onOpenChange, client))
    await act(async () => reject(unknown))
    view.rerender(tree(true, onOpenChange, client))
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
    expect(showToast.mock.calls[0][0].title).toBe('commandSubmission.title')
    expect(JSON.stringify(showToast.mock.calls)).not.toMatch(/private-provider-secret|generationFailed|failedToStartGeneration|tryAgainMoment|common.success/)
    expect(onOpenChange).not.toHaveBeenCalledWith(true)
    expect(screen.getByLabelText('podcasts.episodeName')).toHaveValue('My retained title')
    expect(screen.getByLabelText('podcasts.additionalInstructions')).toHaveValue('My retained instructions')
    expect(screen.getByLabelText('context selection')).toHaveTextContent('full')
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    view.rerender(tree(false, onOpenChange, client))
    view.rerender(tree(true, onOpenChange, client))
    expect(screen.getByLabelText('podcasts.episodeName')).toHaveValue('My retained title')
    expect(screen.getByLabelText('podcasts.additionalInstructions')).toHaveValue('My retained instructions')
    expect(screen.getByLabelText('context selection')).toHaveTextContent('full')
    view.unmount()
    render(tree(true, onOpenChange, client))
    await fillDraft()
    fireEvent.click(screen.getByRole('button', { name: 'podcasts.generate' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('commandSubmission.newAttemptConfirm'))
    expect(api).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'podcasts.generate' })).toBeEnabled())
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'podcasts.generate' }))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    confirm.mockRestore()
  })
})
