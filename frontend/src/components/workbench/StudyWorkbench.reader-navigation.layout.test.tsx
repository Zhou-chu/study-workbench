import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnOperationProvider } from '@/components/providers/TurnOperationProvider'
import { evidenceApi } from '@/lib/api/evidence'
import { modelsApi } from '@/lib/api/models'
import { notebooklmApi } from '@/lib/api/notebooklm'
import { workbenchApi } from '@/lib/api/workbench'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { EvidenceCitation, EvidenceRecord, SourceVersion, TurnRecord, Workspace } from '@/lib/types/personal'
import { invalidateTurnContext, publishTurnTarget } from '@/lib/workbench/turn-context'
import { workbenchRules } from '@/test/workbench-css'
import { StudyWorkbench } from './StudyWorkbench'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

// Keep the workbench, reader, query hooks and selection ownership real. Only
// external API boundaries and PDF rasterization are replaced in this scenario.
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { evidence: vi.fn(), version: vi.fn(), download: vi.fn() } }))
vi.mock('@/lib/api/models', () => ({ modelsApi: { getDefaults: vi.fn() } }))
vi.mock('@/lib/api/notebooklm', () => ({ notebooklmApi: { status: vi.fn(), capabilities: vi.fn() } }))
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { workspace: vi.fn(), saveSelection: vi.fn(), turns: vi.fn(), job: vi.fn() } }))
vi.mock('@/components/evidence/PdfCanvas', () => ({ PdfCanvas: ({ pageIndex }: { pageIndex: number }) => <canvas title="workbench.pdfReader" data-page-number={pageIndex + 1} />, PdfTextFallback: ({ text }: { text: string }) => <p>{text}</p> }))

const version: SourceVersion = { source_id: 'source:1', sha256: 'old', byte_size: 3, created_at: '2026-10-17', source_version_id: 'sv_old', original_status: 'available', mime_type: 'application/pdf', status: 'ready' }
const archived: EvidenceCitation = { citation_id: 'c1', kind: 'local_evidence', evidence_id: 'ev1', source_title: 'Old PDF', reference_validity: 'unverified', source_version_id: 'sv_old', quote: 'evidence' }
const canonical: EvidenceRecord = { evidence_id: 'ev1', extraction_id: 'ex_old', source_version_id: 'sv_old', quote: 'evidence', locator: { page_index: 8 } }
const fixture: Workspace = {
  notebook: { id: 'notebook:1', name: 'Lecture notes' },
  sources: [{ source_id: 'source:1', title: 'My PDF', versions: [{ ...version }, { ...version, sha256: 'new', created_at: '2026-10-18', source_version_id: 'sv_new' }] }],
  notes: [], turns: [], jobs: [], link: null,
  selection: { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_old'], remote_source_ids: [] },
}
const turn: TurnRecord = { turn_id: 'turn1', engine: 'independent', message: 'Old question', answer: 'Old answer', citations: [archived], scope_snapshot: { source_version_ids: ['sv_old'], remote_source_ids: [] } }
function show() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } } })}><TurnOperationProvider><StudyWorkbench notebookId="notebook:1" /></TurnOperationProvider></QueryClientProvider>)
}

describe('StudyWorkbench with its actual evidence reader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(evidenceApi.evidence).mockReset()
    invalidateTurnContext()
    publishTurnTarget({ mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null }, true)
    sessionCoordinator.setPhase('authenticated')
    useAuthStore.setState({ phase: 'authenticated' })
    vi.mocked(modelsApi.getDefaults).mockResolvedValue({ default_chat_model: 'model:test' } as never)
    vi.mocked(notebooklmApi.status).mockResolvedValue({ state: 'disconnected' } as never)
    vi.mocked(notebooklmApi.capabilities).mockResolvedValue({ operations: [{ name: 'ask', support: 'unsupported' }] } as never)
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [structuredClone(turn)] })
    vi.mocked(workbenchApi.turns).mockResolvedValue([])
    vi.mocked(workbenchApi.saveSelection).mockResolvedValue({})
    vi.mocked(evidenceApi.version).mockImplementation(async id => ({ version: { ...version, source_version_id: id }, extraction: { extraction_id: 'ex_old', status: 'ready', page_count: 10, warnings: [] }, evidence: [canonical] }))
    vi.mocked(evidenceApi.download).mockResolvedValue(new Blob(['pdf']))
  })

  it('wraps the full long source identity and quote after following a citation into the reader', async () => {
    const reference = { ...archived, source_title: 'L'.repeat(120), quote: `https://fixture.example/${'q'.repeat(300)}`, reference_validity: 'verified', locator: { page_index: 4, page_label: 'v', block_id: 'original_block' } }
    const snapshot = structuredClone(reference)
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [{ ...turn, citations: [reference] }] })
    show()
    await screen.findByText('Lecture notes')
    fireEvent.click(screen.getByRole('button', { name: `${reference.source_title} · c1` }))
    const reader = await screen.findByRole('region', { name: 'workbench.reader' })
    await screen.findByLabelText('workbench.pdfPage')
    await screen.findByText('workbench.selectionSaved')
    const title = [...reader.querySelectorAll('p')].find(node => node.textContent === reference.source_title)!
    const quote = [...reader.querySelectorAll('p')].find(node => node.textContent === reference.quote)!
    for (const content of [title, quote]) {
      const wrappingBlock = content.closest('.workbench-reader-citation')
      expect(wrappingBlock).not.toBeNull()
      if (wrappingBlock) for (const width of [360, 390, 1440]) expect(workbenchRules(wrappingBlock, width)['overflow-wrap']).toBe('anywhere')
      for (const clippingClass of ['truncate', 'line-clamp-1', 'overflow-hidden']) expect(content).not.toHaveClass(clippingClass)
    }
    expect(quote).toHaveClass('whitespace-pre-wrap')
    fireEvent.change(screen.getByLabelText('workbench.searchEvidence'), { target: { value: 'absent filter' } })
    expect(title).toBeVisible()
    expect(quote).toBeVisible()
    expect(reference).toEqual(snapshot)
    expect(vi.mocked(workbenchApi.saveSelection).mock.lastCall?.[1]).toMatchObject({ source_version_ids: ['sv_old'], reading: { source_version_id: 'sv_old', page_index: 4, evidence_id: 'ev1' } })
  })
})
