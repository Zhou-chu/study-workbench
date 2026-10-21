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

  it.each(['reparse', 'revalidate', 'portable_export'])('does not offer impossible running %s cancellation', operation => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'cpu', operation, state: 'running' }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: 'workbench.cancelWaiting' })).not.toBeInTheDocument()
    expect(screen.queryByText('workbench.remoteMayContinue')).not.toBeInTheDocument()
  })
  it('offers running chat local-wait cancellation', () => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'chat', operation: 'chat', state: 'running' }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'workbench.cancelWaiting' })).toBeInTheDocument()
    expect(screen.getByText('workbench.remoteMayContinue')).toBeInTheDocument()
  })
  it('does not imply queued cancelled work reached a provider', () => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'queued', operation: 'chat', state: 'cancelled_local', remote_may_continue: false }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.queryByText('workbench.remoteMayContinue')).not.toBeInTheDocument()
  })

})
