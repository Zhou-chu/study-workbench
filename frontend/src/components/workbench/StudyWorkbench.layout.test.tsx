import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace, TurnRecord, EvidenceCitation } from '@/lib/types/personal'
import { useAuthStore } from '@/lib/stores/auth-store'
import { TurnOperationProvider } from '@/components/providers/TurnOperationProvider'
import { invalidateTurnContext, publishTurnTarget } from '@/lib/workbench/turn-context'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
const locale = vi.hoisted(() => ({ outlinePrompt: 'workbench.outlinePrompt', identityLanguage: null as string | null }))
const readerEvents = vi.hoisted(() => ({ position: null as ((reading: { source_version_id: string; page_index: number }) => void) | null }))
vi.mock('@/lib/hooks/use-translation', async () => {
  const { workbenchEn, workbenchZh } = await import('@/lib/locales/workbench')
  return { useTranslation: () => ({ t: (key: string, values?: { count?: number }) => {
    if (locale.identityLanguage && key.startsWith('workbench.')) {
      const dictionary = locale.identityLanguage === 'zh' ? workbenchZh : workbenchEn
      return dictionary[key.slice('workbench.'.length) as keyof typeof workbenchEn] ?? key
    }
    return key === 'workbench.outlinePrompt' ? locale.outlinePrompt : key === 'workbench.selectedCount' ? `${key}: ${values?.count}` : key
  }, language: 'en-US', setLanguage: vi.fn() }) }
})
import { StudyWorkbench } from './StudyWorkbench'
import { workbenchRules, lengthPixels } from '@/test/workbench-css'
import { useNotebookLMStatus, useNotebookLMCapabilities } from '@/lib/hooks/use-notebooklm'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { evidenceApi } from '@/lib/api/evidence'
import { workbenchApi } from '@/lib/api/workbench'
import { webDiscoveryApi } from '@/lib/api/web-discovery'
vi.mock('@/lib/api/web-discovery', () => ({ webDiscoveryApi: { status: vi.fn(), search: vi.fn(), importSource: vi.fn() } }))
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { evidence: vi.fn(), search: vi.fn(), semanticStatus: vi.fn(async () => ({ enabled: false, profiles: [], jobs: [] })) } }))
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { workspace: vi.fn(), saveSelection: vi.fn(), turn: vi.fn(), saveNote: vi.fn(), updateNote: vi.fn(), upload: vi.fn(), turns: vi.fn(), job: vi.fn(), cancelJob: vi.fn() } }))
vi.mock('@/lib/hooks/use-models', () => ({ useModelDefaults: vi.fn(() => ({ data: { default_chat_model: 'model:test' } })) }))
vi.mock('@/lib/hooks/use-notebooklm', () => ({ useNotebookLMStatus: vi.fn(() => ({ data: { state: 'disconnected' } })), useNotebookLMCapabilities: vi.fn(() => ({ data: { operations: [{ name: 'ask', support: 'unsupported' }] } })) }))
vi.mock('@/components/integrations/NotebookLMPanel', () => ({ NotebookLMPanel: () => <button>Google integration controls</button> }))
vi.mock('@/components/workbench/PortableControls', () => ({ PortableControls: () => <div /> }))
vi.mock('@/components/evidence/EvidenceReader', () => ({ EvidenceReader: ({ sourceVersionId, initialPage, citation, onPositionChange }: { sourceVersionId?: string; initialPage?: number; citation?: EvidenceCitation | null; onPositionChange: (reading: { source_version_id: string; page_index: number }) => void }) => { readerEvents.position = onPositionChange; return <><div data-testid="reader-position">{sourceVersionId}:{initialPage}</div><p data-testid="reader-validity">{citation?.reference_validity}</p></> } }))
const fixture: Workspace = {
  notebook: { id: 'notebook:1', name: 'Lecture notes' },
  sources: [{ source_id: 'source:1', title: 'My PDF', versions: [
    { source_id: 'source:1', sha256: 'old', byte_size: 3, created_at: '2026-10-17', source_version_id: 'sv_old', original_status: 'available', mime_type: 'application/pdf', status: 'ready' },
    { source_id: 'source:1', sha256: 'new', byte_size: 3, created_at: '2026-10-18', source_version_id: 'sv_new', original_status: 'available', mime_type: 'application/pdf', status: 'ready' },
  ] }], notes: [], turns: [], jobs: [], link: null,
  selection: { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_old'], remote_source_ids: [] },
}
const oldTurn: TurnRecord = { turn_id: 'turn1', engine: 'independent', message: 'Old question', answer: 'Old answer', citations: [{ citation_id: 'c1', kind: 'local_evidence', evidence_id: 'ev1', source_title: 'Old PDF', reference_validity: 'verified', source_version_id: 'sv_old', quote: 'evidence' }], scope_snapshot: { source_version_ids: ['sv_old'], remote_source_ids: [] } }

function show(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } } })) { return render(<QueryClientProvider client={client}><TurnOperationProvider><StudyWorkbench notebookId="notebook:1" /></TurnOperationProvider></QueryClientProvider>) }
afterEach(() => { locale.identityLanguage = null })
describe('StudyWorkbench source snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks(); locale.identityLanguage = null; locale.outlinePrompt = 'workbench.outlinePrompt'; readerEvents.position = null
    invalidateTurnContext(); publishTurnTarget({ mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null }, true)
    sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
    vi.mocked(useModelDefaults).mockReturnValue({ data: { default_chat_model: 'model:test' } } as never)
    vi.mocked(useNotebookLMStatus).mockReturnValue({ data: { state: 'disconnected' } } as never)
    vi.mocked(useNotebookLMCapabilities).mockReturnValue({ data: { operations: [{ name: 'ask', support: 'unsupported' }] } } as never)
    vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ enabled: false, profiles: [], jobs: [] } as never)
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j1', operation: 'ask', state: 'queued' })
    vi.mocked(workbenchApi.workspace).mockResolvedValue(structuredClone(fixture))
    vi.mocked(workbenchApi.turns).mockResolvedValue([])
    vi.mocked(workbenchApi.turn).mockResolvedValue({ turn_id: 'new_turn', job_id: 'j1', state: 'queued' })
  })
  it('uses neutral selected/pressed navigation and retains roving keyboard focus', async () => {
    show(); await screen.findByText('Lecture notes')
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected).not.toHaveClass('bg-primary')
    fireEvent.keyDown(selected, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'workbench.notes' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'workbench.notes' })).toHaveAttribute('aria-selected', 'true')
    const reader = screen.getByRole('button', { name: 'workbench.reader' })
    const conversation = screen.getByRole('button', { name: 'workbench.conversation' })
    expect(conversation).toHaveAttribute('aria-pressed', 'true')
    expect(conversation).not.toHaveClass('bg-primary')
    fireEvent.click(reader)
    expect(reader).toHaveAttribute('aria-pressed', 'true')
    expect(conversation).toHaveAttribute('aria-pressed', 'false')
    const notesTab = screen.getByRole('tab', { name: 'workbench.notes' })
    const settings = screen.getByRole('button', { name: 'learningWorkspace.notebookSettings' })
    settings.focus()
    expect(settings).toHaveFocus()
    expect(notesTab).toHaveAttribute('aria-selected', 'true')
    const marker = workbenchRules(notesTab, 390, false, 16, '::after')
    expect(marker.height).toBe('3px')
    expect(marker['background-color']).toBe('var(--foreground)')
    expect(workbenchRules(screen.getByRole('tab', { name: 'workbench.sources' }), 390, false, 16, '::after')['background-color']).toBeUndefined()
  })
  it('scopes workspace and portaled settings/confirmation/discovery controls deliberately', async () => {
    show(); await screen.findByText('Lecture notes')
    expect(screen.getByLabelText('learningWorkspace.workspace')).toHaveAttribute('data-workbench-controls')
    fireEvent.click(screen.getByRole('button', { name: 'learningWorkspace.notebookSettings' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-workbench-controls')
    for (const target of screen.getByRole('dialog').querySelectorAll('button, select, a')) {
      const rule = workbenchRules(target, 390)
      expect(lengthPixels(rule['min-height'], 300)).toBeGreaterThanOrEqual(44)
      expect(lengthPixels(rule['min-width'], 300)).toBeGreaterThanOrEqual(44)
    }
    const close = screen.getByRole('button', { name: 'common.close' })
    close.focus()
    expect(workbenchRules(close, 390).outline).toBe('2px solid var(--ring)')
    expect(workbenchRules(close, 390).opacity).toBe('1')
    fireEvent.click(close)
    fireEvent.change(screen.getByLabelText('workbench.noteContent'), { target: { value: 'unsaved' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.new' }))
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-workbench-controls')
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    vi.mocked(webDiscoveryApi.status).mockResolvedValue({ state: 'ready' } as never)
    fireEvent.click(screen.getByRole('button', { name: 'learningWorkspace.discover' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-workbench-controls')
  })
  it.each([14, 16, 20, 24])('keeps full-width single-region panes below80rem at a %spx initial font', async font => {
    show(); await screen.findByText('Lecture notes')
    const panes = ['sources', 'notes'].map(name => document.getElementById(`workbench-panel-${name}`)!)
    for (const width of [80 * font - 1, ...[1280, 1440].filter(width => width < 80 * font)]) {
      for (const pane of panes) {
        expect(pane).toHaveClass('w-full', 'xl:block')
        expect(workbenchRules(pane, width, false, font)['max-width']).toBeUndefined()
      }
    }
  })
  it.each([14, 16, 20, 24])('reserves340px answer AND nested-reader prose at/above80rem with a %spx initial font', async font => {
    show(); await screen.findByText('Lecture notes')
    for (const width of [80 * font, 80 * font + 160]) {
      const available = width - 13 * font // actual expanded w-52 navigation
      const panes = ['sources', 'notes'].map(name => document.getElementById(`workbench-panel-${name}`)!)
      const caps = panes.map(pane => lengthPixels(workbenchRules(pane, width, false, font)['max-width'], available, font))
      // A max below the actual xl:min-w-56 would lose to min-width in CSS.
      for (const cap of caps) expect(cap).toBeGreaterThanOrEqual(14 * font)
      const center = available - caps[0] - caps[1]
      const outerPadding = 3 * font // lg:px-6
      const answerPaddingAndBorder = 2 * font + 2 // p-4 border
      const readerPaddingAndBorder = 1.5 * font + 2 // p-3 border
      expect(center - outerPadding - answerPaddingAndBorder - 20).toBeGreaterThanOrEqual(340)
      // Reader's extracted-text list can scroll inside the center scroll region.
      expect(center - outerPadding - readerPaddingAndBorder - 40).toBeGreaterThanOrEqual(340)
    }
  })
  it('keeps import actions together and search action alongside the labeled input', async () => {
    show(); await screen.findByText('Lecture notes')
    const upload = screen.getByLabelText('workbench.upload').closest('label')!
    const discover = screen.getByRole('button', { name: 'learningWorkspace.discover' })
    expect(upload.parentElement).toBe(discover.parentElement)
    expect(workbenchRules(upload.parentElement!, 390).display).toBe('grid')
    const search = screen.getByLabelText('learningWorkspace.sourceSearch')
    expect(search.parentElement).toBe(screen.getByRole('button', { name: 'workbench.search' }).parentElement)
  })
  it('bounds multiple long answer/note citations while keeping their full accessible identity and original locator', async () => {
    const references = [0, 1, 2].map(index => ({ ...oldTurn.citations[0], citation_id: String(index).repeat(128), source_title: 'L'.repeat(120), locator: { page_index: index + 3, block_id: 'original_block' } }))
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [{ ...oldTurn, citations: references }], notes: [{ id: 'note:long', title: 'Long note', content: 'Body', revision: 1, citations: references }] })
    vi.mocked(workbenchApi.saveSelection).mockResolvedValue({})
    show(); await screen.findByText('Lecture notes')
    for (const reference of references) {
      const buttons = screen.getAllByRole('button', { name: `${reference.source_title} · ${reference.citation_id}` })
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        const style = workbenchRules(button, 390)
        expect(style['max-width']).toBe('100%')
        expect(style['white-space']).toBe('normal')
        expect(style['overflow-wrap']).toBe('anywhere')
        expect(button.textContent).not.toContain(reference.citation_id)
      }
    }
    fireEvent.click(screen.getAllByRole('button', { name: `${references[1].source_title} · ${references[1].citation_id}` })[0])
    await screen.findByText('workbench.selectionSaved')
    expect(vi.mocked(workbenchApi.saveSelection).mock.lastCall?.[1].reading).toMatchObject({ source_version_id: 'sv_old', evidence_id: 'ev1', page_index: 4 })
    expect(references[1].locator).toEqual({ page_index: 4, block_id: 'original_block' })
  })
})
