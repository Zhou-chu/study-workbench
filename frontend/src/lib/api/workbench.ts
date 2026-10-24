import apiClient from './client'
import type { BridgeJob, TurnSubmissionResponse, CreateWorkbenchNoteInput, UpdateWorkbenchNoteInput, TurnRecord, TurnRequest, WorkbenchNote, WorkbenchSelection, Workspace } from '@/lib/types/personal'
const id = encodeURIComponent
export const workbenchApi = {
  // Keep opaque workspace fields losslessly; consumers opt into the read projection.
  workspace: async (notebookId: string) => (await apiClient.get<Workspace>(`/personal/notebooks/${id(notebookId)}/workspace`)).data,
  saveSelection: async (notebookId: string, selection: WorkbenchSelection) => (await apiClient.patch(`/personal/notebooks/${id(notebookId)}/selection`, selection)).data,
  upload: async (notebookId: string, file: File, idempotencyKey: string, sourceId?: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('title', file.name)
    form.append('idempotency_key', idempotencyKey)
    if (sourceId) form.append('source_id', sourceId)
    return (await apiClient.post<{ source_id: string; source_version_id: string; job_id: string }>(`/personal/notebooks/${id(notebookId)}/sources/upload`, form)).data
  },
  turn: async (sessionId: string, request: TurnRequest) => (await apiClient.post<TurnSubmissionResponse>(`/personal/chats/${id(sessionId)}/turns`, request)).data,
  turns: async (sessionId: string) => (await apiClient.get<TurnRecord[]>(`/personal/chats/${id(sessionId)}/turns`)).data,
  saveNote: async (notebookId: string, note: CreateWorkbenchNoteInput) => (await apiClient.post<WorkbenchNote>(`/personal/notebooks/${id(notebookId)}/notes`, note)).data,
  updateNote: async (notebookId: string, noteId: string, note: UpdateWorkbenchNoteInput) => (await apiClient.patch<WorkbenchNote>(`/personal/notebooks/${id(notebookId)}/notes/${id(noteId)}`, note)).data,
  job: async (jobId: string, signal?: AbortSignal) => (await apiClient.get<BridgeJob>(`/personal/jobs/${id(jobId)}`, { signal })).data,
  cancelJob: async (jobId: string) => (await apiClient.post<BridgeJob>(`/personal/jobs/${id(jobId)}/cancel`)).data,
}
