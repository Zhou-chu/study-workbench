import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { invalidateTurnContext, publishTurnTarget, readTurnContext } from '@/lib/workbench/turn-context'
import { workbenchRules } from '@/test/workbench-css'
import { StudyWorkbench } from './StudyWorkbench'

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
function pendingCitation() {
  let resolve!: (value: EvidenceRecord) => void
  vi.mocked(evidenceApi.evidence).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  return () => act(async () => { resolve(canonical) })
}
async function openArchived() {
  show()
  await screen.findByText('Lecture notes')
  fireEvent.click(screen.getByRole('button', { name: 'Old PDF · c1' }))
  const page = await screen.findByLabelText('workbench.pdfPage')
  await screen.findByText('workbench.selectionSaved')
  return page
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

  it('keeps a newer manual PDF page and sends no extra selection write when an older citation lookup finishes', async () => {
    const finishLookup = pendingCitation()
    const page = await openArchived()
    await waitFor(() => expect(page).toHaveValue(9))
    expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(1)
    fireEvent.change(page, { target: { value: '4' } })
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2))
    await screen.findByText('workbench.selectionSaved')
    const context = readTurnContext()
    await finishLookup()
    expect(readTurnContext()).toEqual(context)
    expect.soft(page).toHaveValue(4)
    expect.soft(workbenchApi.saveSelection).toHaveBeenCalledTimes(2)
    expect.soft(vi.mocked(workbenchApi.saveSelection).mock.lastCall?.[1].reading).toEqual({ source_version_id: 'sv_old', page_index: 3, evidence_id: 'ev1' })
    expect(screen.getByText('workbench.selectionSaved')).toBeVisible()
  })

  it.each([false, true])('accepts canonical citation navigation without a later reading intent (scope-only edit=%s)', async scopeEdit => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { extraction_id: 'ex_old', status: 'ready', page_count: 10, warnings: [] }, evidence: [] })
    const finishLookup = pendingCitation()
    const page = await openArchived()
    expect(page).toHaveValue(1)
    if (scopeEdit) {
      fireEvent.click(screen.getByRole('checkbox', { name: 'My PDF · sv_new' }))
      await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2))
      await screen.findByText('workbench.selectionSaved')
    }
    await finishLookup()
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(scopeEdit ? 3 : 2))
    expect(page).toHaveValue(9)
    expect(vi.mocked(workbenchApi.saveSelection).mock.lastCall?.[1]).toMatchObject({ source_version_ids: scopeEdit ? ['sv_old', 'sv_new'] : ['sv_old'], reading: { source_version_id: 'sv_old', page_index: 8, evidence_id: 'ev1' } })
  })

  it.each(['source', 'citation'] as const)('lets a newer %s navigation supersede the pending archived citation lookup', async navigation => {
    const next = { ...archived, citation_id: 'c2', evidence_id: 'ev2', source_title: 'Next PDF', reference_validity: 'verified', locator: { page_index: 4 } }
    vi.mocked(workbenchApi.workspace).mockResolvedValue({ ...structuredClone(fixture), turns: [{ ...turn, citations: [archived, next] }] })
    const finishLookup = pendingCitation()
    await openArchived()
    if (navigation === 'source') fireEvent.click(screen.getAllByRole('button', { name: 'workbench.read' })[1])
    else {
      fireEvent.click(screen.getByRole('button', { name: 'workbench.conversation' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next PDF · c2' }))
    }
    const page = await screen.findByLabelText('workbench.pdfPage')
    await waitFor(() => expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2))
    await screen.findByText('workbench.selectionSaved')
    await finishLookup()
    expect(page).toHaveValue(navigation === 'source' ? 1 : 5)
    expect(workbenchApi.saveSelection).toHaveBeenCalledTimes(2)
    expect(vi.mocked(workbenchApi.saveSelection).mock.lastCall?.[1].reading).toMatchObject({ source_version_id: navigation === 'source' ? 'sv_new' : 'sv_old', page_index: navigation === 'source' ? 0 : 4 })
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
