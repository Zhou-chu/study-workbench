import { getConfig } from '@/lib/config'
import { getAuthToken, purgeLegacyAuth } from '@/lib/auth-token'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import type { AuthPhase } from '@/lib/types/auth'
import { browserTurnTarget } from './browser-target'
import { readTurnContext, sameTurnTarget, type TurnContext, type TurnTarget } from '@/lib/workbench/turn-context'

const notDispatchedErrors = new WeakSet<object>()
/** Only constructed locally before dispatch; never inferred from remote flags. */
export class RequestNotDispatchedError extends Error {
  constructor(readonly reason: 'authentication' | 'configuration' | 'destination' | 'superseded') {
    super('Request was not sent')
    this.name = 'RequestNotDispatchedError'
    notDispatchedErrors.add(this)
  }
}
/** Axios may wrap the thrown error. Only a locally branded cause is evidence. */
export function asRequestNotDispatchedError(error: unknown): RequestNotDispatchedError | null {
  const seen = new Set<object>()
  let candidate = error
  while (candidate && typeof candidate === 'object' && !seen.has(candidate)) {
    if (notDispatchedErrors.has(candidate)) return candidate as RequestNotDispatchedError
    seen.add(candidate)
    candidate = Object.getOwnPropertyDescriptor(candidate, 'cause')?.value
  }
  return null
}
export function assertTurnDispatch(captured: TurnContext, policyTarget?: TurnTarget): void {
  const current = readTurnContext()
  if (!current) throw new RequestNotDispatchedError('configuration')
  if (current.epoch !== captured.epoch || !sameTurnTarget(current.target, captured.target)) throw new RequestNotDispatchedError('superseded')
  if (!captured.ready || !current.ready) throw new RequestNotDispatchedError('configuration')
  if (policyTarget && !sameTurnTarget(captured.target, policyTarget)) throw new RequestNotDispatchedError('destination')
}
const recoveryErrors = new WeakSet<object>()
export function rememberAuthRecoveryError(error: unknown): void {
  if (error && typeof error === 'object') recoveryErrors.add(error)
}
export function isAuthRecoveryError(error: unknown): boolean {
  const local = asRequestNotDispatchedError(error)
  if (local) return local.reason === 'authentication' || local.reason === 'configuration'
  if (!error || typeof error !== 'object') return false
  if (recoveryErrors.has(error)) return true
  const response = (error as { response?: { status?: number; data?: { error?: { code?: string } } } }).response
  const code = response?.data?.error?.code
  if (code === 'NEEDS_REAUTH') return false
  return (response?.status === 401 && ['AUTH_REQUIRED', 'ACCESS_EXPIRED', 'AUTH_PENDING', 'REFRESH_REJECTED'].includes(code || '')) ||
    (response?.status === 503 && code === 'AUTH_UNAVAILABLE') || (response?.status === 429 && code === 'AUTH_BUSY')
}
export function assertResourceDispatch(): void {
  const phase = sessionCoordinator.resourcePhase()
  if (phase && phase !== 'authenticated') throw new RequestNotDispatchedError('authentication')
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const MAX_AUTH_ERROR_BYTES = 8192

/** Only relative canonical API paths may receive application credentials.
 * Encoded slashes in resource IDs are retained; decoded traversal is rejected.
 */
export function protectedApiPath(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//') || /[\\#\u0000-\u0020\u007f]/.test(url)) throw new RequestNotDispatchedError('destination')
  let decoded = url.split('?')[0]
  try {
    for (let i = 0; i < 4; i++) {
      if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) throw new Error()
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    if (/%(?:25|2e|5c)/i.test(decoded) || /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) throw new Error()
  } catch { throw new RequestNotDispatchedError('destination') }
  const path = url.startsWith('/api/') ? url.slice(4) : url
  if (path === '/' || path === '/api') throw new RequestNotDispatchedError('destination')
  return path
}

export async function prepareBrowserRequest(method: string, url: string) {
  const path = protectedApiPath(url)
  const epoch = sessionCoordinator.current()
  let config: Awaited<ReturnType<typeof getConfig>>
  try { config = await getConfig() } catch { sessionCoordinator.report('unavailable', epoch); throw new RequestNotDispatchedError('configuration') }
  const target = browserTurnTarget(config)
  const headers: Record<string, string> = {}
  if (config.authMode === 'device_sessions') {
    purgeLegacyAuth()
    if (!SAFE_METHODS.has(method.toUpperCase())) headers['X-StudyWorkbench-CSRF'] = '1'
    return { url: `/api${path}`, headers, credentials: 'same-origin' as const, redirect: 'error' as const, mode: config.authMode, target }
  }
  if (config.authMode !== 'legacy_password') throw new Error('Web session configuration unavailable')
  const base = config.apiUrl ? target.apiBase.slice(0, -4) : ''
  const token = getAuthToken('legacy_password')
  if (token) headers.Authorization = `Bearer ${token}`
  return { url: `${base}/api${path}`, headers, credentials: 'omit' as const, redirect: 'error' as const, mode: config.authMode, target }
}

async function boundedError(body: unknown): Promise<unknown> {
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.size > MAX_AUTH_ERROR_BYTES || !/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(body.type)) return null
    try {
      // FileReader covers browsers where Blob.text is unavailable too.
      const text = typeof body.text === 'function' ? await body.text() : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(body)
      })
      return JSON.parse(text)
    } catch { return null }
  }
  return body
}
export async function classifyAuthFailure(status: number, body: unknown): Promise<Extract<AuthPhase, 'pending' | 'refresh-needed' | 'reauth-required' | 'unavailable'> | null> {
  const data = await boundedError(body)
  const code = data && typeof data === 'object' && 'error' in data ? (data as { error?: { code?: unknown } }).error?.code : undefined
  if (code === 'NEEDS_REAUTH') return null
  if (status === 401 && code === 'AUTH_PENDING') return 'pending'
  if (status === 401 && code === 'ACCESS_EXPIRED') return 'refresh-needed'
  if (status === 401 && (code === 'AUTH_REQUIRED' || code === 'REFRESH_REJECTED')) return 'reauth-required'
  if ((status === 503 && code === 'AUTH_UNAVAILABLE') || (status === 429 && code === 'AUTH_BUSY')) return 'unavailable'
  // HTML/private-ingress 401 is not evidence that the app session is revoked.
  return status === 401 ? 'unavailable' : null
}

/** One dispatch, original body/signal/stream semantics, no mutation replay. */
export async function browserFetch(url: string, init: RequestInit = {}): Promise<Response> {
  assertResourceDispatch()
  const policy = await prepareBrowserRequest(init.method || 'GET', url)
  assertResourceDispatch()
  const headers = new Headers(init.headers)
  headers.delete('Authorization')
  headers.delete('X-StudyWorkbench-CSRF')
  Object.entries(policy.headers).forEach(([name, value]) => headers.set(name, value))
  const generation = sessionCoordinator.current()
  let response: Response
  try {
    response = await fetch(policy.url, { ...init, headers, credentials: policy.credentials, redirect: policy.redirect })
  } catch (error) {
    if (!init.signal?.aborted && !(error instanceof Error && error.name === 'AbortError')) sessionCoordinator.report('unavailable', generation)
    throw error
  }
  if (!response.ok) {
    // Bounded clone only on errors. Successful SSE is never buffered or cloned.
    let body: unknown = null
    if (response.headers.get('content-type')?.includes('application/json')) {
      const reader = response.clone().body?.getReader()
      if (reader) {
        const chunks: Uint8Array[] = []; let bytes = 0
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break
            bytes += value.byteLength
            if (bytes > MAX_AUTH_ERROR_BYTES) { void reader.cancel(); break }
            chunks.push(value)
          }
          if (bytes <= MAX_AUTH_ERROR_BYTES) {
            const all = new Uint8Array(bytes); let offset = 0
            chunks.forEach(chunk => { all.set(chunk, offset); offset += chunk.length })
            body = JSON.parse(new TextDecoder().decode(all))
          }
        } catch { /* preserve the original error response */ }
      }
    }
    const phase = await classifyAuthFailure(response.status, body)
    if (phase) sessionCoordinator.report(phase, generation)
  }
  return response
}
