import { RequestNotDispatchedError } from '@/lib/api/browser-transport'
export const noteProblemKeys = { conflict: 'noteConflict.conflict', unknown: 'noteConflict.unknown', rejected: 'noteConflict.rejected', 'not-sent': 'noteConflict.notSent', 'auth-rejected': 'noteConflict.authRejected' } as const
export interface NoteWriteProblem { kind: 'conflict' | 'unknown' | 'rejected' | 'not-sent' | 'auth-rejected'; currentRevision?: number }
// A transport failure or server error may follow a committed write. Never retry
// it automatically, or infer a new predecessor from the conflict response.
export function canRetryNoteWrite(problem: NoteWriteProblem | null): boolean {
  return !problem || problem.kind === 'not-sent' || problem.kind === 'auth-rejected'
}
export function noteWriteProblem(error: unknown): NoteWriteProblem {
  if (error instanceof RequestNotDispatchedError) return { kind: 'not-sent' }
  const response = (error as { response?: { status?: number; data?: { error?: { code?: string }; detail?: { code?: string; current_revision?: number } } } })?.response
  const detail = response?.data?.detail
  if (response?.status === 401 && ['AUTH_REQUIRED', 'ACCESS_EXPIRED', 'AUTH_PENDING'].includes(response.data?.error?.code || '')) return { kind: 'auth-rejected' }
  if (response?.status === 409 && detail?.code === 'NOTE_REVISION_CONFLICT') return { kind: 'conflict', currentRevision: detail.current_revision }
  return { kind: !response?.status || response.status >= 500 ? 'unknown' : 'rejected' }
}
