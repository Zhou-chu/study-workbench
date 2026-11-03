import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { JobsPanel } from './JobsPanel'
import { workbenchApi } from '@/lib/api/workbench'
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { job: vi.fn(), cancelJob: vi.fn() } }))
describe('persistent jobs', () => {
  it('leads local success with a friendly task name and keeps raw fields in a closed native disclosure', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'local-job-hash', operation: 'extract_evidence', state: 'succeeded', submission_state: 'not_submitted' }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('workbench.jobOperations.extract')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('workbench.states.succeeded')
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('local-job-hash')).not.toBeVisible()
    expect(screen.getByText('extract_evidence')).not.toBeVisible()
    expect(screen.getByText('workbench.submissionStatus')).not.toBeVisible()
    const summary = screen.getByText('workbench.jobTechnicalDetails')
    expect(summary.tagName).toBe('SUMMARY')
    fireEvent.click(summary)
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('local-job-hash')).toBeVisible()
    expect(screen.getByText('extract_evidence')).toBeVisible()
    expect(screen.getByText('workbench.submissionStatus')).toBeVisible()
  })
  it.each([
    ['read', 'read'], ['reparse', 'reparse'], ['revalidate', 'revalidate'],
    ['portable_export', 'export'], ['portable_import', 'import'], ['import', 'import'],
    ['chat', 'question'], ['ask', 'question'], ['question', 'question'], ['outline', 'outline'],
    ['audio', 'audio'], ['sync', 'sync'], ['create_notebook', 'createNotebook'],
    ['download', 'download'], ['future_operation', 'other'], ['toString', 'other'],
  ])('gives %s a localized friendly title', (operation, key) => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'label', operation, state: 'succeeded' }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('workbench.jobOperations.' + key)).toBeVisible()
  })
  it('still cancels queued work using its original job ID', async () => {
    vi.mocked(workbenchApi.cancelJob).mockResolvedValue({} as never)
    vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: 'queued-action', operation: 'extract_evidence', state: 'cancelled_local' })
    const onChanged = vi.fn()
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'queued-action', operation: 'extract_evidence', state: 'queued' }]} onChanged={onChanged} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'workbench.cancelWaiting' }))
    await waitFor(() => expect(workbenchApi.cancelJob).toHaveBeenCalledWith('queued-action'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    vi.clearAllMocks()
  })
  it('warns on unknown submission and never exposes an automatic retry', () => {
    render(<QueryClientProvider client={new QueryClient()}><JobsPanel jobs={[{ job_id: 'j1', operation: 'audio', state: 'submission_unknown', submission_state: 'unknown' }]} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('workbench.unknownSubmission')).toBeVisible()
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


describe('scoped turn recovery fence', () => {
  it('never GETs the parent, same-key child or ambiguous chat while unrelated jobs still poll', async () => {
    vi.clearAllMocks()
    const jobs = [
      { job_id: 'parent', operation: 'chat', state: 'queued', idempotency_key: 'mine' },
      { job_id: 'child', operation: 'ask', state: 'queued', idempotency_key: 'mine' },
      { job_id: 'ambiguous', operation: 'ask', state: 'queued' },
      { job_id: 'other-key', operation: 'ask', state: 'queued', idempotency_key: 'other' },
      { job_id: 'audio', operation: 'audio', state: 'queued', provider: 'notebooklm' },
    ]
    vi.mocked(workbenchApi.job).mockImplementation(async id => jobs.find(job => job.job_id === id)!)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['personal', 'jobs', 'parent'], { ...jobs[0], state: 'failed' })
    const changed = vi.fn()
    vi.mocked(workbenchApi.cancelJob).mockResolvedValue({ ...jobs[0], state: 'cancelled_local' })
    const view = render(<QueryClientProvider client={client}><JobsPanel jobs={jobs} turnFence={{ key: 'mine', parentJobId: 'parent' }} onChanged={changed} /></QueryClientProvider>)
    await waitFor(() => expect(workbenchApi.job).toHaveBeenCalledTimes(2))
    expect(vi.mocked(workbenchApi.job).mock.calls.map(args => args[0]).sort()).toEqual(['audio', 'other-key'])
    expect(screen.queryByText('workbench.states.failed')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'workbench.cancelWaiting' })[0])
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    expect(workbenchApi.cancelJob).toHaveBeenCalledWith('parent')
    expect(workbenchApi.job).toHaveBeenCalledTimes(2)
    view.rerender(<QueryClientProvider client={client}><JobsPanel jobs={[{ ...jobs[0], state: 'cancelled_local' }]} turnFence={{ key: 'mine', parentJobId: 'parent' }} onChanged={changed} /></QueryClientProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('workbench.states.cancelled_local')
    await client.refetchQueries({ type: 'active' })
    expect(workbenchApi.job).toHaveBeenCalledTimes(2)
  })
})

it('reads nonexecutable index-group progress separately and allows explicit local cancellation without treating it as replayable', async () => {
  vi.clearAllMocks()
  const { publishTurnTarget } = await import('@/lib/workbench/turn-context')
  publishTurnTarget({ mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null }, true)
  const group = { job_id: 'index-group', notebook_id: 'notebook:one', operation: 'index_evidence_group', state: 'queued', replay_allowed: false }
  vi.mocked(workbenchApi.job).mockResolvedValue({ ...group, state: 'running', jobs: [{ job_id: 'index-child', source_version_id: 'version:one', state: 'running', stage: 'embedding', completed_evidence: 16, total_evidence: 32, retry_safe: false, remote_cancel_confirmed: false }] })
  vi.mocked(workbenchApi.cancelJob).mockResolvedValue({ ...group, state: 'cancelled_local' })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><JobsPanel jobs={[group]} onChanged={vi.fn()} /></QueryClientProvider>)
  await waitFor(() => expect(workbenchApi.job).toHaveBeenCalled())
  expect(await screen.findByText('version:one')).toBeVisible()
  expect(screen.getByRole('button', { name: 'workbench.cancelWaiting' })).toBeEnabled()
  expect(screen.getByText('workbench.indexCancelMeaning')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'workbench.cancelWaiting' }))
  await waitFor(() => expect(workbenchApi.cancelJob).toHaveBeenCalledWith('index-group', expect.objectContaining({ ready: true })))
  expect(vi.mocked(workbenchApi.job).mock.calls.every(call => call[0] === 'index-group')).toBe(true)
  expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
})

it('retains every index-group child ID including partial success, missing and unknown children without declaring readiness or enqueueing', () => {
  vi.clearAllMocks()
  const group = { job_id: 'mixed-index-group', operation: 'index_evidence_group', state: 'submission_unknown', replay_allowed: false, job_ids: ['done-child', 'unknown-child', 'missing-child'], jobs: [
    { job_id: 'done-child', source_version_id: 'version:done', state: 'succeeded', stage: 'completed', completed_evidence: 32, total_evidence: 32 },
    { job_id: 'unknown-child', source_version_id: 'version:unknown', state: 'submission_unknown', stage: 'unknown', completed_evidence: 16, total_evidence: 32 },
  ] }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><JobsPanel jobs={[group]} onChanged={vi.fn()} /></QueryClientProvider>)
  for (const id of group.job_ids) expect(screen.getByText(id)).toBeVisible()
  expect(screen.getAllByText('workbench.indexUnknown')).toHaveLength(2)
  expect(screen.getByText('workbench.indexJobsNotReadiness')).toBeVisible()
  expect(screen.queryByText('workbench.semanticReady')).not.toBeInTheDocument()
  expect(workbenchApi.job).not.toHaveBeenCalled(); expect(workbenchApi.cancelJob).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
})
