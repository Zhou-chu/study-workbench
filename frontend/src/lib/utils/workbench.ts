import axios from 'axios'
import type { KnownEngine } from '@/lib/types/personal'

export function isKnownEngine(value: unknown): value is KnownEngine {
  return value === 'independent' || value === 'notebooklm'
}
export function isKnownSelectionOrigin(value: unknown): value is 'local' | 'remote' {
  return value === 'local' || value === 'remote'
}

export function requestError(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const detail = error.response?.data?.error || error.response?.data?.detail
  if (Array.isArray(detail)) return detail.map(item => typeof item?.msg === 'string' ? item.msg : '').filter(Boolean).join('; ') || null
  if (typeof detail === 'string') return detail
  if (detail && typeof detail.message === 'string') return detail.message
  if (detail && typeof detail.code === 'string') return detail.code
  return null
}
/** Machine-readable error classification; never parses human/provider messages. */
export function requestErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const data = (error as { response?: { data?: { error?: unknown; detail?: unknown } } }).response?.data
  const detail = data?.error || data?.detail || error
  return detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string' ? (detail as { code: string }).code : null
}
export const stateKeys: Record<string, string> = {
  empty: 'workbench.states.empty', queued: 'workbench.states.queued', running: 'workbench.states.running', waiting_remote: 'workbench.states.waiting_remote', succeeded: 'workbench.states.succeeded', failed: 'workbench.states.failed', needs_reauth: 'workbench.states.needs_reauth', submission_unknown: 'workbench.states.submission_unknown', cancelled_local: 'workbench.states.cancelled_local', ready: 'workbench.states.ready', completed: 'workbench.states.completed', pending: 'workbench.states.pending', extracting: 'workbench.states.extracting', needs_ocr: 'workbench.states.needs_ocr', partial: 'workbench.states.partial', unsupported: 'workbench.states.unsupported', available: 'workbench.states.available', missing: 'workbench.states.missing', unverified: 'workbench.states.unverified',
}
export const connectionKeys: Record<string, string> = {
  disconnected: 'workbench.connectionStates.disconnected', awaiting_user_login: 'workbench.connectionStates.awaiting_user_login', verifying: 'workbench.connectionStates.verifying', connected: 'workbench.connectionStates.connected', needs_reauth: 'workbench.connectionStates.needs_reauth', unavailable: 'workbench.connectionStates.unavailable',
}

export const embeddingDestinationKeys = { on_device: 'workbench.destination_on_device', remote: 'workbench.destination_remote', unknown: 'workbench.destination_unknown' } as const
