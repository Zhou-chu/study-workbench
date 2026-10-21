export const noteProblemKeys = { conflict: 'noteConflict.conflict', unknown: 'noteConflict.unknown', rejected: 'noteConflict.rejected' } as const
export interface NoteWriteProblem { kind: 'conflict' | 'unknown' | 'rejected'; currentRevision?: number }
// A transport failure or server error may follow a committed write. Never retry
// it automatically, or infer a new predecessor from the conflict response.
export function noteWriteProblem(error: unknown): NoteWriteProblem {
  const response = (error as { response?: { status?: number; data?: { detail?: { code?: string; current_revision?: number } } } })?.response
  const detail = response?.data?.detail
  if (response?.status === 409 && detail?.code === 'NOTE_REVISION_CONFLICT') return { kind: 'conflict', currentRevision: detail.current_revision }
  return { kind: !response?.status || response.status >= 500 ? 'unknown' : 'rejected' }
}
