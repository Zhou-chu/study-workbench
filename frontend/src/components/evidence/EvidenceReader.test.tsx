import { render, version, citation } from '@/test/evidence-reader-fixtures'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { PdfZoom } from './pdf-render-sizing'
import type { EvidenceCitation } from '@/lib/types/personal'
import { StrictMode } from 'react'
import { workbenchApi } from '@/lib/api/workbench'
import { EvidenceReader } from './EvidenceReader'
import { evidenceApi } from '@/lib/api/evidence'
import { workbenchRules } from '@/test/workbench-css'

vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string, options?: { status?: string }) => key === 'workbench.validity' ? `${key}: ${options?.status}` : key === 'workbench.referenceVerified' ? 'verified' : key === 'workbench.referenceUnverified' ? 'unverified' : key }) }))
vi.mock('./PdfCanvas', () => ({ PdfCanvas: ({ pageIndex, blob, zoom, onZoomChange }: { pageIndex: number; blob: Blob; zoom: PdfZoom; onZoomChange: (zoom: PdfZoom) => void }) => <><canvas title="workbench.pdfReader" data-page-number={pageIndex + 1} data-zoom={zoom} data-blob-size={blob.size} /><button onClick={() => onZoomChange?.(2)}>Set PDF zoom 2</button></>, PdfTextFallback: ({ text }: { text: string }) => <p>{text}</p> }))
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { download: vi.fn(), version: vi.fn(), reparse: vi.fn(), revalidate: vi.fn() } }))
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { job: vi.fn() } }))

describe('EvidenceReader', () => {
  beforeEach(() => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { status: 'ready', page_count: 10, warnings: [] }, evidence: [] } as never)
    vi.mocked(evidenceApi.download).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:authenticated-pdf'), revokeObjectURL: vi.fn() })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('wraps complete long citation text while preserving its frozen validity, locator, warnings, provenance and filter', async () => {
    const reference: EvidenceCitation = {
      ...citation, source_title: 'L'.repeat(120), quote: `https://fixture.example/${'q'.repeat(300)}\nComplete second line`,
      reference_validity: 'out_of_scope', locator: { page_index: 7, page_label: 'viii', block_id: 'original_block' },
      provenance: { kind: 'web', source_url: 'https://fixture.example/original', retrieved_at: '2026-10-22', provider: 'firecrawl' },
    }
    const snapshot = structuredClone(reference)
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { status: 'ready', page_count: 10, warnings: ['Retained extraction warning'], text: 'Current document content' }, evidence: [] })
    const position = vi.fn()
    const { rerender } = render(<EvidenceReader sourceVersionId="sv_old" citation={reference} initialPage={2} onPositionChange={position} />)
    await screen.findByText('Retained extraction warning')
    const title = screen.getByText(reference.source_title!)
    const quote = screen.getByText(reference.quote, { exact: true, normalizer: text => text })
    for (const content of [title, quote]) {
      const wrappingBlock = content.closest('.workbench-reader-citation')
      expect(wrappingBlock).not.toBeNull()
      if (wrappingBlock) expect(workbenchRules(wrappingBlock, 360)['overflow-wrap']).toBe('anywhere')
      for (const clippingClass of ['truncate', 'line-clamp-1', 'overflow-hidden']) expect(content).not.toHaveClass(clippingClass)
    }
    expect(quote).toHaveClass('whitespace-pre-wrap')
    expect(screen.getByText('workbench.validity: workbench.referenceOutOfScope')).toBeVisible()
    expect(screen.getByText('workbench.verificationMeaning')).toBeVisible()
    expect(screen.getByText('workbench.printPage')).toBeVisible()
    expect(screen.getByRole('link', { name: 'https://fixture.example/original' })).toHaveAttribute('href', 'https://fixture.example/original')
    fireEvent.change(screen.getByLabelText('workbench.searchEvidence'), { target: { value: 'absent term' } })
    rerender(<EvidenceReader sourceVersionId="sv_old" citation={{ ...reference }} initialPage={3} onPositionChange={position} />)
    expect(screen.getByLabelText('workbench.searchEvidence')).toHaveValue('absent term')
    expect(screen.getByText('workbench.readerNoMatches')).toBeVisible()
    expect(title).toBeVisible()
    expect(quote.textContent).toBe(reference.quote)
    expect(reference).toEqual(snapshot)
    expect(position).not.toHaveBeenCalled()
  })

  it.each(['available', 'missing'])('keeps technical version IDs inside collapsed details when the original is %s', async originalStatus => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, mime_type: 'text/plain', original_status: originalStatus, source_title: 'Readable source title' }, extraction: null, evidence: [] } as never)
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    expect(await screen.findByText('Readable source title')).toBeVisible()
    const versionId = screen.getByText('sv_old')
    expect(versionId).not.toBeVisible()
    const disclosure = screen.getByText('workbench.documentTools').closest('details')
    expect(disclosure).toContainElement(versionId)
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('workbench.documentTools'))
    expect(versionId).toBeVisible()
    if (originalStatus === 'missing') expect(screen.queryByRole('button', { name: 'workbench.reparse' })).not.toBeInTheDocument()
  })
  it.each([{ origin: 'derived_snapshot' }, { provenance: { kind: 'derived', origin_kind: 'note', origin_id: 'note:1', note_revision: 1, origin_title: 'Saved note', authorship: 'unknown', captured_at: '2026-10-22', content_sha256: 'digest', scope_snapshot: { source_version_ids: [] }, citations: [] } }])('labels saved snapshot downloads without claiming an original %j', async derived => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, ...derived, mime_type: 'text/plain' }, extraction: null, evidence: [] } as never)
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'common.download' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'workbench.downloadOriginal' })).not.toBeInTheDocument()
  })
  it('labels derived snapshots as not independent evidence', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, mime_type: 'text/plain', provenance: { kind: 'derived', origin_kind: 'turn', origin_id: 'turn:1', note_revision: null, origin_title: 'Original answer', authorship: 'ai', captured_at: '2026-10-22', content_sha256: 'digest', scope_snapshot: { source_version_ids: [] }, citations: [] } }, extraction: null, evidence: [] } as never)
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    expect(await screen.findByText('sourceSnapshots.notIndependentEvidence')).toBeInTheDocument()
    expect(screen.getByText('sourceSnapshots.aiDerived')).toBeInTheDocument()
  })
  it('does not fabricate a URL for a restored web snapshot', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, mime_type: 'text/plain', provenance: { kind: 'web', source_url: null, retrieved_at: '2026-10-22', provider: 'firecrawl', historical_url_omitted: true } }, extraction: null, evidence: [] } as never)
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    expect(await screen.findByText('webDiscovery.urlUnavailable')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('re-extracts retained web snapshots without offering original-page revalidation', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, origin: 'web_snapshot', mime_type: 'text/markdown', original_status: 'missing' }, extraction: { status: 'failed', verification_origin: 'restored_archive', extraction_id: 'extract:1', warnings: [] }, evidence: [] } as never)
    vi.mocked(evidenceApi.reparse).mockResolvedValue({ job_id: 'snapshot_reparse', state: 'succeeded', result: {} } as never)
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    expect(await screen.findByText('webDiscovery.snapshotMaintenance')).toBeInTheDocument()
    expect(screen.getByText('workbench.originalMissing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workbench.revalidate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.jobOperations.reparse' }))
    await waitFor(() => expect(evidenceApi.reparse).toHaveBeenCalledWith('sv_old', expect.any(String), expect.anything()))
    expect(evidenceApi.revalidate).not.toHaveBeenCalled()
  })

  it('does not offer network retry for an original known to be missing', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValueOnce({ version: { ...version, original_status: 'missing' }, extraction: null, evidence: [] })
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    await screen.findByText('workbench.originalMissing')
    expect(screen.queryByRole('button', { name: 'workbench.retry' })).not.toBeInTheDocument()
    expect(evidenceApi.download).not.toHaveBeenCalled()
  })
  it('keeps maintenance secondary to reading without hiding archived verification actions', async () => {
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    await screen.findByTitle('workbench.pdfReader')
    const disclosure = screen.getByText('workbench.documentTools').closest('details')
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('workbench.documentTools'))
    expect(screen.getByRole('button', { name: 'workbench.reparse' })).toBeVisible()
  })
  it('fetches the exact historical version through the authenticated client and uses physical page + 1', async () => {
    render(<EvidenceReader sourceVersionId="sv_old" citation={citation} onPositionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '8'))
    expect(evidenceApi.download).toHaveBeenCalledWith('sv_old', expect.anything())
    expect(evidenceApi.version).toHaveBeenCalledWith('sv_old', expect.anything(), 'ev1')
    expect(screen.getByText('Actual quoted text')).toBeInTheDocument()
    expect(screen.getByText('workbench.highlightUnavailable')).toBeInTheDocument()
  })
  it('opens the canonical physical page of an archived reference without upgrading its validity', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { extraction_id: 'ex_old', status: 'ready', page_count: 10, warnings: [] }, evidence: [{ evidence_id: 'ev1', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: citation.quote, locator: { page_index: 7 } }] })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity: 'unverified', locator: { page_index: 0 } }} onPositionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '8'))
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
    expect(screen.queryByText('workbench.validity: verified')).not.toBeInTheDocument()
  })
  it('opens a restored exact subquote on canonical physical page two without trusting its archived page', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { extraction_id: 'ex_old', status: 'ready', page_count: 3, warnings: [], blocks: [{ block_id: 'page_0001', page_index: 1, text: '外层😀前文证据后文尾' }] }, evidence: [{ evidence_id: 'ev1', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: '😀前文证据后文', locator: { block_id: 'page_0001', page_index: 1, start_offset: 2, end_offset: 9 } }] })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, citation_id: 'LOC_a_5', reference_validity: 'unverified', quote: '证据', locator: { block_id: 'untrusted_archived_block', page_index: 0, start_offset: 5, end_offset: 7 } }} onPositionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '2'))
    expect(screen.getByText('证据', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
  })
  it('does not locate an archived subquote merely because it occurs somewhere in canonical evidence', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { extraction_id: 'ex_old', status: 'ready', page_count: 3, warnings: [], blocks: [{ block_id: 'page_0001', page_index: 1, text: '外层😀前文证据后文尾' }] }, evidence: [{ evidence_id: 'ev1', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: '😀前文证据后文', locator: { block_id: 'page_0001', page_index: 1, start_offset: 2, end_offset: 9 } }] })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity: 'unverified', quote: '证据', locator: { page_index: 1, start_offset: 3, end_offset: 5 } }} onPositionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '1'))
    expect(screen.queryByText('证据', { selector: 'mark' })).not.toBeInTheDocument()
  })

  it('highlights canonical archived text without trusting archived offsets or changing its unverified label', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, mime_type: 'text/plain', original_status: 'missing' }, extraction: { extraction_id: 'ex_old', status: 'ready', warnings: [], blocks: [{ block_id: 'document', page_index: null, text: '😀前证据后' }] }, evidence: [{ evidence_id: 'ev1', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: '证据', locator: { block_id: 'document', start_offset: 2, end_offset: 4 } }] })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity: 'unverified', quote: '证据', locator: { block_id: 'document', start_offset: 0, end_offset: 2 } }} onPositionChange={vi.fn()} />)
    expect(await screen.findByText('证据', { selector: 'mark' })).toBeInTheDocument()
    expect(screen.getByText(/😀前/, { selector: 'pre' })).toHaveTextContent('😀前证据后')
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
  })
  it.each([{ evidence_id: 'different' }, { source_version_id: 'different' }, { quote: 'different' }, { extraction_id: 'different' }])('does not navigate using mismatched canonical evidence %j', async mismatch => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { extraction_id: 'ex_old', status: 'ready', page_count: 10, warnings: [] }, evidence: [{ evidence_id: 'ev1', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: citation.quote, locator: { page_index: 7 }, ...mismatch }] })
    render(<EvidenceReader sourceVersionId="sv_old" initialPage={2} citation={{ ...citation, reference_validity: 'unverified' }} onPositionChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '3'))
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
  })

})

const archive = () => ({ version, extraction: { extraction_id: 'ex_old', verification_origin: 'restored_archive', status: 'ready', page_count: 10, warnings: [] }, evidence: [{ evidence_id: 'ev1', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: citation.quote, locator: { page_index: 7 }, reference_validity: 'unverified' }] })
describe('Reader maintenance', () => {
  it.each([['historical'], { checked_count: '1', verified_count: 1, unverified_count: 0 }])('does not promote malformed maintenance counts: %j', async result => {
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j_verify', operation: 'revalidate', state: 'succeeded', result })
    render(<EvidenceReader sourceVersionId="sv_old" citation={citation} onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    await waitFor(() => expect(workbenchApi.job).toHaveBeenCalled())
    expect(screen.queryByText('workbench.revalidationComplete')).not.toBeInTheDocument()
    expect(screen.queryByText('workbench.revalidationPartial')).not.toBeInTheDocument()
  })
  it('renders unknown maintenance state and opaque error safely', async () => {
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j_verify', operation: 'revalidate', state: 'constructor', error: { message: { historical: true } } })
    render(<EvidenceReader sourceVersionId="sv_old" citation={citation} onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    expect(await screen.findByText('workbench.unavailable')).toBeInTheDocument()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(evidenceApi.version).mockResolvedValue(archive())
    vi.mocked(evidenceApi.download).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
    vi.mocked(evidenceApi.revalidate).mockResolvedValue({ job_id: 'j_verify', operation: 'revalidate_evidence', state: 'queued' })
    vi.mocked(evidenceApi.reparse).mockResolvedValue({ job_id: 'j_parse', operation: 'reparse_evidence', state: 'queued' })
  })
  it.each(['invalid', 'out_of_scope'])('preserves frozen citation %s even when canonical evidence is verified', async reference_validity => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ ...archive(), evidence: [{ ...archive().evidence[0], reference_validity: 'verified' }] })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity }} onPositionChange={vi.fn()} />)
    await screen.findByTitle('workbench.pdfReader')
    expect(screen.getByText(`workbench.validity: ${reference_validity === 'out_of_scope' ? 'workbench.referenceOutOfScope' : 'workbench.referenceInvalid'}`)).toBeInTheDocument()
    expect(screen.queryByText('workbench.validity: verified')).not.toBeInTheDocument()
  })
  it('does not upgrade an unverified citation outside restored archive revalidation', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ ...archive(), extraction: { ...archive().extraction, verification_origin: undefined }, evidence: [{ ...archive().evidence[0], reference_validity: 'verified' }] })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity: 'unverified' }} onPositionChange={vi.fn()} />)
    await screen.findByTitle('workbench.pdfReader')
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
  })
  it('revalidates exact historical extraction then refreshes a matching reader badge, not the citation snapshot', async () => {
    const oldCitation = { ...citation, reference_validity: 'unverified' }
    const onChanged = vi.fn()
    vi.mocked(workbenchApi.job).mockImplementation(async () => {
      vi.mocked(evidenceApi.version).mockResolvedValue({ ...archive(), evidence: [{ ...archive().evidence[0], reference_validity: 'verified' }] })
      return { job_id: 'j_verify', operation: 'revalidate_evidence', state: 'succeeded', result: { checked_count: 1, verified_count: 1, unverified_count: 0 } }
    })
    render(<EvidenceReader sourceVersionId="sv_old" citation={oldCitation} onPositionChange={vi.fn()} onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    await waitFor(() => expect(screen.getByText('workbench.validity: verified')).toBeInTheDocument())
    expect(evidenceApi.revalidate).toHaveBeenCalledWith('sv_old', 'ex_old', expect.any(String), expect.any(AbortSignal))
    expect(oldCitation.reference_validity).toBe('unverified')
    expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '8')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
  it('preserves historical extraction selector through reparse', async () => {
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j_parse', operation: 'reparse_evidence', state: 'succeeded', result: { extraction_id: 'ex_new' } })
    render(<EvidenceReader sourceVersionId="sv_old" citation={citation} onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.reparse' }))
    await waitFor(() => expect(evidenceApi.version).toHaveBeenCalledTimes(2))
    expect(vi.mocked(evidenceApi.version).mock.calls[1][2]).toBe('ev1')
    expect(screen.getByTitle('workbench.pdfReader')).toHaveAttribute('data-page-number', '8')
  })
  it('keeps an unmatched citation unverified even when other evidence passes', async () => {
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j_verify', operation: 'revalidate_evidence', state: 'succeeded', result: { checked_count: 2, verified_count: 1, unverified_count: 1 } })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity: 'unverified' }} onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    expect(await screen.findByText('workbench.revalidationPartial')).toBeInTheDocument()
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
  })
  it('does not offer original-dependent actions when the original is missing', async () => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ ...archive(), version: { ...version, original_status: 'missing' } })
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    await screen.findByText('workbench.originalMissing')
    expect(screen.queryByRole('button', { name: 'workbench.reparse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workbench.revalidate' })).not.toBeInTheDocument()
  })
  it('does not double-submit while pending and ignores completion after navigation', async () => {
    let finish!: (value: never) => void
    vi.mocked(workbenchApi.job).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const onChanged = vi.fn()
    const { rerender } = render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} onChanged={onChanged} />)
    const button = await screen.findByRole('button', { name: 'workbench.revalidate' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(workbenchApi.job).toHaveBeenCalled())
    expect(evidenceApi.revalidate).toHaveBeenCalledTimes(1)
    vi.mocked(evidenceApi.version).mockResolvedValue({ version: { ...version, source_version_id: 'sv_other' }, extraction: null, evidence: [] })
    rerender(<EvidenceReader sourceVersionId="sv_other" onPositionChange={vi.fn()} onChanged={onChanged} />)
    finish({ job_id: 'j_verify', operation: 'revalidate_evidence', state: 'succeeded' } as never)
    await waitFor(() => expect(screen.queryByText('workbench.revalidationComplete')).not.toBeInTheDocument())
    expect(onChanged).not.toHaveBeenCalled()
    expect(vi.mocked(workbenchApi.job).mock.calls[0][1]?.aborted).toBe(true)
  })
  it('shows submission failure without automatic retry and allows explicit retry with a new key', async () => {
    vi.mocked(evidenceApi.revalidate).mockRejectedValue({ isAxiosError: true, response: { data: { detail: 'WORKER_UNAVAILABLE' } } })
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    await screen.findByText('WORKER_UNAVAILABLE')
    expect(evidenceApi.revalidate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'workbench.revalidate' }))
    await waitFor(() => expect(evidenceApi.revalidate).toHaveBeenCalledTimes(2))
    expect(vi.mocked(evidenceApi.revalidate).mock.calls[0][2]).not.toBe(vi.mocked(evidenceApi.revalidate).mock.calls[1][2])
  })
  it('submits with a live abort signal under StrictMode', async () => {
    vi.mocked(evidenceApi.revalidate).mockImplementation(async (_version, _extraction, _key, signal) => {
      if (signal?.aborted) throw new Error('aborted')
      return { job_id: 'j_strict', operation: 'revalidate_evidence', state: 'failed', error: { message: 'No match' } }
    })
    render(<StrictMode><EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} /></StrictMode>)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    expect(await screen.findByText('No match')).toBeInTheDocument()
    expect(vi.mocked(evidenceApi.revalidate).mock.calls[0][3]?.aborted).toBe(false)
  })
  it('shows failed background job without claiming validation succeeded', async () => {
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'j_verify', operation: 'revalidate_evidence', state: 'failed', error: { message: 'Original file integrity verification failed' } })
    render(<EvidenceReader sourceVersionId="sv_old" citation={{ ...citation, reference_validity: 'unverified' }} onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    await screen.findByText('Original file integrity verification failed')
    expect(screen.getByText('workbench.validity: unverified')).toBeInTheDocument()
    expect(screen.queryByText('workbench.revalidationComplete')).not.toBeInTheDocument()
  })
  it('allows rechecking an existing job after polling fails without resubmitting', async () => {
    vi.mocked(workbenchApi.job).mockRejectedValueOnce({ isAxiosError: true, response: { data: { detail: 'Status unavailable' } } }).mockResolvedValue({ job_id: 'j_verify', operation: 'revalidate_evidence', state: 'succeeded', result: { checked_count: 1, verified_count: 1, unverified_count: 0 } })
    render(<EvidenceReader sourceVersionId="sv_old" onPositionChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.revalidate' }))
    await screen.findByText('Status unavailable')
    expect(screen.getByRole('button', { name: 'workbench.revalidate' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.refreshJob' }))
    await screen.findByText('workbench.revalidationComplete')
    expect(evidenceApi.revalidate).toHaveBeenCalledTimes(1)
  })

})
