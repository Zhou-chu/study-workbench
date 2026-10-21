import { prepareBrowserRequest, classifyAuthFailure, RequestNotDispatchedError } from './browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import type { AuthPhase, WebAuthStatus, WebSessionMetadata } from '@/lib/types/auth'

export class AuthRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly phase: AuthPhase | null) { super('Authentication request failed') }
}
export function parseSessionMetadata(value: unknown): WebSessionMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session metadata')
  const data = value as Record<string, unknown>
  if (Object.keys(data).sort().join(',') !== 'access_expires_at,generation,refresh_expires_at,session_id' ||
      typeof data.session_id !== 'string' || !data.session_id || data.session_id.length > 80 ||
      typeof data.access_expires_at !== 'string' || !Number.isFinite(Date.parse(data.access_expires_at)) ||
      typeof data.refresh_expires_at !== 'string' || !Number.isFinite(Date.parse(data.refresh_expires_at)) ||
      !Number.isSafeInteger(data.generation) || (data.generation as number) < 0) throw new Error('Invalid session metadata')
  return { session_id: data.session_id, access_expires_at: data.access_expires_at, refresh_expires_at: data.refresh_expires_at, generation: data.generation as number }
}
export function parseWebStatus(value: unknown): WebAuthStatus {
  const data = value as Partial<WebAuthStatus> | null
  if (!data || data.auth_enabled !== true || data.auth_mode !== 'device_sessions' || data.protocol_version !== 1 || !data.web ||
      !['anonymous', 'pending', 'authenticated', 'refresh-needed', 'reauth-required', 'unavailable'].includes(data.web.phase)) throw new Error('Invalid Web authentication status')
  const session = data.web.session === null ? null : parseSessionMetadata(data.web.session)
  if (data.web.phase === 'authenticated' && !session) throw new Error('Missing confirmed session metadata')
  return { auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: data.web.phase, session } }
}
async function request(method: string, path: string, body?: unknown, legacyPassword?: string, operation?: number, control?: 'known-device-local-signout') {
  if (control && (method !== 'POST' || path !== '/auth/web-signout-local')) throw new RequestNotDispatchedError('destination')
  // Own BFF retirement must not depend on native API readiness. The caller has
  // already established device mode; this exception cannot select another URL.
  const policy = control ? { url: '/api/auth/web-signout-local', headers: { 'X-StudyWorkbench-CSRF': '1' }, credentials: 'same-origin' as const, redirect: 'error' as const, mode: 'device_sessions' as const } : await prepareBrowserRequest(method, path)
  if (operation !== undefined && !sessionCoordinator.isCurrent(operation)) throw new RequestNotDispatchedError('superseded')
  const headers = new Headers(policy.headers)
  headers.set('Cache-Control', 'no-store')
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (legacyPassword !== undefined) {
    if (policy.mode !== 'legacy_password') throw new Error('Legacy authentication is disabled')
    headers.set('Authorization', `Bearer ${legacyPassword}`)
  }
  const response = await fetch(policy.url, { method, headers, credentials: policy.credentials, redirect: policy.redirect, cache: 'no-store', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) {
    let data: unknown = null
    try { data = await response.json() } catch { /* never expose raw bodies */ }
    // Only this explicit legacy auth probe understands the old middleware's
    // exact wrong-password shape. Never apply it to resource or device errors.
    const legacyInvalidPassword = policy.mode === 'legacy_password' && method === 'GET' && path === '/notebooks' && response.status === 401 &&
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json' &&
      !!data && typeof data === 'object' && Object.keys(data).length === 1 && (data as { detail?: unknown }).detail === 'Invalid password'
    const code = legacyInvalidPassword ? 'AUTH_INVALID_CREDENTIALS' : (data as { error?: { code?: unknown } } | null)?.error?.code
    throw new AuthRequestError(response.status, typeof code === 'string' ? code : 'UNKNOWN', legacyInvalidPassword ? 'reauth-required' : await classifyAuthFailure(response.status, data))
  }
  return response
}
export const authApi = {
  status: async () => (await request('GET', '/auth/status')).json() as Promise<unknown>,
  login: async (password: string, deviceName: string, operation?: number) => {
    const response = await request('POST', '/auth/sessions', { password, device_name: deviceName }, undefined, operation)
    if (response.status !== 201) throw new Error('Invalid login response')
    return parseSessionMetadata(await response.json())
  },
  refresh: async (operation?: number) => {
    const response = await request('POST', '/auth/sessions/refresh', {}, undefined, operation)
    if (response.status !== 200) throw new Error('Invalid refresh response')
    return parseSessionMetadata(await response.json())
  },
  revoke: async (sessionId?: string, operation?: number) => {
    const response = await request('DELETE', `/auth/sessions${sessionId ? `/${encodeURIComponent(sessionId)}` : ''}`, undefined, undefined, operation)
    if (response.status !== 204) throw new Error('Revocation was not confirmed')
  },
  signoutLocal: async (operation?: number) => {
    try {
      const response = await request('POST', '/auth/web-signout-local', {}, undefined, operation, 'known-device-local-signout')
      const data = await response.json()
      if (response.status !== 200 || data?.server_revocation !== 'unconfirmed') throw new Error('Local sign-out was not confirmed')
    } catch (error) {
      // This exact BFF control endpoint checks the own handle before returning
      // AUTH_REQUIRED. A retry after a lost 200 can confirm local absence only;
      // it says nothing about native revocation. Other 401s remain uncertain.
      if (!(error instanceof AuthRequestError && error.status === 401 && error.code === 'AUTH_REQUIRED')) throw error
    }
  },
  legacyProbe: async (password?: string, operation?: number) => { await request('GET', '/notebooks', undefined, password, operation) },
}
