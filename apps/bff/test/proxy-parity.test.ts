import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionProxy } from '../src/proxy.js'
import type { WebSessionConfig } from '../src/config.js'

const origin = 'https://workbench.example'
const config: WebSessionConfig = { mode: 'device_sessions', publicOrigin: origin, internalOrigin: 'http://internal:5055', cookieName: '__Host-sw-session', secure: true, nativePassthrough: false, webSessionProtocol: 'bff-memory-v1' }
const id = '12345678-1234-1234-1234-123456789abc'
const token = (prefix: string, byte = 1) => `${prefix}${Buffer.alloc(32, byte).toString('base64url')}`
const envelope = () => ({ session_id: id, access_token: token('swa1_'), refresh_token: token('swr1_'), access_expires_at: new Date(Date.now() + 600_000).toISOString(), refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString() })
const ready = () => Response.json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1 })
const publicMetadata = { version: '1.0.0', latestVersion: null, hasUpdate: false, dbStatus: 'online' }
function request(path: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return new Request(`${origin}${path}`, { method, headers: { ...(method !== 'GET' && method !== 'HEAD' ? { origin, 'x-studyworkbench-csrf': '1', 'content-type': 'application/json' } : {}), ...headers }, body })
}
function fixture(overrides: Partial<WebSessionConfig> = {}) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/status')) return ready()
    if (url.endsWith('/auth/sessions') && options?.method === 'POST') return Response.json(envelope(), { status: 201 })
    if (url.endsWith('/auth/sessions') && options?.method === 'GET') return Response.json({ sessions: [] })
    if (url.endsWith('/api/config')) return Response.json(publicMetadata)
    return Response.json({ ok: true })
  })
  return { fetchMock, proxy: createSessionProxy({ ...config, ...overrides }, { fetch: fetchMock }) }
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })
async function login(proxy: ReturnType<typeof createSessionProxy>) {
  const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, JSON.stringify({ password: 'synthetic-password', device_name: 'Browser' })))
  expect(response.status).toBe(201)
  return { response, cookie: response.headers.get('set-cookie')!.split(';')[0] }
}
async function active(proxy: ReturnType<typeof createSessionProxy>) {
  const result = await login(proxy)
  const response = await proxy.dispatch(request('/api/auth/status', 'GET', { cookie: result.cookie }))
  expect((await response.json()).web.phase).toBe('authenticated')
  return result.cookie
}

describe('Web BFF request boundary', () => {
  for (const path of ['/api/auth/sessions', '/api/auth/sessions/refresh', '/api/auth/web-signout-local', '/api/notes', '/api/search/ask', '/api/personal/imports/portable']) {
    for (const badOrigin of ['', 'null', 'https://evil.example', `${origin}, ${origin}`]) {
      it(`rejects unsafe ${path} Origin ${JSON.stringify(badOrigin)} before fetch/body`, async () => {
        const { proxy, fetchMock } = fixture()
        const req = request(path, 'POST', {}, '{}')
        if (badOrigin) req.headers.set('origin', badOrigin); else req.headers.delete('origin')
        const response = await proxy.dispatch(req)
        expect(response.status).toBe(403)
        expect(req.bodyUsed).toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()
      })
    }
  }
  it.each(['', '0', '1, 1'])('rejects absent/wrong CSRF %s before body', async csrf => {
    const { proxy, fetchMock } = fixture()
    const req = request('/api/notes', 'POST', { 'x-studyworkbench-csrf': csrf }, '{}')
    expect((await proxy.dispatch(req)).status).toBe(403)
    expect(req.bodyUsed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects foreign read Origin and cross-site Fetch Metadata', async () => {
    const { proxy, fetchMock } = fixture()
    expect((await proxy.dispatch(request('/api/auth/status', 'GET', { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await proxy.dispatch(request('/api/auth/status', 'GET', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects browser Authorization and ambiguous cookies before upstream', async () => {
    const { proxy, fetchMock } = fixture()
    for (const headers of [{ cookie: '__Host-sw-session=x', authorization: 'Bearer secret' }, { cookie: '__Host-sw-session=x; __Host-sw-session=x' }, { cookie: '__Host-sw-session=x; sw-session=x' }] as Record<string, string>[]) {
      expect((await proxy.dispatch(request('/api/auth/sessions', 'POST', headers, '{}'))).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps native passthrough off by default despite client-kind header', async () => {
    const { proxy, fetchMock } = fixture()
    const req = new Request(`${origin}/api/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-kind': 'native' }, body: '{}' })
    expect((await proxy.dispatch(req)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('metadata-only private-ingress bootstrap', () => {
  it.each([
    'private_ingress=synthetic',
    'private_ingress=synthetic; __Host-sw-session=malformed',
    'private_ingress=synthetic; __Host-sw-session=x; __Host-sw-session=y',
    '__Host-sw-session=x; sw-session=y; sw-access=obsolete; sw-refresh=obsolete',
    '__Host-sw-session=x, __Host-sw-session=y',
    `__Host-sw-session=${'x'.repeat(17000)}`,
  ])('ignores ambient app/ingress credentials only for exact public config (%s)', async cookie => {
    const { proxy, fetchMock } = fixture({ nativePassthrough: true })
    const response = await proxy.dispatch(request('/api/config', 'GET', {
      cookie, authorization: 'Bearer synthetic-native', origin, 'sec-fetch-site': 'same-origin',
      'x-studyworkbench-csrf': '1', 'x-forwarded-user': 'synthetic-owner',
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(publicMetadata)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('clear-site-data')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://internal:5055/api/auth/status', 'http://internal:5055/api/config'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('manual')
      expect(init?.body).toBeUndefined()
      expect([...new Headers(init?.headers).entries()]).toEqual([['accept', 'application/json'], ['accept-encoding', 'identity']])
    }
  })

  const rejectedReadHeaders: Record<string, string>[] = [{ origin: 'https://foreign.example' }, { origin: 'null' }, { origin: '' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-origin, same-origin' }]
  it.each(rejectedReadHeaders)('retains public config safe-read guards %j before upstream', async headers => {
    const { proxy, fetchMock } = fixture()
    const response = await proxy.dispatch(request('/api/config', 'GET', { ...headers, cookie: '__Host-sw-session=x; __Host-sw-session=y' }))
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['/api/auth/status', '/api/notes', '/api/auth/sessions'])('never ignores ambiguous cookies for %s', async path => {
    const { proxy, fetchMock } = fixture()
    expect((await proxy.dispatch(request(path, 'GET', { cookie: '__Host-sw-session=x; __Host-sw-session=y' }))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([['HEAD', '/api/config'], ['POST', '/api/config'], ['GET', '/api/%63onfig'], ['GET', '/api/config/extra']])('does not widen metadata exception to %s %s', async (method, path) => {
    const { proxy, fetchMock } = fixture()
    expect((await proxy.dispatch(request(path, method, { cookie: '__Host-sw-session=x; __Host-sw-session=y' }))).status).toBe(['HEAD', 'POST'].includes(method) ? 405 : 404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves credential-free legacy metadata compatibility and rejects backend replacement', async () => {
    const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
    fetchMock.mockResolvedValueOnce(Response.json({ auth_enabled: true, message: 'Authentication required' }))
    const headers = { cookie: 'private_ingress=synthetic; __Host-sw-session=x; __Host-sw-session=y', authorization: 'Bearer synthetic-password' }
    expect(await (await proxy.dispatch(request('/api/config', 'GET', headers))).json()).toEqual(publicMetadata)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has('authorization')).toBe(false)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has('cookie')).toBe(false)
    fetchMock.mockClear()
    expect((await proxy.dispatch(request('/api/config', 'GET', headers))).status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still fails backend mode mismatch before config dispatch despite stale app credentials', async () => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockResolvedValueOnce(Response.json({ auth_enabled: true, message: 'Authentication required' }))
    const response = await proxy.dispatch(request('/api/config', 'GET', { cookie: '__Host-sw-session=x; __Host-sw-session=y' }))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not confirm or alter a pending app session during metadata bootstrap', async () => {
    const { proxy, fetchMock } = fixture()
    const { cookie } = await login(proxy)
    fetchMock.mockClear()
    expect((await proxy.dispatch(request('/api/config', 'GET', { cookie }))).status).toBe(200)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://internal:5055/api/auth/status', 'http://internal:5055/api/config'])
    expect((await proxy.dispatch(request('/api/notes', 'GET', { cookie }))).status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['online', 'offline'])('returns only documented metadata, retaining dbStatus %s', async dbStatus => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockResolvedValueOnce(ready()).mockResolvedValueOnce(Response.json({
      ...publicMetadata, dbStatus, authenticated: true, web: { phase: 'authenticated' }, access_token: 'synthetic-secret',
    }, { headers: { 'Set-Cookie': '__Host-sw-session=forged', 'Clear-Site-Data': '"cookies"' } }))
    const response = await proxy.dispatch(request('/api/config'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...publicMetadata, dbStatus })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('clear-site-data')).toBeNull()
  })

  it.each([{ version: '1.0.0' }, { ...publicMetadata, latestVersion: '1.0.1' }])('preserves documented optional metadata compatibility %j', async metadata => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockResolvedValueOnce(ready()).mockResolvedValueOnce(Response.json(metadata))
    expect(await (await proxy.dispatch(request('/api/config'))).json()).toEqual(metadata)
  })

  it.each([{}, { ...publicMetadata, version: 7 }, { ...publicMetadata, latestVersion: {} },
    { ...publicMetadata, hasUpdate: 'yes' }, { ...publicMetadata, dbStatus: 'unknown' },
    { ...publicMetadata, version: 'x'.repeat(8193) }])('fails malformed/oversized metadata unavailable %j', async metadata => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockResolvedValueOnce(ready()).mockResolvedValueOnce(Response.json(metadata))
    const response = await proxy.dispatch(request('/api/config'))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
  })

  it('does not follow metadata redirects or reflect token-bearing error bytes', async () => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockResolvedValueOnce(ready()).mockResolvedValueOnce(new Response('synthetic-secret', { status: 307, headers: { location: 'https://foreign.example/token', 'set-cookie': 'forged=1' } }))
    const response = await proxy.dispatch(request('/api/config'))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toMatch(/synthetic-secret|foreign.example/)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves the metadata request signal instead of imposing the auth operation timeout', async () => {
    const { proxy, fetchMock } = fixture()
    const req = request('/api/config')
    expect((await proxy.dispatch(req)).status).toBe(200)
    expect(fetchMock.mock.calls[1][1]?.signal).toBe(req.signal)
  })
})

describe('Web wire shapes and custody', () => {
  it('publishes only metadata and one strictly scoped opaque login cookie', async () => {
    const { proxy } = fixture()
    const { response } = await login(proxy)
    const json = await response.json()
    expect(Object.keys(json).sort()).toEqual(['access_expires_at', 'generation', 'refresh_expires_at', 'session_id'])
    expect(JSON.stringify(json)).not.toMatch(/swa1_|swr1_|swb1_|synthetic-password/)
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toMatch(/^__Host-sw-session=swb1_[\w-]{43};/)
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Expires=${new Date(json.refresh_expires_at).toUTCString()}`]) expect(cookie).toContain(part)
    expect(cookie).not.toContain('Domain=')
  })
  it('public readiness alone never authenticates; status confirms handle and refresh never writes cookie', async () => {
    const { proxy } = fixture()
    const publicResponse = await proxy.dispatch(request('/api/auth/status'))
    expect((await publicResponse.json()).web).toEqual({ phase: 'anonymous', session: null })
    const cookie = await active(proxy)
    for (const req of [request('/api/auth/status', 'GET', { cookie }), request('/api/auth/sessions/refresh', 'POST', { cookie }, '{}'), request('/api/notes', 'GET', { cookie })]) {
      const response = await proxy.dispatch(req)
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('clear-site-data')).toBeNull()
    }
  })
  it('verifies actual backend status before login and fails closed on mismatch', async () => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockResolvedValueOnce(Response.json({ auth_enabled: true, auth_mode: 'legacy_password' }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, JSON.stringify({ password: 'synthetic-password', device_name: 'Browser' })))
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://internal:5055/api/auth/status')
  })
  it('prevents native refresh credentials in browser requests', async () => {
    const { proxy, fetchMock } = fixture()
    const response = await proxy.dispatch(request('/api/auth/sessions/refresh', 'POST', { cookie: '__Host-sw-session=x' }, JSON.stringify({ session_id: id, refresh_token: token('swr1_') })))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('AUTH_MIXED_CREDENTIALS')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('bounded auth parsing and sanitized responses', () => {
  it.each([
    [JSON.stringify({ password: '界'.repeat(1366), device_name: 'Browser' }), 400],
    [JSON.stringify({ password: 'x', device_name: ' ' }), 400],
    [JSON.stringify({ password: 'x', device_name: '界'.repeat(81) }), 400],
    [JSON.stringify({ password: 'x', device_name: 'Browser', extra: 'hidden' }), 400],
    ['[]', 400], ['not-json', 400], [' '.repeat(8193), 413],
  ])('rejects malformed/oversized login without upstream (%s)', async (body, status) => {
    const { proxy, fetchMock } = fixture()
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, body as string))
    expect(response.status).toBe(status)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('accepts maximum UTF8 password and Unicode codepoint device name, trimming before native create', async () => {
    const { proxy, fetchMock } = fixture()
    const password = '界'.repeat(1365) + 'a'
    const name = '😀'.repeat(80)
    expect((await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, JSON.stringify({ password, device_name: ` ${name} ` })))).status).toBe(201)
    const sent = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as string)
    expect(sent).toEqual({ password, device_name: name })
  })
  it('rejects non-JSON and length bombs before consuming body', async () => {
    const { proxy, fetchMock } = fixture()
    for (const [headers, status] of [[{ 'content-type': 'text/plain' }, 415], [{ 'content-length': '8193' }, 413], [{ 'content-length': '4, 4' }, 400]] as const) {
      const req = request('/api/auth/sessions', 'POST', headers, '{}')
      expect((await proxy.dispatch(req)).status).toBe(status)
      expect(req.bodyUsed).toBe(false)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('bounds chunked auth JSON and rejects invalid UTF8', async () => {
    const { proxy, fetchMock } = fixture()
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(4096).fill(32)) } }, { highWaterMark: 0 })
    const req = new Request(`${origin}/api/auth/sessions`, { method: 'POST', headers: { origin, 'x-studyworkbench-csrf': '1', 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
    expect((await proxy.dispatch(req)).status).toBe(413)
    expect(pulls).toBe(3)
    const bad = new Request(`${origin}/api/auth/sessions`, { method: 'POST', headers: { origin, 'x-studyworkbench-csrf': '1', 'content-type': 'application/json' }, body: new Uint8Array([123, 255, 125]) })
    expect((await proxy.dispatch(bad)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['extra', 'missing', 'bad-token', 'bad-date', 'wrong-status', 'html'])('rejects %s positive native envelope before cookie publication', async kind => {
    const { proxy, fetchMock } = fixture()
    const value: Record<string, unknown> = { ...envelope() }
    if (kind === 'extra') value.password = 'private-sentinel'
    if (kind === 'missing') delete value.refresh_token
    if (kind === 'bad-token') value.access_token = 'private-sentinel'
    if (kind === 'bad-date') value.access_expires_at = 'tomorrow'
    fetchMock.mockImplementation(async (url, options) => url.endsWith('/status') ? ready() : options?.method === 'POST'
      ? kind === 'html' ? new Response('private-sentinel') : Response.json(value, { status: kind === 'wrong-status' ? 200 : 201 })
      : Response.json({ sessions: [] }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"synthetic-password","device_name":"Browser"}'))
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).not.toMatch(/swa1_|swr1_|private-sentinel/)
  })
  it.each([['AUTH_INVALID_CREDENTIALS', 401, null], ['AUTH_RATE_LIMITED', 429, '9999999'], ['AUTH_UNAVAILABLE', 503, null]])('preserves safe login failure %s without reflecting upstream messages', async (code, status, retry) => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ error: { code, message: 'private-sentinel' } }, { status: status as number, headers: { ...(retry ? { 'retry-after': retry as string } : {}), 'set-cookie': 'bad=yes', 'clear-site-data': '*' } }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Browser"}'))
    expect(response.status).toBe(status)
    expect((await response.json()).error.code).toBe(code)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('clear-site-data')).toBeNull()
    if (status === 401) expect(response.headers.get('www-authenticate')).toBe('Bearer')
    if (retry) expect(response.headers.get('retry-after')).toBe('60')
  })
  it('only successful password login may migrate obsolete token cookies', async () => {
    const { proxy, fetchMock } = fixture()
    const obsolete = '__Host-sw-access=old-secret; __Host-sw-refresh=old-refresh; __Host-sw-session=old-id'
    expect((await proxy.dispatch(request('/api/notes', 'GET', { cookie: obsolete }))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', { cookie: obsolete }, '{"password":"x","device_name":"Browser"}'))
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toContain('__Host-sw-access=; Path=/; Max-Age=0')
    expect(response.headers.get('set-cookie')).toMatch(/__Host-sw-session=swb1_/)
    expect(fetchMock.mock.calls.every(([, init]) => !new Headers(init?.headers).has('cookie'))).toBe(true)
  })
  it('does not let pending or stale handles authorize resources', async () => {
    const { proxy, fetchMock } = fixture()
    const { cookie } = await login(proxy)
    fetchMock.mockClear()
    const pending = await proxy.dispatch(request('/api/notes', 'GET', { cookie }))
    expect(pending.status).toBe(401)
    expect((await pending.json()).error.code).toBe('AUTH_PENDING')
    expect(fetchMock).not.toHaveBeenCalled()
    const stale = await proxy.dispatch(request('/api/auth/status', 'GET', { cookie: `__Host-sw-session=${token('swb1_', 9)}` }))
    expect((await stale.json()).web).toEqual({ phase: 'reauth-required', session: null })
  })
})

describe('authoritative session management and local signout', () => {
  it('retires local handle during API outage without readiness and never clears cookie', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockClear().mockRejectedValue(new Error('private-sentinel'))
    const response = await proxy.dispatch(request('/api/auth/web-signout-local', 'POST', { cookie }, '{}'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ server_revocation: 'unconfirmed' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fetchMock.mock.calls.every(([url, init]) => url.endsWith(`/sessions/${id}`) && init?.method === 'DELETE')).toBe(true)
    expect((await proxy.dispatch(request('/api/notes', 'GET', { cookie }))).status).toBe(401)
  })
  it('uses the validated proof exactly once after capture retires revoke-all caller', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockClear()
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/status') ? ready() : init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ sessions: [] }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'DELETE', { cookie }))
    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toBeNull()
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(new Headers(deletes[0][1]?.headers).get('authorization')).toBe(`Bearer ${token('swa1_')}`)
    expect((await proxy.dispatch(request('/api/notes', 'GET', { cookie }))).status).toBe(401)
  })
  it.each([401, 429, 503, 200])('never claims confirmed revocation for native %s', async status => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/status') ? ready() : init?.method === 'DELETE'
      ? Response.json({ error: { code: status === 401 ? 'AUTH_REQUIRED' : status === 429 ? 'AUTH_RATE_LIMITED' : 'AUTH_UNAVAILABLE', message: 'private-sentinel' } }, { status }) : Response.json({ sessions: [] }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'DELETE', { cookie }))
    expect(response.status).toBe(status === 200 ? 502 : status)
    expect(await response.text()).not.toMatch(/confirmed|private-sentinel/)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
  it('does not dispatch management when protected authority is revoked', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ error: { code: 'AUTH_REQUIRED', message: 'private-sentinel' } }, { status: 401 }))
    expect((await proxy.dispatch(request('/api/auth/sessions', 'DELETE', { cookie }))).status).toBe(401)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })
  it('rejects request bodies on DELETE and forged local signout before native calls', async () => {
    const { proxy, fetchMock } = fixture()
    expect((await proxy.dispatch(request('/api/auth/sessions', 'DELETE', {}, '{}'))).status).toBe(400)
    expect((await proxy.dispatch(request('/api/auth/web-signout-local', 'POST', { cookie: '__Host-sw-session=forged' }, '{}'))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('transport and native separation', () => {
  it('passes native credentials only with the explicit nonambient gate, never a cookie', async () => {
    const { proxy, fetchMock } = fixture({ nativePassthrough: true })
    const req = new Request(`${origin}/api/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '52', cookie: 'platform=private' }, body: '{"password":"x","device_name":" Browser "}' })
    const response = await proxy.dispatch(req)
    expect(response.status).toBe(201)
    expect((await response.json()).access_token).toBe(token('swa1_'))
    expect(response.headers.get('set-cookie')).toBeNull()
    const native = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!
    expect(new Headers(native.headers).has('cookie')).toBe(false)
    expect(new Headers(native.headers).has('content-length')).toBe(false)
    expect(new Headers(native.headers).has('origin')).toBe(false)
  })
  it('still applies Web policy with passthrough enabled when any browser marker is present', async () => {
    const { proxy, fetchMock } = fixture({ nativePassthrough: true })
    for (const headers of [{ 'sec-fetch-mode': 'cors' }, { cookie: 'sw-session=x' }] as Record<string, string>[]) {
      const req = new Request(`${origin}/api/auth/sessions`, { method: 'POST', headers, body: '{}' })
      expect((await proxy.dispatch(req)).status).toBe(403)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sanitizes all actionable redirect statuses and never follows or echoes them', async () => {
    for (const status of [301, 302, 303, 305, 307, 308]) {
      const { proxy, fetchMock } = fixture()
      fetchMock.mockResolvedValueOnce(new Response('private-sentinel', { status, headers: { location: 'https://evil.example', 'set-cookie': 'bad=yes' } }))
      const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Browser"}'))
      expect(response.status).toBe(502)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(await response.text()).not.toContain('private-sentinel')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })
  it('reports readiness transport failure as auth unavailable, never a legacy downgrade', async () => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockRejectedValue(new Error('private-sentinel'))
    const response = await proxy.dispatch(request('/api/auth/status'))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
  })
  it('keeps the independent package free of framework/browser and legacy source imports', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const directory = new URL('../src/', import.meta.url)
    for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(name, directory), 'utf8')
      expect(source).not.toMatch(/(?:from|import)\s*['"](?:next|react|server-only|@\/|.*frontend)/)
    }
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(Object.keys(pkg.dependencies)).toEqual(['@study/contracts'])
  })
})

describe('resource streaming and exact HTTP equivalence', () => {
  it.each([200, 206, 304, 416])('preserves download %s, range/filename validators and untransformed length', async status => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    const bytes = new Uint8Array([0, 255, 1, 2])
    const upstream = new Response(status === 304 ? null : bytes, { status, headers: {
      'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''report%20v1.pdf",
      'content-range': status === 416 ? 'bytes */4' : 'bytes 0-3/4', 'accept-ranges': 'bytes', etag: '"version-1"',
      'last-modified': 'Wed, 21 Oct 2026 00:00:00 GMT', vary: 'Accept-Encoding', 'content-length': '4',
      'set-cookie': 'bad=yes', 'access-control-allow-origin': '*', connection: 'close', 'x-private-trace': 'private-sentinel', location: 'https://evil.example',
    } })
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : upstream)
    const req = request('/api/personal/source-versions/version%3Aone/download?download=true', 'GET', { cookie: `${cookie}; platform=secret`, origin,
      range: 'bytes=0-3', 'if-range': '"version-1"', 'if-none-match': '"version-0"', 'if-modified-since': 'Wed, 20 Oct 2026 00:00:00 GMT',
      host: 'evil.example', 'x-forwarded-for': 'private-sentinel', 'x-real-ip': 'private-sentinel' })
    const response = await proxy.dispatch(req)
    expect(response.status).toBe(status)
    expect(response.body).toBe(upstream.body)
    for (const name of ['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'vary', 'content-length']) expect(response.headers.get(name)).toBe(upstream.headers.get(name))
    for (const name of ['set-cookie', 'clear-site-data', 'access-control-allow-origin', 'connection', 'x-private-trace', 'location']) expect(response.headers.get(name)).toBeNull()
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(url).toBe('http://internal:5055/api/personal/source-versions/version%3Aone/download?download=true')
    const headers = new Headers(init?.headers)
    for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since', 'origin']) expect(headers.get(name)).toBe(req.headers.get(name))
    expect(headers.get('authorization')).toBe(`Bearer ${token('swa1_')}`)
    expect(headers.get('accept-encoding')).toBe('identity')
    for (const name of ['cookie', 'host', 'x-forwarded-for', 'x-real-ip']) expect(headers.has(name)).toBe(false)
    if (status !== 304) expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })
  it.each(['gzip', 'br', 'deflate'])('omits stale %s encoding and compressed content length', async encoding => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : new Response('decoded bytes', { headers: { 'content-encoding': encoding, 'content-length': '999' } }))
    const response = await proxy.dispatch(request('/api/podcasts/episodes/episode%3Aone/audio', 'GET', { cookie }))
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('decoded bytes')
  })
  it('only supports registered HEAD and never performs a mutation for OPTIONS', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : new Response(null, { headers: { 'content-length': '123', 'content-disposition': 'attachment; filename="test.pdf"' } }))
    const allowed = await proxy.dispatch(request('/api/sources/source%3Aone/download', 'HEAD', { cookie }))
    expect(allowed.status).toBe(200)
    expect(allowed.body).toBeNull()
    expect(allowed.headers.get('content-length')).toBe('123')
    expect(fetchMock.mock.calls.at(-1)![1]?.method).toBe('HEAD')
    fetchMock.mockClear()
    expect((await proxy.dispatch(request('/api/personal/exports/export%3Aone/download', 'HEAD', { cookie }))).status).toBe(405)
    const options = await proxy.dispatch(request('/api/notes', 'OPTIONS', { origin, 'access-control-request-method': 'POST' }))
    expect(options.status).toBe(204)
    expect(options.headers.get('allow')).toBe('GET, POST, OPTIONS')
    expect(options.headers.get('access-control-allow-origin')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['/api/commands/registry/debug', '/api/notebooks/n/anything', '/api/sources/a%2Fb/download', '/api/models/m', '/api/auth/anything'])('rejects unlisted or noncanonical route %s before dispatch', async path => {
    const { proxy, fetchMock } = fixture()
    expect((await proxy.dispatch(request(path))).status).toBe(path === '/api/models/m' ? 405 : 404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([403, 409, 429, 503, 401])('retains non-auth resource %s errors exactly without retrying/retiring', async status => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    const body = status === 401 ? '<html>private ingress login</html>' : JSON.stringify({ detail: 'original-resource-error', revision: 8 })
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : new Response(body, { status, headers: { 'content-type': status === 401 ? 'text/html' : 'application/json', 'retry-after': '999', 'x-internal': 'private-sentinel' } }))
    const response = await proxy.dispatch(request('/api/notes/note%3Aone', 'PUT', { cookie }, '{"content":"draft"}'))
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(body)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('x-internal')).toBeNull()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ sessions: [] }))
    expect((await (await proxy.dispatch(request('/api/auth/status', 'GET', { cookie }))).json()).web.phase).toBe('authenticated')
  })
  it('retires fresh typed AUTH_REQUIRED but never retries the original operation', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } }, { status: 401 }))
    expect((await proxy.dispatch(request('/api/notes', 'POST', { cookie }, '{"content":"draft"}'))).status).toBe(401)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    fetchMock.mockClear()
    expect((await proxy.dispatch(request('/api/notes', 'GET', { cookie }))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('preserves oversized JSON errors incrementally instead of cloning/buffering them all', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    let produced = 0
    const bytes = new TextEncoder().encode('x'.repeat(1024))
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { produced++; if (produced <= 50) controller.enqueue(bytes); else controller.close() } }, { highWaterMark: 0 })
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : new Response(stream, { status: 401, headers: { 'content-type': 'application/json' } }))
    const response = await proxy.dispatch(request('/api/notes', 'GET', { cookie }))
    expect(produced).toBeLessThan(12)
    expect(await response.text()).toBe('x'.repeat(50 * 1024))
  })
  it('classifies a late AUTH_REQUIRED on expired access as explicit refresh-needed', async () => {
    vi.useFakeTimers()
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockClear().mockImplementation(async url => {
      if (url.endsWith('/status')) return ready()
      vi.setSystemTime(Date.now() + 600_001)
      return Response.json({ error: { code: 'AUTH_REQUIRED', message: 'expired row pruned' } }, { status: 401 })
    })
    expect((await proxy.dispatch(request('/api/notes', 'POST', { cookie }, '{}'))).status).toBe(401)
    fetchMock.mockImplementation(async () => ready())
    const status = await proxy.dispatch(request('/api/auth/status', 'GET', { cookie }))
    expect((await status.json()).web.phase).toBe('refresh-needed')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('validates before reading any portable bytes, then forwards original stream/boundary/signal without a rewrite cap', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    let chunks = 0
    let authorized = false
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      expect(authorized).toBe(true)
      chunks++
      if (chunks <= 3) controller.enqueue(new Uint8Array([chunks])); else controller.close()
    } }, { highWaterMark: 0 })
    let forwarded: RequestInit | undefined
    fetchMock.mockClear().mockImplementation(async (url, init) => {
      if (url.endsWith('/status')) return ready()
      if (url.endsWith('/auth/sessions')) { authorized = true; return Response.json({ sessions: [] }) }
      forwarded = init
      // The authoritative API, not Next, owns the configured request/ZIP budget.
      const reader = (init!.body as ReadableStream<Uint8Array>).getReader()
      await reader.read(); await reader.read(); await reader.cancel()
      return Response.json({ detail: 'configured ZIP limit' }, { status: 413 })
    })
    const req = new Request(`${origin}/api/personal/imports/portable`, { method: 'POST', headers: { cookie, origin, 'x-studyworkbench-csrf': '1', 'content-type': 'multipart/form-data; boundary=original-boundary', 'content-length': String(150 * 1024 * 1024) }, body: stream, duplex: 'half' } as RequestInit)
    const response = await proxy.dispatch(req)
    expect(response.status).toBe(413)
    expect(chunks).toBe(2)
    expect(forwarded).toMatchObject({ body: req.body, signal: req.signal, duplex: 'half', redirect: 'manual' })
    const headers = new Headers(forwarded?.headers)
    expect(headers.get('content-type')).toBe('multipart/form-data; boundary=original-boundary')
    expect(headers.get('content-length')).toBe(String(150 * 1024 * 1024))
    expect(headers.get('origin')).toBe(origin)
    expect(headers.get('x-studyworkbench-csrf')).toBe('1')
    expect(headers.has('cookie')).toBe(false)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it.each(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE'])('consumes zero upload chunks when fresh probe fails %s', async code => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    let chunks = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array([1])) } }, { highWaterMark: 0 })
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ error: { code, message: 'private-sentinel' } }, { status: code === 'AUTH_REQUIRED' ? 401 : 503 }))
    const req = new Request(`${origin}/api/personal/imports/portable`, { method: 'POST', headers: { cookie, origin, 'x-studyworkbench-csrf': '1' }, body: stream, duplex: 'half' } as RequestInit)
    expect((await proxy.dispatch(req)).status).toBe(code === 'AUTH_REQUIRED' ? 401 : 503)
    expect(chunks).toBe(0)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
  it('streams GET turn events immediately and propagates cancellation once', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    const abort = new AbortController()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let canceled = 0
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value }, cancel() { canceled++ } })
    fetchMock.mockClear().mockImplementation(async url => url.endsWith('/status') ? ready() : new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    const req = new Request(`${origin}/api/personal/turns/turn%3Aone/events`, { headers: { cookie }, signal: abort.signal })
    const response = await proxy.dispatch(req)
    controller.enqueue(new TextEncoder().encode('data: first\n\n'))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n')
    await reader.cancel()
    expect(canceled).toBe(1)
    expect(fetchMock.mock.calls.at(-1)![1]?.signal).toBe(req.signal)
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/events'))).toHaveLength(1)
  })
})

describe('auth adapter bounds, isolation and legacy regression', () => {
  it('fails oversized native session-list responses unavailable, without reflecting or truncating rows', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    let lists = 0
    fetchMock.mockImplementation(async url => {
      if (url.endsWith('/status')) return ready()
      lists++
      return lists === 1 ? Response.json({ sessions: [] }) : new Response('{"sessions":[' + ' '.repeat(262144), { headers: { 'content-type': 'application/json' } })
    })
    const response = await proxy.dispatch(request('/api/auth/sessions', 'GET', { cookie }))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
  })
  it('preserves more than32 valid metadata rows instead of assuming every retained row is live', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    const now = new Date().toISOString()
    const sessions = Array.from({ length: 40 }, (_, index) => ({ session_id: `12345678-1234-1234-1234-${String(index).padStart(12, '0')}`,
      device_name: 'Synthetic browser', created_at: now, last_used_at: now, expires_at: envelope().refresh_expires_at,
      revoked_at: now, is_current: false }))
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ sessions }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'GET', { cookie }))
    expect(response.status).toBe(200)
    expect((await response.json()).sessions).toHaveLength(40)
  })
  it('never exposes extra native list fields to Web or treats them as successful protected authentication', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ sessions: [], refresh_token: 'private-sentinel' }))
    const response = await proxy.dispatch(request('/api/auth/status', 'GET', { cookie }))
    expect((await response.json()).web.phase).toBe('unavailable')
    const denied = await proxy.dispatch(request('/api/auth/sessions', 'GET', { cookie }))
    expect(denied.status).toBe(503)
    expect(await denied.text()).not.toContain('private-sentinel')
  })
  it('sanitizes a protected status probe redirect as502 rather than publishing readiness as authentication', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : new Response('private-sentinel', { status: 302, headers: { location: 'https://evil.example' } }))
    const response = await proxy.dispatch(request('/api/auth/status', 'GET', { cookie }))
    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).not.toContain('private-sentinel')
  })
  it('isolates refresh redirect502 to its observing owner; followers only see terminal reauth and no second rotation', async () => {
    vi.useFakeTimers()
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    vi.setSystemTime(Date.now() + 580_000)
    let resolve!: (response: Response) => void
    let arrived!: () => void
    const dispatched = new Promise<void>(yes => { arrived = yes })
    fetchMock.mockClear().mockImplementation(async url => {
      if (url.endsWith('/status')) return ready()
      if (url.endsWith('/refresh')) { arrived(); return new Promise<Response>(yes => { resolve = yes }) }
      return Response.json({ sessions: [] })
    })
    const owner = proxy.dispatch(request('/api/auth/sessions/refresh', 'POST', { cookie }, '{}'))
    await dispatched
    const follower = proxy.dispatch(request('/api/auth/sessions/refresh', 'POST', { cookie }, '{}'))
    // Parse the bounded follower request and reach the shared store flight.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    const independent = await proxy.dispatch(request('/api/auth/status'))
    expect(independent.status).toBe(200)
    resolve(new Response('private-sentinel', { status: 307, headers: { location: 'https://evil.example' } }))
    const [first, second] = await Promise.all([owner, follower])
    expect(first.status).toBe(502)
    expect(second.status).toBe(401)
    expect((await second.json()).error.code).toBe('AUTH_REQUIRED')
    expect(first.headers.get('location')).toBeNull()
    expect(await first.text()).not.toContain('private-sentinel')
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(1)
  })
  it('keeps validated Origin/CSRF request-local across concurrent native create adapters', async () => {
    const { proxy, fetchMock } = fixture({ nativePassthrough: true })
    let release!: () => void
    let started!: () => void
    const arrived = new Promise<void>(yes => { started = yes })
    const gate = new Promise<void>(yes => { release = yes })
    let first = true
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/status')) {
        if (first) { first = false; started(); await gate }
        return ready()
      }
      if (init?.method === 'POST') return Response.json(envelope(), { status: 201 })
      return new Response(null, { status: 204 })
    })
    const web = proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Web"}'))
    await arrived
    const native = await proxy.dispatch(new Request(`${origin}/api/auth/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"x","device_name":"Native"}' }))
    expect(native.status).toBe(201)
    release()
    expect((await web).status).toBe(201)
    const creates = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(creates).toHaveLength(2)
    expect(new Headers(creates[0][1]?.headers).has('origin')).toBe(false)
    expect(new Headers(creates[0][1]?.headers).has('x-studyworkbench-csrf')).toBe(false)
    expect(new Headers(creates[1][1]?.headers).get('origin')).toBe(origin)
    expect(new Headers(creates[1][1]?.headers).get('x-studyworkbench-csrf')).toBe('1')
  })
  it('only publishes the later-admitted successful Web login cookie, suppressing an older completion', async () => {
    const { proxy, fetchMock } = fixture()
    let release!: (response: Response) => void
    let started!: () => void
    const arrived = new Promise<void>(yes => { started = yes })
    let creates = 0
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/status')) return ready()
      if (init?.method === 'POST') {
        creates++
        if (creates === 1) { started(); return new Promise<Response>(yes => { release = yes }) }
        return Response.json({ ...envelope(), session_id: '22345678-1234-1234-1234-123456789abc' }, { status: 201 })
      }
      return new Response(null, { status: 204 })
    })
    const older = proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Older"}'))
    await arrived
    const newer = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Newer"}'))
    expect(newer.status).toBe(201)
    release(Response.json(envelope(), { status: 201 }))
    const suppressed = await older
    expect(suppressed.headers.get('set-cookie')).toBeNull()
    expect(suppressed.status).toBe(401)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  })
  it('keeps legacy status/password transport on reviewed routes', async () => {
    const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? Response.json({ auth_enabled: true, message: 'Authentication is required' }) : Response.json({ legacy: true }))
    const response = await proxy.dispatch(request('/api/auth/status'))
    expect(await response.json()).toEqual({ auth_enabled: true, message: 'Authentication is required' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockClear()
    const legacy = await proxy.dispatch(request('/api/notebooks', 'GET', { authorization: 'Bearer synthetic-legacy', cookie: 'platform=private' }))
    expect(legacy.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer synthetic-legacy')
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has('cookie')).toBe(false)
  })
})

describe('remaining boundary edge cases', () => {
  it.each([
    ['PUT', '/api/notes/note%3Aone'], ['PATCH', '/api/personal/notebooks/n/notes/note%3Aone'],
    ['DELETE', '/api/auth/sessions'], ['DELETE', `/api/auth/sessions/${id}`], ['DELETE', '/api/notes/note%3Aone'],
  ])('requires exact Origin plus CSRF on %s %s', async (method, path) => {
    const { proxy, fetchMock } = fixture()
    for (const missing of ['origin', 'x-studyworkbench-csrf']) {
      const req = request(path, method, {}, method === 'DELETE' ? undefined : '{}')
      req.headers.delete(missing)
      expect((await proxy.dispatch(req)).status).toBe(403)
      expect(req.bodyUsed).toBe(false)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects comma-coalesced duplicate Cookie headers even on fresh password login', async () => {
    const { proxy, fetchMock } = fixture()
    const req = request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Browser"}')
    req.headers.set('cookie', `__Host-sw-session=${token('swb1_')}, __Host-sw-session=${token('swb1_', 2)}`)
    const response = await proxy.dispatch(req)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(req.bodyUsed).toBe(false)
  })
  it('never expires old credential cookies after rejected migration login', async () => {
    const { proxy, fetchMock } = fixture()
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : Response.json({ error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'private-sentinel' } }, { status: 401 }))
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', { cookie: '__Host-sw-access=old; __Host-sw-refresh=old' }, '{"password":"wrong","device_name":"Browser"}'))
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
  it('does not lose a valid predecessor on wrong password', async () => {
    const { proxy, fetchMock } = fixture()
    const cookie = await active(proxy)
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/status') ? ready() : init?.method === 'POST'
      ? Response.json({ error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'private-sentinel' } }, { status: 401 }) : Response.json({ sessions: [] }))
    expect((await proxy.dispatch(request('/api/auth/sessions', 'POST', { cookie }, '{"password":"wrong","device_name":"Browser"}'))).status).toBe(401)
    expect((await (await proxy.dispatch(request('/api/auth/status', 'GET', { cookie }))).json()).web.phase).toBe('authenticated')
  })
  it('uses only explicitly configured insecure loopback cookie name, not a request Host downgrade', async () => {
    const { proxy } = fixture({ publicOrigin: 'http://127.0.0.1:3000', cookieName: 'sw-session', secure: false })
    const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', { origin: 'http://127.0.0.1:3000', host: 'evil.example', 'x-forwarded-proto': 'https' }, '{"password":"x","device_name":"Browser"}'))
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toMatch(/^sw-session=swb1_/)
    expect(response.headers.get('set-cookie')).not.toContain('Secure')
  })
  it('returns busy without forwarding a ninth admitted/pending login', async () => {
    const { proxy, fetchMock } = fixture()
    const pending: Promise<Response>[] = []
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? ready() : new Promise<Response>(() => {}))
    for (let i = 0; i < 8; i++) pending.push(proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Browser"}')))
    for (let i = 0; i < 30; i++) await Promise.resolve()
    const busy = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Browser"}'))
    expect(busy.status).toBe(429)
    expect((await busy.json()).error.code).toBe('AUTH_BUSY')
    expect(busy.headers.get('retry-after')).toBe('1')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(8)
    await vi.advanceTimersByTimeAsync(10_001)
    await Promise.all(pending)
  })
})

it('validates explicit native upload credentials before consuming portable bytes', async () => {
  const { proxy, fetchMock } = fixture({ nativePassthrough: true })
  let chunks = 0
  const body = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array([1])) } }, { highWaterMark: 0 })
  fetchMock.mockImplementation(async (url, init) => url.endsWith('/status') ? ready() : init?.method === 'GET'
    ? Response.json({ error: { code: 'AUTH_REQUIRED', message: 'private-sentinel' } }, { status: 401 }) : Response.json({ ok: true }))
  const req = new Request(`${origin}/api/personal/imports/portable`, { method: 'POST', headers: { authorization: `Bearer ${token('swa1_')}`, 'content-type': 'multipart/form-data; boundary=native' }, body, duplex: 'half' } as RequestInit)
  expect((await proxy.dispatch(req)).status).toBe(401)
  expect(chunks).toBe(0)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

it('fails closed if legacy Web is pointed at a device-mode backend, never forwarding native token JSON', async () => {
  const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
  const response = await proxy.dispatch(request('/api/auth/sessions', 'POST', {}, '{"password":"x","device_name":"Browser"}'))
  expect(response.status).toBe(503)
  expect(await response.text()).not.toMatch(/swa1_|swr1_|swb1_/)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

it.each(['/api/auth/sessions', '/api/%61uth/sessions', '/api/auth/%73essions', '/api/auth%2Fsessions'])('rejects legacy native-issuance escape %s before reading the body', async path => {
  const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
  const req = request(path, 'POST', {}, '{"password":"x","device_name":"Browser"}')
  expect((await proxy.dispatch(req)).status).toBe(path === '/api/auth/sessions' ? 503 : 404)
  expect(req.bodyUsed).toBe(false)
  expect(fetchMock).not.toHaveBeenCalled()
})
it('rejects actual device readiness when Web is configured legacy', async () => {
  const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
  const response = await proxy.dispatch(request('/api/auth/status'))
  expect(response.status).toBe(503)
  expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

describe('review: legacy resource mode boundary', () => {
  it.each([['POST', '/api/notes'], ['POST', '/api/search/ask'], ['POST', '/api/sources/s/chat/sessions/c/messages'], ['GET', '/api/notes']])('does not send native credentials through legacy %s %s to a device backend', async (method, path) => {
    const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
    const req = new Request(`${origin}${path}`, { method, headers: { origin, authorization: `Bearer ${token('swa1_')}`, cookie: '__Host-sw-session=app; platform=private', 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) })
    const response = await proxy.dispatch(req)
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
    expect(req.bodyUsed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://internal:5055/api/auth/status')
    expect(Object.fromEntries(new Headers(fetchMock.mock.calls[0][1]?.headers))).toEqual({ accept: 'application/json', 'accept-encoding': 'identity' })
  })
  it('consumes zero legacy multipart chunks on backend mode mismatch', async () => {
    const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
    let chunks = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array([1])) } }, { highWaterMark: 0 })
    const req = new Request(`${origin}/api/personal/imports/portable`, { method: 'POST', headers: { origin, authorization: `Bearer ${token('swa1_')}`, cookie: '__Host-sw-session=app' }, body, duplex: 'half' } as RequestInit)
    expect((await proxy.dispatch(req)).status).toBe(503)
    expect(chunks).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
  })
  it('never caches a successful legacy mode check across backend replacement', async () => {
    const { proxy, fetchMock } = fixture({ mode: 'legacy_password', publicOrigin: origin, webSessionProtocol: null })
    let device = false
    fetchMock.mockImplementation(async url => url.endsWith('/status') ? device ? ready() : Response.json({ auth_enabled: true, message: 'Authentication is required' }) : Response.json({ ok: true }))
    expect((await proxy.dispatch(request('/api/notes', 'POST', { authorization: 'Bearer legacy-synthetic' }, '{}'))).status).toBe(200)
    device = true
    const req = request('/api/notes', 'POST', { authorization: `Bearer ${token('swa1_')}` }, '{}')
    expect((await proxy.dispatch(req)).status).toBe(503)
    expect(req.bodyUsed).toBe(false)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/status'))).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})

it('reports known readiness mismatch as503 during due refresh without sending the native token', async () => {
  vi.useFakeTimers()
  const { proxy, fetchMock } = fixture()
  const cookie = await active(proxy)
  vi.setSystemTime(Date.now() + 580_000)
  fetchMock.mockClear().mockResolvedValue(Response.json({ auth_enabled: true, message: 'Authentication is required' }))
  const response = await proxy.dispatch(request('/api/auth/sessions/refresh', 'POST', { cookie }, '{}'))
  expect(response.status).toBe(503)
  expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('http://internal:5055/api/auth/status')
  expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('authorization')).toBe(false)
  expect(response.headers.get('set-cookie')).toBeNull()
})

it('keeps orphan cleanup redirects and incidental headers out of another caller context', async () => {
  vi.useFakeTimers()
  const { proxy, fetchMock } = fixture()
  let creates = 0
  const otherId = '22345678-1234-1234-1234-123456789abc'
  fetchMock.mockImplementation(async (url, init) => {
    if (url.endsWith('/status')) return ready()
    if (init?.method === 'POST') {
      creates++
      return Response.json({ ...envelope(), session_id: creates === 1 ? id : otherId,
        ...(creates === 1 ? { access_expires_at: new Date(Date.now() + 1000).toISOString(), refresh_expires_at: new Date(Date.now() + 1000).toISOString() } : {}) }, { status: 201 })
    }
    return Response.json({ sessions: [] })
  })
  await active(proxy)
  const cookie = await active(proxy)
  vi.setSystemTime(Date.now() + 1001)
  fetchMock.mockClear().mockImplementation(async (url, init) => {
    if (init?.method === 'DELETE') return new Response('private-sentinel', { status: 307, headers: { location: 'https://evil.example' } })
    return url.endsWith('/status') ? ready() : Response.json({ sessions: [] })
  })
  const response = await proxy.dispatch(request('/api/auth/status', 'GET', { cookie, origin, 'x-studyworkbench-csrf': '1' }))
  expect(response.status).toBe(200)
  expect((await response.json()).web.phase).toBe('authenticated')
  const cleanup = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
  expect(cleanup).toHaveLength(1)
  expect(cleanup[0][0]).toBe(`http://internal:5055/api/auth/sessions/${id}`)
  const headers = new Headers(cleanup[0][1]?.headers)
  for (const name of ['origin', 'x-studyworkbench-csrf', 'cookie']) expect(headers.has(name)).toBe(false)
  expect(headers.get('authorization')).toBe(`Bearer ${token('swa1_')}`)
  expect(response.headers.get('location')).toBeNull()
})
