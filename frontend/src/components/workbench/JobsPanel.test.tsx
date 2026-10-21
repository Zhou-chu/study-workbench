import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { JobsPanel } from './JobsPanel'
import { workbenchApi } from '@/lib/api/workbench'
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { job: vi.fn(), cancelJob: vi.fn() } }))
describe('persistent jobs', () => {
  it('warns on unknown submission and never exposes an automatic retry', () => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'j1', operation: 'audio', state: 'submission_unknown', submission_state: 'unknown' }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('workbench.unknownSubmission')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(workbenchApi.cancelJob).not.toHaveBeenCalled()
  })
  it('does not imply a remote success has produced a locally saved artifact', () => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'j2', operation: 'audio', state: 'succeeded', result: { downloaded: false, download_error: 'Connection lost' } }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('workbench.artifactNotSaved')).toBeInTheDocument()
    expect(screen.getByText('Connection lost')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workbench.downloadResult' })).not.toBeInTheDocument()
  })

})
