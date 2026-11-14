import axios from 'axios'

// Only the machine-readable safety fields are consumed. Backend messages, URLs
// and IDs are neither displayed nor treated as proof that a write was committed.
interface UploadCommitUnknown { code: 'UPLOAD_COMMIT_UNKNOWN'; retry_safe: false }
export type UploadRetryProblem = 'commit-unknown' | 'unrecognized-detail'
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isCommitUnknown = (value: unknown): value is UploadCommitUnknown => record(value) && value.code === 'UPLOAD_COMMIT_UNKNOWN' && value.retry_safe === false

export function uploadRetryProblem(error: unknown): UploadRetryProblem | undefined {
  if (!axios.isAxiosError(error)) return
  const data: unknown = error.response?.data
  if (!record(data)) return
  // A wrapper must not hide an explicit unsafe marker behind a plain detail or
  // a request-validation array. Check only these bounded, supported envelopes.
  const envelopes = [data.detail, data.error, data]
  if (envelopes.some(isCommitUnknown)) return 'commit-unknown'
  if (envelopes.some(value => record(value) && (value.code === 'UPLOAD_COMMIT_UNKNOWN' || Object.hasOwn(value, 'retry_safe')))) return 'unrecognized-detail'
  if (!Object.hasOwn(data, 'detail')) return
  const detail: unknown = data.detail
  // Preserve existing plain rejections and FastAPI request-validation errors.
  // Unknown structured outcomes (including retry_safe:true) never authorize replay.
  if (typeof detail === 'string') return
  if (error.response?.status === 422 && Array.isArray(detail) && detail.length > 0 && detail.every(item =>
    record(item) && typeof item.msg === 'string' && typeof item.type === 'string' && Array.isArray(item.loc) &&
    item.loc.every(part => typeof part === 'string' || (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)) &&
    !Object.hasOwn(item, 'code') && !Object.hasOwn(item, 'retry_safe')
  )) return
  return 'unrecognized-detail'
}
