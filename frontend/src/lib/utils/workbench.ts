import axios from 'axios'
export function requestError(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const detail = error.response?.data?.error || error.response?.data?.detail
  if (Array.isArray(detail)) return detail.map(item => typeof item?.msg === 'string' ? item.msg : '').filter(Boolean).join('; ') || null
  if (typeof detail === 'string') return detail
  if (detail && typeof detail.message === 'string') return detail.message
  if (detail && typeof detail.code === 'string') return detail.code
  return null
}
export const stateKeys: Record<string, string> = {
  queued: 'workbench.states.queued', running: 'workbench.states.running', waiting_remote: 'workbench.states.waiting_remote', succeeded: 'workbench.states.succeeded', failed: 'workbench.states.failed', needs_reauth: 'workbench.states.needs_reauth', submission_unknown: 'workbench.states.submission_unknown', cancelled_local: 'workbench.states.cancelled_local', ready: 'workbench.states.ready', completed: 'workbench.states.completed', pending: 'workbench.states.pending', extracting: 'workbench.states.extracting', needs_ocr: 'workbench.states.needs_ocr', partial: 'workbench.states.partial', unsupported: 'workbench.states.unsupported', available: 'workbench.states.available', missing: 'workbench.states.missing', unverified: 'workbench.states.unverified',
}
export const connectionKeys: Record<string, string> = {
  disconnected: 'workbench.connectionStates.disconnected', awaiting_user_login: 'workbench.connectionStates.awaiting_user_login', verifying: 'workbench.connectionStates.verifying', connected: 'workbench.connectionStates.connected', needs_reauth: 'workbench.connectionStates.needs_reauth', unavailable: 'workbench.connectionStates.unavailable',
}
