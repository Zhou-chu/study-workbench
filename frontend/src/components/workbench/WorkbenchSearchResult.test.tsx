import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EvidenceRecord } from '@/lib/types/personal'
import { WorkbenchSearchResult } from './WorkbenchSearchResult'

vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string, values?: { page?: number; label?: string }) => key === 'workbench.physicalPage' ? `Physical page ${values?.page}` : key === 'workbench.printPage' ? `Printed page label: ${values?.label}` : key, language: 'en-US' }) }))

const hit: EvidenceRecord = { evidence_id: 'ev_one', source_version_id: 'abcdefgh1', extraction_id: 'ex_one', source_title: 'Source one', quote: 'The complete identical quote.', evidence_kind: 'local_evidence', locator: { page_index: 0, page_label: 'iv' }, reference_validity: 'unverified' }

describe('visible search evidence identity', () => {
  it('identical_quotes_show_distinct_sources', () => {
    const onOpen = vi.fn()
    render(<><WorkbenchSearchResult hit={hit} versionLabel="abcdefgh1" onOpen={onOpen} /><WorkbenchSearchResult hit={{ ...hit, evidence_id: 'ev_two', source_version_id: 'abcdefgh2', source_title: 'Source two' }} versionLabel="abcdefgh2" onOpen={onOpen} /></>)
    const buttons = screen.getAllByRole('button')
    expect(within(buttons[0]).getByText('Source one')).toBeVisible()
    expect(within(buttons[1]).getByText('Source two')).toBeVisible()
    for (const button of buttons) expect(within(button).getByText(hit.quote)).toBeVisible()
    expect(within(buttons[0]).getByText('abcdefgh1')).toBeVisible()
    expect(within(buttons[1]).getByText('abcdefgh2')).toBeVisible()
    fireEvent.click(buttons[0])
    expect(onOpen).toHaveBeenCalledWith(hit)
  })
  it('physical_page_is_not_print_page', () => {
    render(<WorkbenchSearchResult hit={hit} versionLabel="abcdefgh1" onOpen={vi.fn()} />)
    expect(screen.getByText('Physical page 1')).toBeVisible()
    expect(screen.getByText('Printed page label: iv')).toBeVisible()
    expect(screen.queryByText('Physical page iv')).not.toBeInTheDocument()
  })
  it.each(['pdf_text', 'text'])('labels the actual local extraction kind %s without claiming independent support', evidence_kind => {
    render(<WorkbenchSearchResult hit={{ ...hit, evidence_kind }} versionLabel="abcdefgh1" onOpen={vi.fn()} />)
    expect(screen.getByText('workbench.evidenceLocal')).toBeVisible()
    expect(screen.queryByText('sourceSnapshots.notIndependentEvidence')).not.toBeInTheDocument()
  })
  it.each([undefined, null, -1, NaN, 1.5])('does not invent a physical page for %s', page_index => {
    render(<WorkbenchSearchResult hit={{ ...hit, locator: { page_index, page_label: 'iv' } }} versionLabel="abcdefgh1" onOpen={vi.fn()} />)
    expect(screen.queryByText(/Physical page/)).not.toBeInTheDocument()
    expect(screen.getByText('Printed page label: iv')).toBeVisible()
  })
  it.each([{ evidence_kind: 'derived_snapshot' }, { independent_support: false }])('derived_warning_is_visible_without_opening: %j', metadata => {
    render(<WorkbenchSearchResult hit={{ ...hit, ...metadata }} versionLabel="abcdefgh1" onOpen={vi.fn()} />)
    expect(within(screen.getByRole('button')).getByText('sourceSnapshots.notIndependentEvidence')).toBeVisible()
  })
  it.each(['web', 'derived'] as const)('provenance_has_no_nested_interactive_content: %s', kind => {
    const provenance: EvidenceRecord['provenance'] = kind === 'web' ? { kind, source_url: 'https://example.invalid/reference', retrieved_at: '2026-11-02T09:00:00Z', provider: 'firecrawl' } : { kind, origin_kind: 'note', origin_id: 'note_one', origin_title: 'Saved source note', note_revision: 1, authorship: 'human', captured_at: '2026-11-02T09:00:00Z', content_sha256: 'synthetic', scope_snapshot: { source_version_ids: [], remote_source_ids: [] }, citations: [] }
    const onOpen = vi.fn()
    const { container } = render(<WorkbenchSearchResult hit={{ ...hit, provenance }} versionLabel="abcdefgh1" onOpen={onOpen} />)
    const button = screen.getByRole('button')
    expect(button.querySelector('a,button,details')).toBeNull()
    const richControl = container.querySelector(kind === 'web' ? 'a' : 'summary')!
    expect(richControl).not.toBeNull()
    expect(button.contains(richControl)).toBe(false)
    fireEvent.click(richControl)
    expect(onOpen).not.toHaveBeenCalled()
  })
  it('falls back to the exact immutable version ID for a missing source title without claiming independence', () => {
    render(<WorkbenchSearchResult hit={{ ...hit, source_title: undefined, independent_support: true }} versionLabel="abcdefgh" onOpen={vi.fn()} />)
    expect(screen.getByText(hit.source_version_id)).toBeVisible()
    expect(screen.queryByText('sourceSnapshots.notIndependentEvidence')).not.toBeInTheDocument()
  })
})
