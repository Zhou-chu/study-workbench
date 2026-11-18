import { render, version, citation } from '@/test/evidence-reader-fixtures'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { PdfZoom } from './pdf-render-sizing'
import type { EvidenceCitation } from '@/lib/types/personal'
import { EvidenceReader } from './EvidenceReader'
import { evidenceApi } from '@/lib/api/evidence'
import { workbenchRules } from '@/test/workbench-css'

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
})
