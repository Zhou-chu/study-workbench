import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RebuildEmbeddings } from './RebuildEmbeddings'
import { embeddingApi } from '@/lib/api/embedding'

vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/api/embedding', () => ({ embeddingApi: { rebuildEmbeddings: vi.fn(), getRebuildStatus: vi.fn() } }))

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><RebuildEmbeddings /></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('Rebuild submission safety', () => {
  it('keeps definite validation failure localized and available for correction', async () => {
    vi.mocked(embeddingApi.rebuildEmbeddings).mockRejectedValue({ response: { status: 422, data: { detail: 'SECRET validation' } } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' }))
    await waitFor(() => expect(screen.getByText('advanced.rebuild.failed')).toBeInTheDocument())
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'advanced.rebuild.startBtn' })).toBeEnabled()
  })
})
