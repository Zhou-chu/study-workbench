import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getApiUrl, getConfig, resetConfig } from './config'

describe('Config Priority', () => {
  const originalEnv = process.env
  const originalFetch = global.fetch
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    resetConfig()
    process.env = { ...originalEnv }
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it('should prioritize runtime config over everything else', async () => {
    // Setup: Env var set, Runtime config returns explicit value
    process.env.NEXT_PUBLIC_API_URL = 'http://env-url.com'
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ apiUrl: 'http://runtime-url.com' }),
    } as Response)

    // Mock the second fetch call (api/config check)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    const url = await getApiUrl()
    expect(url).toBe('http://runtime-url.com')
  })

  it('should fall back to env var if runtime config returns empty/null', async () => {
    // Setup: Env var set, Runtime config returns empty string (simulating not set)
    process.env.NEXT_PUBLIC_API_URL = 'http://env-url.com'
    
    // First fetch: /config returns empty apiUrl
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ apiUrl: '' }),
    } as Response)

    // Second fetch: api/config check using env url
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    const url = await getApiUrl()
    expect(url).toBe('http://env-url.com')
  })

  it('should fall back to env var if runtime config returns empty object', async () => {
    // Setup: Env var set, Runtime config returns empty object
    process.env.NEXT_PUBLIC_API_URL = 'http://env-url.com'
    
    // First fetch: /config returns {}
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // Missing apiUrl
    } as Response)

    // Second fetch: api/config check using env url
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    const url = await getApiUrl()
    expect(url).toBe('http://env-url.com')
  })

  it('should use default (relative path) if both runtime and env are missing', async () => {
    // Setup: Env var NOT set, Runtime config returns empty
    delete process.env.NEXT_PUBLIC_API_URL
    
    // First fetch: /config returns empty
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ apiUrl: '' }),
    } as Response)

    // Second fetch: api/config check using default relative path
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response)

    const url = await getApiUrl()
    expect(url).toBe('')
  })
})

describe('Session configuration bootstrap', () => {
  const fetchMock = vi.fn()
  const runtime = { apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' }
  const backend = { version: '1.0.0', dbStatus: 'online' }
  const ok = (body: unknown) => ({ ok: true, json: async () => body })
  beforeEach(() => {
    resetConfig()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://external.example')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('treats device empty apiUrl as authoritative and publishes only nonsecret metadata', async () => {
    fetchMock.mockResolvedValueOnce(ok(runtime)).mockResolvedValueOnce(ok(backend))
    const config = await getConfig()
    expect(config).toMatchObject({ apiUrl: '', authMode: 'device_sessions', webSessionProtocol: 'bff-memory-v1', version: '1.0.0' })
    expect(Object.keys(config).sort()).toEqual(['apiUrl', 'authMode', 'buildTime', 'dbStatus', 'hasUpdate', 'latestVersion', 'version', 'webSessionProtocol'].sort())
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/config', '/api/config'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual({ cache: 'no-store', credentials: 'omit', redirect: 'error' })
    }
  })

  it.each([
    { ...runtime, auth_mode: '' }, { ...runtime, auth_mode: null }, { ...runtime, auth_mode: 'unknown' },
    { ...runtime, web_session_protocol: undefined }, { ...runtime, web_session_protocol: 1 },
    { ...runtime, web_session_protocol: 'three-cookie-v0' }, { ...runtime, apiUrl: 'https://external.example' },
    { ...runtime, apiUrl: '/api' }, { ...runtime, apiUrl: undefined },
    { ...runtime, auth_mode: 'legacy_password' }, { apiUrl: '', web_session_protocol: 'bff-memory-v1' },
    null, [], { auth_mode: 'legacy_password', apiUrl: 123 },
  ])('refuses explicit incompatible metadata before API dispatch: %j', async metadata => {
    fetchMock.mockResolvedValueOnce(ok(metadata)).mockResolvedValueOnce(ok(backend))
    await expect(getApiUrl()).rejects.toThrow('Web session configuration unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['network', 'http', 'malformed'])('stops %s bootstrap failure without reading/sending saved password or falling back', async kind => {
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'old-password' } }))
    const storedPasswordRead = vi.spyOn(Storage.prototype, 'getItem')
    if (kind === 'network') fetchMock.mockRejectedValueOnce(new Error('network unavailable'))
    if (kind === 'http') fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    if (kind === 'malformed') fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('invalid JSON') } })
    await expect(getApiUrl()).rejects.toThrow('Web session configuration unavailable')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/config', { cache: 'no-store', credentials: 'omit', redirect: 'error' })
    expect(storedPasswordRead).not.toHaveBeenCalled()
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('old-password')
    localStorage.removeItem('auth-storage')
  })

  it('keeps successful explicit legacy metadata on the legacy config path', async () => {
    fetchMock.mockResolvedValueOnce(ok({ apiUrl: 'https://legacy.example', auth_mode: 'legacy_password', web_session_protocol: null }))
      .mockResolvedValueOnce(ok(backend))
    expect(await getConfig()).toMatchObject({ apiUrl: 'https://legacy.example', authMode: 'legacy_password', webSessionProtocol: null })
    expect(fetchMock.mock.calls[1][0]).toBe('https://legacy.example/api/config')
  })
})
