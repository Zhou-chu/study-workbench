import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { RebuildEmbeddings } from './RebuildEmbeddings'
import { embeddingApi } from '@/lib/api/embedding'

vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/api/embedding', () => ({ embeddingApi: { rebuildEmbeddings: vi.fn(), getRebuildStatus: vi.fn() } }))

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><RebuildEmbeddings /></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

it('review: definite new-attempt rejection is visible without dropping prior warning', async () => {
 vi.mocked(embeddingApi.rebuildEmbeddings).mockRejectedValueOnce({response:{status:409,data:{detail:{code:'COMMAND_SUBMISSION_UNKNOWN',retry_safe:false}}}}).mockRejectedValue({response:{status:422,data:{detail:'SECRET validation'}}})
 vi.spyOn(window,'confirm').mockReturnValue(true)
 mount()
 fireEvent.click(screen.getByRole('button',{name:'advanced.rebuild.startBtn'}))
 await screen.findByText(/commandSubmission.warning/)
 fireEvent.click(screen.getByRole('button',{name:'advanced.rebuild.startBtn'}))
 await waitFor(()=>expect(embeddingApi.rebuildEmbeddings).toHaveBeenCalledTimes(2))
 await screen.findByText('advanced.rebuild.failed')
 expect(screen.getByText('commandSubmission.newAttemptError')).toBeInTheDocument()
 expect(screen.getByText(/commandSubmission.warning/)).toBeInTheDocument()
 expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
})
