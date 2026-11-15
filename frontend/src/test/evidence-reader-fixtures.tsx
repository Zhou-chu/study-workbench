import { render as rtlRender } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { EvidenceCitation } from '@/lib/types/personal'

export function render(element: ReactElement) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return rtlRender(element, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) }
export const version = { source_version_id: 'sv_old', source_id: 'source:1', mime_type: 'application/pdf', original_status: 'available', sha256: 'abc', byte_size: 3, created_at: '2026-10-18' }
export const citation: EvidenceCitation = { citation_id: 'c1', kind: 'local_evidence', source_version_id: 'sv_old', evidence_id: 'ev1', source_title: 'Old PDF', locator: { page_index: 7 }, quote: 'Actual quoted text', reference_validity: 'verified' }
