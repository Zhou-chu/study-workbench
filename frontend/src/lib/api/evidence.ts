import apiClient from './client'
import type { BridgeJob, EvidenceRecord, SourceVersion, VersionDetail } from '@/lib/types/personal'
import type { TurnContext } from '@/lib/workbench/turn-context'
const id = encodeURIComponent
export const evidenceApi = {
  revalidate: async (versionId: string, extractionId: string, idempotencyKey: string, signal?: AbortSignal) => (await apiClient.post<BridgeJob>(`/personal/source-versions/${id(versionId)}/revalidate`, { extraction_id: extractionId, idempotency_key: idempotencyKey }, { signal })).data,
  reparse: async (versionId: string, idempotencyKey: string, signal?: AbortSignal) => (await apiClient.post<BridgeJob>(`/personal/source-versions/${id(versionId)}/reparse`, { idempotency_key: idempotencyKey }, { signal })).data,
  search: async (query: string, sourceVersionIds: readonly string[], context?: TurnContext) => (await apiClient.post<{ hits: Array<EvidenceRecord & { score?: number }>; retrieval_method: string }>('/personal/search', { query, source_version_ids: sourceVersionIds }, { turnContext: context })).data,
  versions: async (sourceId: string) => (await apiClient.get<SourceVersion[]>(`/personal/sources/${id(sourceId)}/versions`)).data,
  version: async (versionId: string, signal?: AbortSignal, evidenceId?: string) => (await apiClient.get<VersionDetail>(`/personal/source-versions/${id(versionId)}`, { signal, params: { evidence_id: evidenceId } })).data,
  evidence: async (evidenceId: string) => (await apiClient.get<EvidenceRecord>(`/personal/evidence/${id(evidenceId)}`)).data,
  download: async (versionId: string, signal?: AbortSignal) => (await apiClient.get<Blob>(`/personal/source-versions/${id(versionId)}/download`, { responseType: 'blob', signal })).data,
}
