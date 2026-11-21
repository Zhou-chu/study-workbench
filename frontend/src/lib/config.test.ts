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
      expect(init).toEqual({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' })
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
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/config', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' })
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

it('purges old browser password immediately on validated device discovery, before backend config settles', async () => {
  resetConfig()
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-old-password' } }))
  let finish!: (response: Response) => void
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' }), { status: 200 }))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', request)
  const pending = getConfig().catch(error => error)
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(localStorage.getItem('auth-storage')).toBeNull()
  finish(new Response('{}', { status: 503 }))
  expect(await pending).toBeInstanceOf(Error)
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/config', '/api/config'])
  vi.unstubAllGlobals(); resetConfig(); localStorage.clear()
})

it('synthetic owner-private ingress permits metadata only with same-origin ambient-cookie policy', async () => {
  resetConfig()
  const request = vi.fn(async (input: string, init?: RequestInit) => {
    const req = new Request(new URL(input, window.location.origin), init)
    expect(req.credentials).toBe('same-origin'); expect(req.redirect).toBe('error')
    expect(req.headers.has('Authorization')).toBe(false); expect(req.headers.has('Cookie')).toBe(false)
    // Synthetic ingress gate: browser cookie eligibility, not a real cookie jar.
    if (req.credentials !== 'same-origin' || new URL(req.url).origin !== window.location.origin) return new Response(null, { status: 401 })
    return Response.json(input === '/config' ? { apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' } : { version: 'fixture' })
  })
  vi.stubGlobal('fetch', request)
  try { expect(await getConfig()).toMatchObject({ authMode: 'device_sessions', version: 'fixture' }); expect(request.mock.calls.map(([url]) => url)).toEqual(['/config', '/api/config']) }
  finally { vi.unstubAllGlobals(); resetConfig() }
})
it('cross-origin legacy metadata never opts into cross-origin cookies or explicit credentials', async () => {
  resetConfig()
  const requests: Request[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const req = new Request(new URL(input, window.location.origin), init); requests.push(req)
    return Response.json(input === '/config' ? { apiUrl: 'https://legacy-metadata.example', auth_mode: 'legacy_password' } : { version: 'fixture' })
  }))
  try {
    await getConfig()
    expect(requests[0].url).toBe(new URL('/config', window.location.origin).href)
    expect(new URL(requests[1].url).origin).not.toBe(window.location.origin)
    for (const req of requests) {
      expect(req.credentials).toBe('same-origin'); expect(req.redirect).toBe('error')
      expect(req.headers.has('Authorization')).toBe(false); expect(req.headers.has('Cookie')).toBe(false)
    }
  } finally { vi.unstubAllGlobals(); resetConfig() }
})
it.each(['/config', '/api/config'])('does not follow a synthetic ingress redirect from %s', async redirectAt => {
  resetConfig()
  const request = vi.fn(async (input: string, init?: RequestInit) => {
    expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('same-origin')
    if (input === redirectAt) throw new TypeError('synthetic cross-origin redirect blocked')
    return Response.json({ apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' })
  })
  vi.stubGlobal('fetch', request)
  try {
    await expect(getConfig()).rejects.toThrow()
    expect(request.mock.calls.map(([url]) => url)).toEqual(redirectAt === '/config' ? ['/config'] : ['/config', '/api/config'])
  } finally { vi.unstubAllGlobals(); resetConfig() }
})
