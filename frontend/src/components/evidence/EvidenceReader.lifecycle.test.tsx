import { render, version, citation } from '@/test/evidence-reader-fixtures'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { PdfZoom } from './pdf-render-sizing'
import { StrictMode } from 'react'
import { workbenchApi } from '@/lib/api/workbench'
import { EvidenceReader } from './EvidenceReader'
import { evidenceApi } from '@/lib/api/evidence'

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
