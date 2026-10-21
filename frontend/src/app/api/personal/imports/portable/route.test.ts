import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
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
    vi.stubGlobal('fetch', fetchMock)
    const req = request({ authorization: 'Bearer test', 'content-type': 'multipart/form-data; boundary=abc', 'content-length': '15', origin: 'https://cross-site.example', cookie: 'private=yes', host: 'evil.example', connection: 'close' })
    const response = await POST(req)
    expect(fetchMock).toHaveBeenCalledWith('http://backend:5055/api/personal/imports/portable', expect.objectContaining({
      body: req.body, signal: req.signal, method: 'POST', duplex: 'half', cache: 'no-store', redirect: 'manual',
    }))
    const options = fetchMock.mock.calls[0][1]
    expect(Object.fromEntries(options.headers)).toEqual({ authorization: 'Bearer test', 'content-type': 'multipart/form-data; boundary=abc', 'content-length': '15', origin: 'https://cross-site.example' })
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
    vi.stubGlobal('fetch', fetchMock)
    await POST(request({ 'content-length': '-2' }))
    expect(fetchMock.mock.calls[0][1].headers.has('authorization')).toBe(false)
    expect(fetchMock.mock.calls[0][1].headers.has('content-length')).toBe(false)
  })
  it('returns a generic gateway error without leaking upstream details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret internal address')))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('secret')
  })
  it('propagates client cancellation to the upstream request', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason))
    })))
    const response = POST(request({}, controller.signal))
    controller.abort()
    expect((await response).status).toBe(499)
  })
})
