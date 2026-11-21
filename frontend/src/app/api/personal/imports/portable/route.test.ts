import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function stubLegacyFetch(fetchMock: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url.endsWith('/api/auth/status')
    ? Promise.resolve(Response.json({ auth_enabled: true, message: 'Authentication is required' }))
    : fetchMock(url, init))
}
function request(headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request('http://untrusted.example/api/personal/imports/portable?target=https://evil.example', {
    method: 'POST', headers, body: 'multipart bytes', signal,
  })
}
describe('streaming portable restore proxy', () => {
  it('forwards the original stream, authentication and multipart boundary only to configured backend', async () => {
    vi.stubEnv('INTERNAL_API_URL', 'http://backend:5055')
    const upstream = new Response('{"detail":"too large"}', { status: 413, headers: { 'content-type': 'application/json', 'x-private': 'hidden' } })
    const fetchMock = vi.fn().mockResolvedValue(upstream)
    stubLegacyFetch(fetchMock)
    const req = request({ authorization: 'Bearer test', 'content-type': 'multipart/form-data; boundary=abc', 'content-length': '15', origin: 'https://cross-site.example', cookie: 'private=yes', host: 'evil.example', connection: 'close' })
    const response = await POST(req)
    expect(fetchMock).toHaveBeenCalledWith('http://backend:5055/api/personal/imports/portable', expect.objectContaining({
      body: req.body, signal: req.signal, method: 'POST', duplex: 'half', cache: 'no-store', redirect: 'manual',
    }))
    const options = fetchMock.mock.calls[0][1]
    expect(Object.fromEntries(options.headers)).toEqual({ 'accept-encoding': 'identity', authorization: 'Bearer test', 'content-type': 'multipart/form-data; boundary=abc', 'content-length': '15', origin: 'https://cross-site.example' })
    expect(req.bodyUsed).toBe(false)
    expect(response.status).toBe(413)
    expect(response.body).toBe(upstream.body)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-private')).toBeNull()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.json()).toEqual({ detail: 'too large' })
  })
  it('does not invent authentication or forward malformed content length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    stubLegacyFetch(fetchMock)
    await POST(request({ 'content-length': '-2' }))
    expect(fetchMock.mock.calls[0][1].headers.has('authorization')).toBe(false)
    expect(fetchMock.mock.calls[0][1].headers.has('content-length')).toBe(false)
  })
  it('returns a generic gateway error without leaking upstream details', async () => {
    stubLegacyFetch(vi.fn().mockRejectedValue(new Error('secret internal address')))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('secret')
  })
  it('propagates client cancellation to the upstream request', async () => {
    const controller = new AbortController()
    let entered!: () => void
    const dispatched = new Promise<void>(resolve => { entered = resolve })
    stubLegacyFetch(vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      entered()
      options.signal.addEventListener('abort', () => reject(options.signal.reason))
    })))
    const response = POST(request({}, controller.signal))
    await dispatched
    controller.abort()
    expect((await response).status).toBe(499)
  })
})

it('rejects device-mode foreign upload before consuming any chunk or dispatching', async () => {
  vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'device_sessions')
  vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', 'https://workbench.example')
  vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', 'https://workbench.example')
  let chunks = 0
  const body = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array([1])) } }, { highWaterMark: 0 })
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
  const req = new Request('https://workbench.example/api/personal/imports/portable', { method: 'POST', headers: { origin: 'https://evil.example', 'x-studyworkbench-csrf': '1' }, body, duplex: 'half' } as RequestInit)
  expect((await POST(req)).status).toBe(403)
  expect(chunks).toBe(0)
  expect(fetchMock).not.toHaveBeenCalled()
})
