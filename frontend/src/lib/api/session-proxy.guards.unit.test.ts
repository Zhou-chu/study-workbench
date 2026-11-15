import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { origin, request, fixture } from '@/test/session-proxy-fixtures'

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

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
})
