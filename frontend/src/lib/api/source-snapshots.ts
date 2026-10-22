import apiClient from './client'
import type { SourceSnapshotRequest, SourceSnapshotResult } from '@/lib/types/source-snapshots'

export const sourceSnapshotsApi = {
  create: async (notebookId: string, request: SourceSnapshotRequest): Promise<SourceSnapshotResult> => {
    const { data } = await apiClient.post<SourceSnapshotResult>(`/personal/notebooks/${encodeURIComponent(notebookId)}/source-snapshots`, request)
    // A malformed acknowledgement is an unknown outcome, not evidence that the
    // source was never saved. The action retains this request's retry key.
    if (!data || data.status !== 'ready' || data.embedding_status !== 'not_requested' || typeof data.existing !== 'boolean'
      || ![data.source_id, data.source_version_id, data.job_id].every(id => typeof id === 'string' && id.length > 0)
      || data.provenance?.kind !== 'derived') throw new Error('Invalid source snapshot receipt')
    return data
  },
}
