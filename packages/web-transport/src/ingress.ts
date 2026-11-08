import type { RecoveryPhase } from './session-coordinator.js'
export function classifyAuthFailure(status: number, body: unknown): RecoveryPhase | null {
  const code = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error ? body.error.code : undefined
  if (code === 'NEEDS_REAUTH') return null
  if (status === 401 && code === 'AUTH_PENDING') return 'pending'
  if (status === 401 && code === 'ACCESS_EXPIRED') return 'refresh-needed'
  if (status === 401 && (code === 'AUTH_REQUIRED' || code === 'REFRESH_REJECTED')) return 'reauth-required'
  if ((status === 503 && code === 'AUTH_UNAVAILABLE') || (status === 429 && code === 'AUTH_BUSY')) return 'unavailable'
  return status === 401 ? 'unavailable' : null
}
export function classifyIngressResponse(response: Response, path: string): 'ingress-unavailable' | 'unexpected-response' | null {
  if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque' || response.status >= 300 && response.status < 400) return 'ingress-unavailable'
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'ingress-unavailable'
  if (response.status === 204 || response.status === 205) return null
  if (type === 'application/json' || /^application\/[\w.+-]+\+json$/.test(type)) return null
  if (type === 'text/event-stream' && /\/events(?:\?|$)/.test(path)) return null
  // Protected raw reads retain their binary/text stream; never classify it as application JSON.
  if (/\/(?:download|original|file|content|audio)(?:\?|$)/.test(path) && type) return null
  return 'unexpected-response'
}
/** Only errors are cloned. Successful SSE/binary responses are never buffered. */
export async function readBoundedAuthError(response: Response): Promise<unknown> {
  if (!/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) return null
  const reader = response.clone().body?.getReader(); if (!reader) return null
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 8192) { void reader.cancel(); return null }; chunks.push(value) }
    const all = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all)) as unknown
  } catch { return null } finally { reader.releaseLock() }
}
