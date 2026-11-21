import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { SourceProvenance } from './SourceProvenance'

it.each([null, ['opaque'], { kind: 'future', origin_kind: 'note', authorship: 'human' }, { kind: 'derived', origin_kind: { opaque: true }, authorship: 'future', origin_title: {}, captured_at: [], citations: 'opaque' }].map(provenance => ({ provenance })))('unknown_provenance_is_not_human_derived: $provenance', ({ provenance }) => {
  render(<SourceProvenance provenance={provenance as never} />)
  expect(screen.getByText('workbench.unavailable')).toBeVisible()
  expect(screen.queryByText('sourceSnapshots.humanDerived')).not.toBeInTheDocument()
  expect(screen.queryByText('sourceSnapshots.aiDerived')).not.toBeInTheDocument()
})

it('guards malformed fields of known web provenance without rendering objects', () => {
  render(<SourceProvenance provenance={{ kind: 'web', source_url: { url: 'https://example.invalid' }, retrieved_at: ['opaque'] } as never} />)
  expect(screen.getByText('webDiscovery.urlUnavailable')).toBeVisible()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.getByText('workbench.unavailable')).toBeVisible()
})

it.each([
  { origin_kind: 'note', authorship: 'human', label: 'sourceSnapshots.humanDerived' },
  { origin_kind: 'note', authorship: 'ai', label: 'sourceSnapshots.aiDerived' },
  { origin_kind: 'turn', authorship: 'ai', label: 'sourceSnapshots.aiDerived' },
  { origin_kind: 'note', authorship: 'unknown', label: 'sourceSnapshots.unknownAuthorship' },
])('labels only explicitly recognized derived metadata: $authorship', ({ origin_kind, authorship, label }) => {
  render(<SourceProvenance provenance={{ kind: 'derived', origin_kind, authorship, origin_title: 'Synthetic', captured_at: '2026-10-24', note_revision: 2, citations: [{ citation_id: 'c1', source_title: 'Reference' }, null, { source_title: {} }] }} />)
  expect(screen.getByText(label)).toBeVisible()
  expect(screen.getByText('sourceSnapshots.notIndependentEvidence')).toBeVisible()
  fireEvent.click(screen.getByText('common.references'))
  expect(screen.getByText('Synthetic')).toBeVisible()
  expect(screen.getByText('Reference')).toBeVisible()
  expect(screen.getAllByText('workbench.unavailable')).toHaveLength(2)
})

it('keeps a known web URL with guarded capture metadata', () => {
  render(<SourceProvenance provenance={{ kind: 'web', source_url: 'https://example.invalid/synthetic', retrieved_at: '2026-10-24T00:00:00Z' }} />)
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.invalid/synthetic')
  expect(screen.getByText('2026-10-24')).toBeVisible()
  expect(screen.queryByText('sourceSnapshots.humanDerived')).not.toBeInTheDocument()
})
