import { vi } from 'vitest'
import { createSessionProxy } from '@/lib/api/session-proxy'
import type { WebSessionConfig } from '@/lib/api/session-proxy-policy'

export const origin = 'https://workbench.example'
export const config: WebSessionConfig = { mode: 'device_sessions', publicOrigin: origin, internalOrigin: 'http://internal:5055', cookieName: '__Host-sw-session', secure: true, nativePassthrough: false, webSessionProtocol: 'bff-memory-v1' }
export const id = '12345678-1234-1234-1234-123456789abc'
export const token = (prefix: string, byte = 1) => `${prefix}${Buffer.alloc(32, byte).toString('base64url')}`
export const envelope = () => ({ session_id: id, access_token: token('swa1_'), refresh_token: token('swr1_'), access_expires_at: new Date(Date.now() + 600_000).toISOString(), refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString() })
export const ready = () => Response.json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1 })
export const publicMetadata = { version: '1.0.0', latestVersion: null, hasUpdate: false, dbStatus: 'online' }
export function request(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return new Request(`${origin}${path}`, { method, headers: { ...(method !== 'GET' && method !== 'HEAD' ? { origin, 'x-studyworkbench-csrf': '1', 'content-type': 'application/json' } : {}), ...headers }, body })
}
export function fixture(overrides: Partial<WebSessionConfig> = {}) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/status')) return ready()
    if (url.endsWith('/auth/sessions') && options?.method === 'POST') return Response.json(envelope(), { status: 201 })
    if (url.endsWith('/auth/sessions') && options?.method === 'GET') return Response.json({ sessions: [] })
    if (url.endsWith('/api/config')) return Response.json(publicMetadata)
    return Response.json({ ok: true })
  })
  return { fetchMock, proxy: createSessionProxy({ ...config, ...overrides }, { fetch: fetchMock }) }
}
