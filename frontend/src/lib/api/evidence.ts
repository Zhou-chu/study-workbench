import apiClient from './client'
import type { BridgeJob, EvidenceRecord, SourceVersion, VersionDetail, RetrievalOptions, EvidenceSearchResponse, SemanticStatus, IndexPreview, IndexRequest, IndexReceipt } from '@/lib/types/personal'
import type { TurnContext } from '@/lib/workbench/turn-context'
const id = encodeURIComponent
export const evidenceApi = {
  revalidate: async (versionId: string, extractionId: string, idempotencyKey: string, signal?: AbortSignal) => (await apiClient.post<BridgeJob>(`/personal/source-versions/${id(versionId)}/revalidate`, { extraction_id: extractionId, idempotency_key: idempotencyKey }, { signal })).data,
  reparse: async (versionId: string, idempotencyKey: string, signal?: AbortSignal) => (await apiClient.post<BridgeJob>(`/personal/source-versions/${id(versionId)}/reparse`, { idempotency_key: idempotencyKey }, { signal })).data,
  search: async (query: string, sourceVersionIds: readonly string[], context?: TurnContext, options?: RetrievalOptions & { notebook_id: string }) => (await apiClient.post<EvidenceSearchResponse>('/personal/search', { query, source_version_ids: sourceVersionIds, ...options }, { turnContext: context })).data,
  semanticStatus: async (notebookId: string, sourceVersionIds: readonly string[], context?: TurnContext) => (await apiClient.get<SemanticStatus>(`/personal/notebooks/${id(notebookId)}/semantic-index`, { params: { source_version_ids: sourceVersionIds }, paramsSerializer: { indexes: null }, turnContext: context })).data,
  previewSemanticIndex: async (notebookId: string, sourceVersionIds: readonly string[], profileId: string, context?: TurnContext) => (await apiClient.post<IndexPreview>(`/personal/notebooks/${id(notebookId)}/semantic-index/preview`, { source_version_ids: sourceVersionIds, profile_id: profileId }, { turnContext: context })).data,
  buildSemanticIndex: async (notebookId: string, request: Readonly<IndexRequest>, context?: TurnContext) => (await apiClient.post<IndexReceipt>(`/personal/notebooks/${id(notebookId)}/semantic-index`, request, { turnContext: context })).data,
  versions: async (sourceId: string) => (await apiClient.get<SourceVersion[]>(`/personal/sources/${id(sourceId)}/versions`)).data,
  version: async (versionId: string, signal?: AbortSignal, evidenceId?: string) => (await apiClient.get<VersionDetail>(`/personal/source-versions/${id(versionId)}`, { signal, params: { evidence_id: evidenceId } })).data,
  evidence: async (evidenceId: string) => (await apiClient.get<EvidenceRecord>(`/personal/evidence/${id(evidenceId)}`)).data,
  download: async (versionId: string, signal?: AbortSignal) => (await apiClient.get<Blob>(`/personal/source-versions/${id(versionId)}/download`, { responseType: 'blob', signal })).data,
}
