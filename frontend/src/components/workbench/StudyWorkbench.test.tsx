import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace, TurnRecord, EvidenceCitation, WorkbenchNote } from '@/lib/types/personal'
import { StudyWorkbench } from './StudyWorkbench'
import { useNotebookLMStatus, useNotebookLMCapabilities } from '@/lib/hooks/use-notebooklm'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { evidenceApi } from '@/lib/api/evidence'
import { workbenchApi } from '@/lib/api/workbench'
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { evidence: vi.fn(), search: vi.fn() } }))
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { workspace: vi.fn(), saveSelection: vi.fn(), turn: vi.fn(), saveNote: vi.fn(), updateNote: vi.fn(), upload: vi.fn(), turns: vi.fn(), job: vi.fn() } }))
vi.mock('@/lib/hooks/use-models', () => ({ useModelDefaults: vi.fn(() => ({ data: { default_chat_model: 'model:test' } })) }))
vi.mock('@/lib/hooks/use-notebooklm', () => ({ useNotebookLMStatus: vi.fn(() => ({ data: { state: 'disconnected' } })), useNotebookLMCapabilities: vi.fn(() => ({ data: { operations: [{ name: 'ask', support: 'unsupported' }] } })) }))
vi.mock('@/components/integrations/NotebookLMPanel', () => ({ NotebookLMPanel: () => <div /> }))
vi.mock('@/components/workbench/JobsPanel', () => ({ JobsPanel: () => <div /> }))
vi.mock('@/components/workbench/PortableControls', () => ({ PortableControls: () => <div /> }))
vi.mock('@/components/evidence/EvidenceReader', () => ({ EvidenceReader: ({ sourceVersionId, initialPage, citation }: { sourceVersionId?: string; initialPage?: number; citation?: EvidenceCitation | null }) => <><div data-testid="reader-position">{sourceVersionId}:{initialPage}</div><p data-testid="reader-validity">{citation?.reference_validity}</p></> }))
const fixture: Workspace = {
  notebook: { id: 'notebook:1', name: 'Lecture notes' },
  sources: [{ source_id: 'source:1', title: 'My PDF', versions: [
    { source_id: 'source:1', sha256: 'old', byte_size: 3, created_at: '2026-10-17', source_version_id: 'sv_old', original_status: 'available', mime_type: 'application/pdf', status: 'ready' },
    { source_id: 'source:1', sha256: 'new', byte_size: 3, created_at: '2026-10-18', source_version_id: 'sv_new', original_status: 'available', mime_type: 'application/pdf', status: 'ready' },
  ] }], notes: [], turns: [], jobs: [], link: null,
  selection: { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_old'], remote_source_ids: [] },
}
const oldTurn: TurnRecord = { turn_id: 'turn1', engine: 'independent', message: 'Old question', answer: 'Old answer', citations: [{ citation_id: 'c1', kind: 'local_evidence', evidence_id: 'ev1', source_title: 'Old PDF', reference_validity: 'verified', source_version_id: 'sv_old', quote: 'evidence' }], scope_snapshot: { source_version_ids: ['sv_old'], remote_source_ids: [] } }
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } } })}><StudyWorkbench notebookId="notebook:1" /></QueryClientProvider>) }
describe('StudyWorkbench source snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useModelDefaults).mockReturnValue({ data: { default_chat_model: 'model:test' } } as never)
    vi.mocked(useNotebookLMStatus).mockReturnValue({ data: { state: 'disconnected' } } as never)
    vi.mocked(useNotebookLMCapabilities).mockReturnValue({ data: { operations: [{ name: 'ask', support: 'unsupported' }] } } as never)
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j1', operation: 'ask', state: 'queued' })
    vi.mocked(workbenchApi.workspace).mockResolvedValue(structuredClone(fixture))
    vi.mocked(workbenchApi.turns).mockResolvedValue([])
    vi.mocked(workbenchApi.turn).mockResolvedValue({ turn_id: 'new_turn', job_id: 'j1' })
  })
  it.each(['new', 'edit'] as const)('does not retarget the %s draft when an earlier save completes', async action => {
    const savedA: WorkbenchNote = { id: 'note:a', title: 'A', content: 'Draft A', citations: [], scope_snapshot: oldTurn.scope_snapshot }
    const existingC: WorkbenchNote = { ...savedA, id: 'note:c', title: 'C', content: 'Draft C' }
    let resolveSave!: (note: WorkbenchNote) => void
    vi.mocked(workbenchApi.saveNote).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), notes: [existingC] })
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'Draft A' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: action === 'new' ? 'common.new' : 'common.edit' }))
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'Current draft' } })
    await act(async () => resolveSave(savedA))
    expect(screen.getByLabelText('workbench.noteContent')).toHaveValue('Current draft')
    await waitFor(() => expect(screen.getByRole('button', { name: 'workbench.saveNote' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    if (action === 'new') {
      await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenCalledTimes(2))
      expect(workbenchApi.updateNote).not.toHaveBeenCalled()
      expect(workbenchApi.saveNote).toHaveBeenLastCalledWith('notebook:1', expect.objectContaining({ content: 'Current draft' }))
    } else {
      await waitFor(() => expect(workbenchApi.updateNote).toHaveBeenCalledWith('notebook:1', 'note:c', expect.objectContaining({ content: 'Current draft' })))
    }
  })
  it.each((['submission', 'history'] as const).flatMap(phase => (['new', 'edit', 'content', 'title'] as const).map(action => ({ phase, action }))))('preserves $action changes during pending outline $phase', async ({ phase, action }) => {
    const existing: WorkbenchNote = { id: 'note:c', title: 'Existing title', content: 'Existing content', citations: [], scope_snapshot: oldTurn.scope_snapshot }
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), notes: [existing] })
    let resolveSubmission!: (value: { turn_id: string; job_id: string }) => void
    let resolveHistory!: (value: TurnRecord[]) => void
    const submission = new Promise<{ turn_id: string; job_id: string }>(resolve => { resolveSubmission = resolve })
    const history = new Promise<TurnRecord[]>(resolve => { resolveHistory = resolve })
    vi.mocked(workbenchApi.turn).mockReturnValueOnce(submission)
    vi.mocked(workbenchApi.turns).mockReturnValue(history)
    const { unmount } = show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'Starting content' } })
    fireEvent.change(screen.getByLabelText('workbench.noteTitle'), { target: { value: 'Starting title' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.outline' }))
    await waitFor(() => expect(workbenchApi.turn).toHaveBeenCalledTimes(1))
    if (phase === 'history') await act(async () => resolveSubmission({ turn_id: 'new_turn', job_id: 'j1' }))
    if (action === 'new' || action === 'edit') fireEvent.click(screen.getByRole('button', { name: action === 'new' ? 'common.new' : 'common.edit' }))
    else fireEvent.change(screen.getByLabelText(action === 'content' ? 'workbench.noteContent' : 'workbench.noteTitle'), { target: { value: 'New unsaved text' } })
    const expectedContent = (screen.getByLabelText('workbench.noteContent') as HTMLTextAreaElement).value
    const expectedTitle = (screen.getByLabelText('workbench.noteTitle') as HTMLInputElement).value
    await act(async () => {
      resolveSubmission({ turn_id: 'new_turn', job_id: 'j1' })
      resolveHistory([{ ...oldTurn, turn_id: 'new_turn', answer: 'Generated outline' }])
    })
    await screen.findByText('Generated outline')
    expect(screen.getByLabelText('workbench.noteContent')).toHaveValue(expectedContent)
    expect(screen.getByLabelText('workbench.noteTitle')).toHaveValue(expectedTitle)
    expect(screen.getByRole('button', { name: 'workbench.saveAnswer' })).toBeEnabled()
    unmount()
  })
  it('does not attach a pending note save to a newly generated outline draft', async () => {
    let resolveSave!: (note: WorkbenchNote) => void
    vi.mocked(workbenchApi.saveNote).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    vi.mocked(workbenchApi.turns).mockResolvedValue([{ ...oldTurn, turn_id: 'new_turn', answer: 'Generated outline' }])
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'Earlier draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'workbench.outline' }))
    await waitFor(() => expect(screen.getByLabelText('workbench.noteContent')).toHaveValue('Generated outline'))
    await act(async () => resolveSave({ id: 'note:a', title: 'A', content: 'Earlier draft', citations: [] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'workbench.saveNote' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenLastCalledWith('notebook:1', expect.objectContaining({ content: 'Generated outline', citations: oldTurn.citations })))
    expect(workbenchApi.updateNote).not.toHaveBeenCalled()
  })
  it('keeps edits typed during creation and attaches the saved identity to that same draft', async () => {
    let resolveSave!: (note: WorkbenchNote) => void
    vi.mocked(workbenchApi.saveNote).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'First version' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'Newer version' } })
    await act(async () => resolveSave({ id: 'note:a', title: 'Saved title', content: 'First version', citations: [] }))
    expect(screen.getByLabelText('workbench.noteContent')).toHaveValue('Newer version')
    await waitFor(() => expect(screen.getByRole('button', { name: 'workbench.saveNote' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.updateNote).toHaveBeenCalledWith('notebook:1', 'note:a', expect.objectContaining({ content: 'Newer version' })))
  })
  it('does not attach an old notebook save to the editor after a keyed notebook switch', async () => {
    let resolveSave!: (note: WorkbenchNote) => void
    vi.mocked(workbenchApi.saveNote).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = (id: string) => <QueryClientProvider client={client}><StudyWorkbench key={id} notebookId={id} /></QueryClientProvider>
    const { rerender } = render(view('notebook:1'))
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'Old notebook draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenCalledTimes(1))
    rerender(view('notebook:2'))
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'New notebook draft' } })
    await act(async () => resolveSave({ id: 'note:a', title: 'A', content: 'Old notebook draft', citations: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveNote' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenLastCalledWith('notebook:2', expect.objectContaining({ content: 'New notebook draft' })))
    expect(workbenchApi.updateNote).not.toHaveBeenCalled()
  })
  it('supports arrow and Home/End navigation across mobile workspace tabs', async () => {
    show()
    await screen.findByText('Lecture notes')
    const conversation = screen.getByRole('tab', { name: 'workbench.conversation' })
    const sources = screen.getByRole('tab', { name: 'workbench.sources' })
    const notes = screen.getByRole('tab', { name: 'workbench.notes' })
    expect(conversation).toHaveAttribute('tabindex', '0')
    expect(sources).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(conversation, { key: 'ArrowRight' })
    expect(notes).toHaveAttribute('aria-selected', 'true')
    expect(notes).toHaveFocus()
    fireEvent.keyDown(notes, { key: 'Home' })
    expect(sources).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(sources, { key: 'End' })
    expect(notes).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(notes, { key: 'ArrowRight' })
    expect(sources).toHaveFocus()
    fireEvent.keyDown(sources, { key: 'ArrowLeft' })
    expect(notes).toHaveFocus()
  })
  it('restores a persisted historical version without silently selecting the newest version', async () => {
    show()
    expect(await screen.findByLabelText('My PDF · sv_old')).toBeChecked()
    expect(screen.getByLabelText('My PDF · sv_new')).not.toBeChecked()
  })
  it('submits the exact selected version snapshot and selected engine', async () => {
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Explain this' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.ask' }))
    await waitFor(() => expect(workbenchApi.turn).toHaveBeenCalledWith('v1_notebook:1', expect.objectContaining({ source_version_ids: ['sv_old'], engine: 'independent', message: 'Explain this', notebook_id: 'notebook:1', idempotency_key: expect.any(String) })))
  })
  it('keeps the full version ID accessible while visually truncating it under the source title', async () => {
    show()
    await screen.findByText('Lecture notes')
    expect(screen.getByTitle('sv_old')).toHaveClass('truncate')
    expect(screen.getByRole('checkbox', { name: 'My PDF · sv_old' })).toBeInTheDocument()
  })
  it('shows stored per-turn coverage and bounded-outline warnings beside the answer', async () => {
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [{ ...oldTurn, coverage: { selected_source_count: 30, retrieved_source_count: 3, evidence_count: 8 }, warnings: ['BOUNDED_OVERVIEW: selected excerpts'] }] })
    show()
    await screen.findByText('Old answer')
    expect(screen.getByText('workbench.coverageSummary')).toBeVisible()
    expect(screen.getByText('workbench.boundedOutline')).toBeVisible()
  })
  it.each([['unverified', 'unverified'], ['verified', 'verified'], [undefined, 'unverified']])('preserves search-hit validity %s without upgrading archive claims', async (validity, expected) => {
    const hit = { evidence_id: 'ev_archive', extraction_id: 'ex_archive', source_version_id: 'sv_old', locator: { page_index: 1 }, quote: 'Search evidence quote', reference_validity: validity }
    vi.mocked(evidenceApi.search).mockResolvedValue({ hits: [hit], retrieval_method: 'lexical' })
    vi.mocked(evidenceApi.evidence).mockResolvedValue(hit)
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.searchEvidence'), { target: { value: 'evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Search evidence quote' }))
    await waitFor(() => expect(screen.getByTestId('reader-validity')).toHaveTextContent(expected!))
  })
  it('never treats an empty selection as all sources', async () => {
    show()
    await screen.findByText('Lecture notes')
    fireEvent.click(screen.getByRole('button', { name: 'workbench.clearSelection' }))
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Explain this' } })
    expect(screen.getByRole('button', { name: 'workbench.ask' })).toBeDisabled()
    expect(workbenchApi.turn).not.toHaveBeenCalled()
  })
  it('saves answer content, citations and the original turn scope, not the current selection', async () => {
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [oldTurn], selection: { ...fixture.selection, source_version_ids: ['sv_new'] } })
    show()
    await screen.findByText('Old answer')
    fireEvent.click(screen.getByRole('button', { name: 'workbench.saveAnswer' }))
    await waitFor(() => expect(workbenchApi.saveNote).toHaveBeenCalledWith('notebook:1', expect.objectContaining({ content: 'Old answer', citations: oldTurn.citations, scope_snapshot: oldTurn.scope_snapshot })))
  })
  it('does not retry an uncertain chat submission automatically', async () => {
    vi.mocked(workbenchApi.turn).mockRejectedValue(new Error('network timeout'))
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Explain this' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.ask' }))
    await screen.findByText('workbench.answerFailure')
    expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
  })
  it('keeps each upload independent when one file fails', async () => {
    vi.mocked(workbenchApi.upload).mockRejectedValueOnce(new Error('bad PDF')).mockResolvedValueOnce({ source_id: 'source:2', source_version_id: 'sv2', job_id: 'job2' })
    show()
    await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.upload'), { target: { files: [new File(['bad'], 'bad.pdf'), new File(['good'], 'good.txt')] } })
    expect(await screen.findByText(/bad.pdf: workbench.uploadFailed/)).toBeInTheDocument()
    expect(await screen.findByText(/good.txt: workbench.uploadAccepted/)).toBeInTheDocument()
    expect(workbenchApi.upload).toHaveBeenCalledTimes(2)
    expect(vi.mocked(workbenchApi.upload).mock.calls[0][2]).not.toBe(vi.mocked(workbenchApi.upload).mock.calls[1][2])
  })

  it('resolves archived unverified citations against their immutable evidence before restoring page navigation', async () => {
    const imported = { ...oldTurn, citations: [{ ...oldTurn.citations[0], reference_validity: 'unverified', locator: { page_index: 7 } }] }
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [imported] })
    vi.mocked(evidenceApi.evidence).mockResolvedValue({ evidence_id: 'ev1', extraction_id: 'ex1', source_version_id: 'sv_old', locator: { page_index: 7 }, quote: 'evidence' })
    show()
    await screen.findByText('Old answer')
    fireEvent.click(screen.getByRole('button', { name: 'Old PDF · c1' }))
    await waitFor(() => expect(screen.getByTestId('reader-position')).toHaveTextContent('sv_old:7'))
  })

  it('restores a locator-bounded subquote to canonical physical page two without upgrading its label', async () => {
    const imported = { ...oldTurn, citations: [{ ...oldTurn.citations[0], citation_id: 'LOC_a_5', reference_validity: 'unverified', quote: '证据', locator: { page_index: 0, start_offset: 5, end_offset: 7 } }] }
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [imported] })
    vi.mocked(evidenceApi.evidence).mockResolvedValue({ evidence_id: 'ev1', extraction_id: 'ex1', source_version_id: 'sv_old', locator: { page_index: 1, block_id: 'page_0001', start_offset: 2, end_offset: 9 }, quote: '😀前文证据后文' })
    show()
    await screen.findByText('Old answer')
    fireEvent.click(screen.getByRole('button', { name: 'Old PDF · LOC_a_5' }))
    await waitFor(() => expect(screen.getByTestId('reader-position')).toHaveTextContent('sv_old:1'))
    expect(screen.getByTestId('reader-validity')).toHaveTextContent('unverified')
  })

  it('expands select-all to the newest explicit versions regardless of backend listing order', async () => {
    const unordered = structuredClone(fixture)
    unordered.sources[0].versions.reverse()
    vi.mocked(workbenchApi.workspace).mockResolvedValue(unordered)
    show()
    await screen.findByText('Lecture notes')
    fireEvent.click(screen.getByRole('button', { name: 'workbench.selectAll' }))
    expect(screen.getByLabelText('My PDF · sv_new')).toBeChecked()
    expect(screen.getByLabelText('My PDF · sv_old')).not.toBeChecked()
  })

  it('requests source-spanning outline retrieval explicitly', async () => {
    show()
    await screen.findByText('Lecture notes')
    fireEvent.click(screen.getByRole('button', { name: 'workbench.outline' }))
    await waitFor(() => expect(workbenchApi.turn).toHaveBeenCalledWith('v1_notebook:1', expect.objectContaining({ task: 'outline', source_version_ids: ['sv_old'] })))
  })

  it('explains an unconfigured independent model before submitting a question', async () => {
    vi.mocked(useModelDefaults).mockReturnValue({ data: { default_chat_model: null } } as never)
    show()
    await screen.findByText('Lecture notes')
    expect(screen.getByText('workbench.notConfigured')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Explain this' } })
    expect(screen.getByRole('button', { name: 'workbench.ask' })).toBeDisabled()
    expect(workbenchApi.turn).not.toHaveBeenCalled()
  })

  it.each([
    ['loading', { isLoading: true }, { data: { operations: [] } }, 'workbench.googleChecking'],
    ['error', { isError: true }, { data: { operations: [] } }, 'workbench.googleCheckFailed'],
    ['disconnected', { data: { state: 'disconnected' } }, { data: { operations: [] } }, 'workbench.connectionNotVerified'],
    ['unsupported', { data: { state: 'connected' } }, { data: { operations: [{ name: 'ask', support: 'unsupported', reason: 'Strict isolation unavailable' }] } }, 'Strict isolation unavailable'],
    ['capability loading', { data: { state: 'connected' } }, { isLoading: true }, 'workbench.googleChecking'],
    ['capability error', { data: { state: 'connected' } }, { isError: true }, 'workbench.googleCheckFailed'],
  ])('blocks Google ask for %s and explains why without changing engine', async (_name, status, capabilities, reason) => {
    vi.mocked(useNotebookLMStatus).mockReturnValue(status as never)
    vi.mocked(useNotebookLMCapabilities).mockReturnValue(capabilities as never)
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), selection: { ...fixture.selection, engine: 'notebooklm' }, link: { remote_notebook_id: 'remote1' } })
    show(); await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Question' } })
    expect(screen.getByRole('button', { name: 'workbench.ask' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'workbench.outline' })).toBeDisabled()
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getByLabelText('workbench.engine')).toHaveValue('notebooklm')
    expect(workbenchApi.turn).not.toHaveBeenCalled()
  })
  it('allows Google ask only with connected status and available ask capability', async () => {
    vi.mocked(useNotebookLMStatus).mockReturnValue({ data: { state: 'connected' } } as never)
    vi.mocked(useNotebookLMCapabilities).mockReturnValue({ data: { operations: [{ name: 'ask', support: 'available' }] } } as never)
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), selection: { ...fixture.selection, engine: 'notebooklm' }, link: { remote_notebook_id: 'remote1' } })
    show(); await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Question' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.ask' }))
    await waitFor(() => expect(workbenchApi.turn).toHaveBeenCalledWith('v1_notebook:1', expect.objectContaining({ engine: 'notebooklm', remote_notebook_id: 'remote1' })))
  })
  it.each(['cancelled_local', 'submission_unknown', 'failed'])('unblocks composer when durable job is %s before a turn exists', async state => {
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j1', operation: 'ask', state } as never)
    show(); await screen.findByText('Lecture notes')
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'First' } })
    fireEvent.click(screen.getByRole('button', { name: 'workbench.ask' }))
    await waitFor(() => expect(workbenchApi.turn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('workbench.asking')).not.toBeInTheDocument())
    expect(screen.getByText(`workbench.states.${state}`)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('workbench.question'), { target: { value: 'Second' } })
    expect(screen.getByRole('button', { name: 'workbench.ask' })).not.toBeDisabled()
    expect(workbenchApi.turn).toHaveBeenCalledTimes(1)
    if (state === 'submission_unknown') expect(screen.getByText('workbench.unknownSubmission')).toBeInTheDocument()
  })

})
