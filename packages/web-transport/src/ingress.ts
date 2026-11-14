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
/** Only the existing variable-MIME artifact contract admits opaque HTML.
 * Attachment syntax is a compatibility boundary, never authentication evidence.
 */
function htmlArtifactAttachment(response: Response, path: string): boolean {
  if (!/^\/personal\/artifacts\/(?:[a-zA-Z0-9_:-]|%3[aA])+\/download$/.test(path)
    || ![200, 206].includes(response.status) || response.headers.has('location')) return false
  const disposition = response.headers.get('content-disposition')?.trim()
  if (!disposition || !/^attachment(?=\s*(?:;|$))/i.test(disposition)) return false
  let rest = disposition.slice('attachment'.length).trim()
  const names = new Set<string>()
  while (rest) {
    const part = /^;\s*([!#$%&'*+.^_`|~0-9a-z-]+)\s*=\s*("(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"|[!#$%&'*+.^_`|~0-9a-z-]+)\s*/i.exec(rest)
    if (!part) return false
    const name = part[1]!.toLowerCase(), value = part[2]!
    if (names.has(name)) return false
    names.add(name)
    if (name === 'filename*') {
      if (!/^utf-8''(?:[!#$&+.^_`|~0-9a-z-]|%[0-9a-f]{2})+$/i.test(value)) return false
      try { decodeURIComponent(value.slice(7)) } catch { return false }
    }
    rest = rest.slice(part[0].length)
  }
  return true
}
export function classifyIngressResponse(response: Response, path: string): 'ingress-unavailable' | 'unexpected-response' | null {
  if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque' || response.status >= 300 && response.status < 400) return 'ingress-unavailable'
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'text/html' || type === 'application/xhtml+xml') return htmlArtifactAttachment(response, path) ? null : 'ingress-unavailable'
  if (response.status === 204 || response.status === 205) return null
  if (type === 'application/json' || /^application\/[\w.+-]+\+json$/.test(type)) return null
  if (type === 'text/event-stream' && (/^\/search\/ask(?:\?|$)/.test(path) || /\/events(?:\?|$)/.test(path) || /^\/sources\/[^/?#]+\/chat\/sessions\/[^/?#]+\/messages(?:\?|$)/.test(path))) return null
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
