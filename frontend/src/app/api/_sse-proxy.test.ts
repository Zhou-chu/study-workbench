import { afterEach, describe, expect, it, vi } from 'vitest'
import { sseProxy } from './_sse-proxy'
import { POST as ask } from './search/ask/route'
import { POST as chat } from './sources/[sourceId]/chat/sessions/[sessionId]/messages/route'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function stubLegacyFetch(fetchMock: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url.endsWith('/api/auth/status')
    ? Promise.resolve(Response.json({ auth_enabled: true, message: 'Authentication is required' }))
    : fetchMock(url, init))
}
function request(path = '/api/search/ask', signal?: AbortSignal) {
  return new Request(`https://workbench.example${path}`, { method: 'POST', headers: { authorization: 'Bearer legacy-synthetic', 'content-type': 'application/json' }, body: '{"question":"hello"}', signal })
}
describe('SSE route equivalence', () => {
  it('streams the original request and first response chunk without buffering or retry', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    stubLegacyFetch(fetchMock)
    const req = request()
    const response = await sseProxy(req, '/api/search/ask')
    expect(req.bodyUsed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: req.body, signal: req.signal, duplex: 'half', redirect: 'manual', cache: 'no-store' })
    controller.enqueue(new TextEncoder().encode('data: first\n\n'))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n')
    controller.close()
    expect((await reader.read()).done).toBe(true)
    expect(response.headers.get('x-accel-buffering')).toBe('no')
  })
  it('both existing POST routes use the common stream transport and preserve encoded identifiers', async () => {
    const fetchMock = vi.fn(async (url: string) => { expect(url).toContain('/api/'); return new Response('data: ok\n\n', { headers: { 'content-type': 'text/event-stream' } }) })
    stubLegacyFetch(fetchMock)
    vi.stubEnv('INTERNAL_API_URL', 'http://internal:5055')
    expect((await ask(request())).status).toBe(200)
    expect((await chat(request('/api/sources/source%3Aone/chat/sessions/chat%3Atwo/messages'), { params: Promise.resolve({ sourceId: 'source:one', sessionId: 'chat:two' }) })).status).toBe(200)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['http://internal:5055/api/search/ask', 'http://internal:5055/api/sources/source%3Aone/chat/sessions/chat%3Atwo/messages'])
  })
  it('sanitizes redirect bodies and Location without following', async () => {
    stubLegacyFetch(vi.fn().mockResolvedValue(new Response('private-sentinel', { status: 307, headers: { location: 'https://evil.example' } })))
    const response = await sseProxy(request(), '/api/search/ask')
    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).not.toContain('private-sentinel')
  })
  it('propagates abort once without retrying', async () => {
    const controller = new AbortController()
    let aborts = 0
    let entered!: () => void
    const dispatched = new Promise<void>(resolve => { entered = resolve })
    const fetchMock = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      entered()
      init.signal.addEventListener('abort', () => { aborts++; reject(new Error('private-sentinel')) }, { once: true })
    }))
    stubLegacyFetch(fetchMock)
    const response = sseProxy(request('/api/search/ask', controller.signal), '/api/search/ask')
    await dispatched
    controller.abort()
    expect((await response).status).toBe(499)
    expect(aborts).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

it('retains the legacy SSE JSON content type even when the incoming type is missing', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('data: ok\n\n'))
  stubLegacyFetch(fetchMock)
  const req = request()
  req.headers.delete('content-type')
  expect((await sseProxy(req, '/api/search/ask')).status).toBe(200)
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get('content-type')).toBe('application/json')
})

it('streams large legacy question/context bodies to the API-owned limit and preserves413 without retry', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ detail: 'Request body too large' }, { status: 413 }))
  stubLegacyFetch(fetchMock)
  const req = new Request('https://workbench.example/api/search/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: 'x'.repeat(9000) }) })
  const response = await sseProxy(req, '/api/search/ask')
  expect(response.status).toBe(413)
  expect(await response.json()).toEqual({ detail: 'Request body too large' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][1].body).toBe(req.body)
  expect(req.bodyUsed).toBe(false)
})
