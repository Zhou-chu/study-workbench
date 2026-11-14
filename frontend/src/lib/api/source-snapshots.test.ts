import { describe, expect, it, vi } from 'vitest'
import apiClient from './client'
import { sourceSnapshotsApi } from './source-snapshots'
vi.mock('./client', () => ({ default: { post: vi.fn() } }))
describe('source snapshot API', () => {
  it('uses the shared authenticated transport with the encoded notebook and exact request', async () => {
    const data = { source_id: 'source:one', source_version_id: 'sv_one', job_id: 'job_one', status: 'ready', existing: false, embedding_status: 'not_requested', provenance: { kind: 'derived' } }
    vi.mocked(apiClient.post).mockResolvedValue({ data })
    const request = { origin_kind: 'note', note_id: 'note:one', expected_revision: 3, idempotency_key: 'stable-key' } as const
    expect(await sourceSnapshotsApi.create('notebook:one / two', request)).toEqual(data)
    expect(apiClient.post).toHaveBeenCalledWith('/personal/notebooks/notebook%3Aone%20%2F%20two/source-snapshots', request)
  })
  it('rejects a malformed success receipt rather than announcing a saved source', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'queued' } })
    await expect(sourceSnapshotsApi.create('notebook:one', { origin_kind: 'turn', turn_id: 'turn_one', idempotency_key: 'stable' })).rejects.toThrow('Invalid source snapshot receipt')
  })
})
