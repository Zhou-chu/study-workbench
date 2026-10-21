import apiClient from './client'
import type { BridgeJob, CapabilityMatrix, ConnectionFlow, ConnectionStatus, RemoteLink, RemoteNotebook, RemotePage, RemoteSource, RemoteArtifact } from '@/lib/types/personal'
const id = encodeURIComponent
interface ScopeRequest { remote_notebook_id: string; idempotency_key: string; source_version_ids?: string[]; remote_source_ids?: string[] }
export const notebooklmApi = {
  status: async () => (await apiClient.get<ConnectionStatus>('/personal/connections/notebooklm')).data,
  capabilities: async () => (await apiClient.get<CapabilityMatrix>('/personal/notebooklm/capabilities')).data,
  connect: async (reconnect = false) => (await apiClient.post<ConnectionFlow>(`/personal/connections/notebooklm/${reconnect ? 'reconnect' : 'connect'}`)).data,
  flow: async (flowId: string) => (await apiClient.get<ConnectionFlow>(`/personal/connections/notebooklm/connect/${id(flowId)}`)).data,
  disconnect: async () => (await apiClient.delete<ConnectionStatus>('/personal/connections/notebooklm')).data,
  notebooks: async (cursor?: string) => (await apiClient.get<RemotePage<RemoteNotebook>>('/personal/notebooklm/notebooks', { params: { cursor } })).data,
  sources: async (remoteId: string, cursor?: string) => (await apiClient.get<RemotePage<RemoteSource>>(`/personal/notebooklm/notebooks/${id(remoteId)}/sources`, { params: { cursor } })).data,
  link: async (notebookId: string, remoteId: string) => (await apiClient.post<RemoteLink>(`/personal/notebooks/${id(notebookId)}/notebooklm-link`, { remote_notebook_id: remoteId })).data,
  associateSource: async (notebookId: string, request: { remote_notebook_id: string; remote_source_id: string; source_version_id: string; user_confirmed: true }) => (await apiClient.post(`/personal/notebooks/${id(notebookId)}/notebooklm-source-link`, request)).data,
  createNotebook: async (notebookId: string, title: string, idempotencyKey: string) => (await apiClient.post<BridgeJob>('/personal/notebooklm/notebooks', { notebook_id: notebookId, title, idempotency_key: idempotencyKey })).data,
  sync: async (notebookId: string, request: ScopeRequest) => (await apiClient.post<BridgeJob>(`/personal/notebooks/${id(notebookId)}/sync/notebooklm`, request)).data,
  importSources: async (notebookId: string, request: ScopeRequest & { include_text: boolean }) => (await apiClient.post<BridgeJob>(`/personal/notebooks/${id(notebookId)}/imports/notebooklm`, request)).data,
  audio: async (notebookId: string, request: ScopeRequest & { language: string }) => (await apiClient.post<BridgeJob>(`/personal/notebooks/${id(notebookId)}/artifacts/audio`, request)).data,
  artifacts: async (remoteId: string) => (await apiClient.get<RemoteArtifact[]>(`/personal/notebooklm/notebooks/${id(remoteId)}/artifacts`)).data,
  downloadArtifact: async (artifactId: string, request: { notebook_id: string; remote_notebook_id: string; idempotency_key: string }) => (await apiClient.post<BridgeJob>(`/personal/notebooklm/artifacts/${id(artifactId)}/download`, request)).data,
}
