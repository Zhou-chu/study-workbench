import { render, version } from '@/test/evidence-reader-fixtures'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { PdfZoom } from './pdf-render-sizing'
import { EvidenceReader } from './EvidenceReader'
import { evidenceApi } from '@/lib/api/evidence'

vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string, options?: { status?: string }) => key === 'workbench.validity' ? `${key}: ${options?.status}` : key === 'workbench.referenceVerified' ? 'verified' : key === 'workbench.referenceUnverified' ? 'unverified' : key }) }))
vi.mock('./PdfCanvas', () => ({ PdfCanvas: ({ pageIndex, blob, zoom, onZoomChange }: { pageIndex: number; blob: Blob; zoom: PdfZoom; onZoomChange: (zoom: PdfZoom) => void }) => <><canvas title="workbench.pdfReader" data-page-number={pageIndex + 1} data-zoom={zoom} data-blob-size={blob.size} /><button onClick={() => onZoomChange?.(2)}>Set PDF zoom 2</button></>, PdfTextFallback: ({ text }: { text: string }) => <p>{text}</p> }))
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { download: vi.fn(), version: vi.fn(), reparse: vi.fn(), revalidate: vi.fn() } }))

describe('EvidenceReader', () => {
  beforeEach(() => {
    vi.mocked(evidenceApi.version).mockResolvedValue({ version, extraction: { status: 'ready', page_count: 10, warnings: [] }, evidence: [] } as never)
    vi.mocked(evidenceApi.download).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:authenticated-pdf'), revokeObjectURL: vi.fn() })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

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
})
