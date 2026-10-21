import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TurnCoverage } from './TurnCoverage'

vi.mock('@/lib/hooks/use-translation', async () => {
  const { workbenchEn } = await import('@/lib/locales/workbench')
  return { useTranslation: () => ({ t: (key: string, values?: Record<string, string | number>) => {
    let text = String(workbenchEn[key.replace('workbench.', '') as keyof typeof workbenchEn] || key)
    for (const [name, value] of Object.entries(values || {})) text = text.replace(`{{${name}}}`, String(value))
    return text
  } }) }
})

describe('TurnCoverage', () => {
  it('distinguishes selected sources from actual included evidence and labels a bounded outline', () => {
    render(<TurnCoverage coverage={{ selected_source_count: 30, retrieved_source_count: 3, evidence_count: 8 }} warnings={['BOUNDED_OVERVIEW: limited excerpts', 'PARTIAL_SOURCE_COVERAGE: omitted source IDs', 'CONTEXT_BUDGET: included 8 of 12']} />)
    expect(screen.getByText('Selected 30 sources · Evidence used from 3 sources · 8 evidence excerpts')).toBeInTheDocument()
    expect(screen.getByText('Evidence excerpts do not represent complete processing of the selected material.')).toBeInTheDocument()
    expect(screen.getByText('Bounded outline: based on selected evidence excerpts, not an exhaustive outline of all selected material.')).toBeInTheDocument()
    expect(screen.getByText('Partial source coverage: some selected sources contributed no evidence to this answer.')).toBeInTheDocument()
    expect(screen.getByText('Context limit: some retrieved evidence could not be included.')).toBeInTheDocument()
  })
  it('does not fabricate coverage counts for historical or remote answers', () => {
    const { container } = render(<TurnCoverage />)
    expect(container).toBeEmptyDOMElement()
  })
  it('preserves zero coverage and unknown warnings without presenting success', () => {
    render(<TurnCoverage coverage={{ selected_source_count: 5, retrieved_source_count: 0, evidence_count: 0 }} warnings={['Source extraction is incomplete']} />)
    expect(screen.getByText('Selected 5 sources · Evidence used from 0 sources · 0 evidence excerpts')).toBeInTheDocument()
    expect(screen.getByText('Source extraction is incomplete')).toBeInTheDocument()
  })
})
