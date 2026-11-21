import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { EvidenceCitation } from '@/lib/types/personal'
import { WorkbenchCitationButton } from './WorkbenchCitationButton'

it.each(['local_evidence', 'remote_unmapped', 'derived_snapshot'] as const)('returns the untouched %s citation including locator and validity', kind => {
  const citation: EvidenceCitation = Object.freeze({ citation_id: 'r'.repeat(128), kind, evidence_id: 'ev:original', source_version_id: 'sv:original', source_title: 'Full title '.repeat(12).trim(), locator: Object.freeze({ page_index: 6, page_label: 'vii', block_id: 'block:original', start_offset: 3, end_offset: 17 }), quote: 'Original quote', reference_validity: 'unverified' })
  const open = vi.fn()
  render(<WorkbenchCitationButton citation={citation} onOpen={open} />)
  const button = screen.getByRole('button', { name: `${citation.source_title} · ${citation.citation_id}` })
  expect(button).toHaveAttribute('title', `${citation.source_title} · ${citation.citation_id}`)
  expect(button.textContent).not.toContain(citation.citation_id)
  fireEvent.click(button)
  expect(open).toHaveBeenCalledTimes(1)
  expect(open.mock.calls[0][0]).toBe(citation)
})

it('retains a short reference and an accessible fallback for a missing source title', () => {
  const citation: EvidenceCitation = { citation_id: 'c1', kind: 'remote_unmapped', evidence_id: null, source_version_id: null, source_title: null, quote: 'Quote', reference_validity: 'unverified' }
  render(<WorkbenchCitationButton citation={citation} onOpen={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'workbench.unavailable · c1' })).toHaveTextContent('c1')
})
