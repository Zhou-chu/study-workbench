import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobsPanel } from './JobsPanel'
import { portableApi, saveBlob } from '@/lib/api/portable'
import type { BridgeJob } from '@/lib/types/personal'

vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { job: vi.fn(), cancelJob: vi.fn() } }))
vi.mock('@/lib/api/portable', () => ({ portableApi: { download: vi.fn() }, saveBlob: vi.fn() }))
const saved: BridgeJob = {
  job_id: 'job_restored', operation: 'audio', state: 'cancelled_local',
  result: { downloaded: true, artifact: { artifact_id: 'artifact_restored', mime_type: 'audio/wav' } },
}
function mount(job = saved) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><JobsPanel jobs={[job]} onChanged={vi.fn()} /></QueryClientProvider>)
}
describe('saved audio assets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:protected-audio')
      static revokeObjectURL = vi.fn()
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('loads restored audio through protected download, creates a local player and releases its blob', async () => {
    const blob = new Blob(['public synthetic tone'], { type: 'audio/wav' })
    vi.mocked(portableApi.download).mockResolvedValue(blob)
    const { container, unmount } = mount()
    expect(container.querySelector('audio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.playAudio' }))
    await waitFor(() => expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:protected-audio'))
    expect(portableApi.download).toHaveBeenCalledWith('/personal/artifacts/artifact_restored/download')
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(saveBlob).not.toHaveBeenCalled()
    expect(container.querySelector('audio')).toHaveAttribute('controls')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected-audio')
  })
  it('downloads exact returned bytes using a WAV filename rather than an unauthenticated URL', async () => {
    const blob = new Blob(['public synthetic tone'], { type: 'audio/wav' })
    vi.mocked(portableApi.download).mockResolvedValue(blob)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.downloadResult' }))
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'artifact_restored.wav'))
    expect(portableApi.download).toHaveBeenCalledWith('/personal/artifacts/artifact_restored/download')
  })
  it('shows a download failure without creating a player or retrying automatically', async () => {
    vi.mocked(portableApi.download).mockRejectedValue(new Error('Artifact integrity check failed'))
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.playAudio' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(container.querySelector('audio')).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(portableApi.download).toHaveBeenCalledTimes(1)
  })
})

it.each([
  { result: { artifact: { artifact_id: { invalid: true }, mime_type: 42 }, downloaded: true } },
  { state: 'constructor', result: null },
  { state: 'toString', result: null },
  { state: 'future_state', result: { download_url: '/personal/exports/opaque/download' } },
  { operation: 'future_operation', result: { download_url: '/personal/exports/opaque/download' } },
  { restored_history: true, replay_allowed: false, state: 'queued', operation: null, result: ['historical', null], error: { message: { nested: true } } },
])('renders unknown/historical data read-only without unsafe actions: %j', payload => {
  mount({ ...saved, ...payload } as BridgeJob)
  if ('state' in payload && ['constructor', 'toString', 'future_state'].includes(payload.state || '')) expect(screen.getByRole('status')).toHaveTextContent('workbench.unavailable')
  expect(screen.queryByRole('button', { name: 'workbench.downloadResult' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'workbench.playAudio' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'workbench.cancelWaiting' })).not.toBeInTheDocument()
})
