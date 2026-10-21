import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
const cfg = vi.hoisted(() => ({ authMode: 'device_sessions' as const, apiUrl: '', webSessionProtocol: 'bff-memory-v1' as const, version: 'fixture', buildTime: '2026-10-21' }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => cfg), resetConfig: vi.fn() }))
const metadata = { session_id: 'synthetic-session', access_expires_at: '2030-01-01T00:15:00Z', refresh_expires_at: '2030-01-31T00:00:00Z', generation: 0 }
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } })
const request = vi.fn<typeof fetch>()
beforeEach(() => { vi.resetModules(); request.mockReset(); vi.stubGlobal('fetch', request); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('review: a late resource error from before refresh acknowledgement must not invalidate refreshed state', async () => {
  const { useAuthStore: auth } = await import('../stores/auth-store')
  const { default: apiClient } = await import('./client')
  request.mockResolvedValueOnce(json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'authenticated', session: metadata } }))
  await auth.getState().bootstrap()
  let finishRefresh!: (r: Response) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve }))
  const refresh = auth.getState().refresh()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  let failResource!: () => void
  const resource = apiClient.get('/notebooks', { adapter: async config => new Promise((_, reject) => {
    failResource = () => reject(new AxiosError('expired earlier', 'ERR_BAD_REQUEST', config, undefined, { status: 401, statusText: 'Unauthorized', data: { error: { code: 'ACCESS_EXPIRED' } }, headers: {}, config }))
  }) }).catch(e => e)
  await vi.waitFor(() => expect(failResource).toBeDefined())
  finishRefresh(json({ ...metadata, generation: 1 })); expect(await refresh).toBe(true)
  expect(auth.getState().phase).toBe('authenticated')
  failResource(); await resource
  expect(auth.getState().phase).toBe('authenticated')
})
it('review: superseded revoke must not dispatch after a shared delayed mode lookup', async () => {
  const { getConfig } = await import('@/lib/config')
  let releaseConfig!: (value: typeof cfg) => void
  const configFlight = new Promise<typeof cfg>(resolve => { releaseConfig = resolve })
  vi.mocked(getConfig).mockImplementation(() => configFlight)
  const { useAuthStore: auth } = await import('../stores/auth-store')
  const revoke = auth.getState().revokeAll()
  const login = auth.getState().login('synthetic-password')
  request.mockImplementation(async (_url, init) => init?.method === 'DELETE'
    ? new Response(null, { status: 204 })
    : init?.method === 'POST' ? json(metadata, 201)
    : json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'authenticated', session: metadata } }))
  releaseConfig(cfg)
  await Promise.all([revoke, login])
  expect(request.mock.calls.map(([url, init]) => [url, init?.method])).not.toContainEqual(['/api/auth/sessions', 'DELETE'])
})
it('review: server supplied export paths must not select unrelated personal resource routes', async () => {
  const { portableApi } = await import('./portable')
  const { default: apiClient } = await import('./client')
  const adapter = vi.fn(async config => ({ status: 200, statusText: 'OK', data: new Blob(['private']), headers: {}, config }))
  apiClient.defaults.adapter = adapter
  await expect(portableApi.download('/personal/notebooks/synthetic/workspace')).rejects.toThrow()
  expect(adapter).not.toHaveBeenCalled()
})
it('review: legacy credential removal in another tab must stop sending the removed password', async () => {
  const { getAuthToken, purgeLegacyAuth } = await import('../auth-token')
  purgeLegacyAuth()
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-legacy-password' } }))
  expect(getAuthToken('legacy_password')).toBe('synthetic-legacy-password')
  // This is what a different tab's legacy signout does to shared origin storage.
  localStorage.removeItem('auth-storage')
  window.dispatchEvent(new StorageEvent('storage', { key: 'auth-storage', newValue: null, storageArea: localStorage }))
  expect(getAuthToken('legacy_password')).toBeNull()
})
it('a shared pending config promise cannot dispatch an obsolete revoke alongside a newer login', async () => {
  const { getConfig } = await import('@/lib/config')
  let release!: (value: typeof cfg) => void
  const shared = new Promise<typeof cfg>(resolve => { release = resolve })
  vi.mocked(getConfig).mockReturnValueOnce(shared).mockReturnValueOnce(shared)
  const { useAuthStore: auth } = await import('../stores/auth-store')
  const revoke = auth.getState().revokeAll()
  const login = auth.getState().login('synthetic-new-password')
  request.mockResolvedValueOnce(json(metadata, 201)).mockResolvedValueOnce(json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'authenticated', session: metadata } }))
  release(cfg)
  expect(await revoke).toBe(false); expect(await login).toBe(true)
  expect(request.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([['/api/auth/sessions', 'POST'], ['/api/auth/status', 'GET']])
})
