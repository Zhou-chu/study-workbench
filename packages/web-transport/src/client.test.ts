import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '@study/contracts'
import { createWebTransport, asRequestNotDispatchedError, TransportResponseError } from './client.js'
import { readTurnContext, publishTurnTarget, invalidateTurnContext, suspendTurnTarget } from './dispatch-context.js'
import { sessionCoordinator } from './session-coordinator.js'
import { endpointPolicy } from './endpoint-policy.js'
const config: RuntimeConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }
const json = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let storage: Map<string,string>
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  storage = new Map(); vi.stubGlobal('window', { location: new URL('https://fixture.example/notebooks'), localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string,v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); fetcher.mockResolvedValue(json()); invalidateTurnContext(); sessionCoordinator.begin(); sessionCoordinator.setPhase('authenticated'); publishTurnTarget({ mode:'legacy_password',apiBase:'https://fixture.example/api',protocol:null },true)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const request = (method = 'POST', path = '/personal/chats/c/turns') => ({ method, path, context: readTurnContext()!, body: method === 'POST' ? '{}' : undefined })
describe('single guarded browser dispatch', () => {
  it('retains same-origin ingress cookie and legacy bearer without leaking a token API', async () => {
    storage.set('auth-storage', JSON.stringify({ state: { token: 'synthetic-password' } }))
    const transport = createWebTransport(config); await transport.send(request())
    const sent = fetcher.mock.calls[0]![0] as Request
    expect(sent.url).toBe('https://fixture.example/api/personal/chats/c/turns'); expect(sent.credentials).toBe('same-origin'); expect(sent.redirect).toBe('error')
    expect(sent.headers.get('authorization')).toBe('Bearer synthetic-password'); expect(await sent.text()).toBe('{}')
    expect(Object.keys(transport)).toEqual(['send'])
  })
  it.each(['https://elsewhere.example/api/notebooks','//elsewhere.example/api/notebooks','/../secret','/api/%252e%252e/secret','/api/a\\b','/api/a#fragment'])('blocks destination %s before fetch', async path => {
    const transport = createWebTransport(config)
    expect(asRequestNotDispatchedError(await transport.send(request('GET', path)).catch(e => e))?.reason).toBe('destination'); expect(fetcher).not.toHaveBeenCalled()
  })
  it('forbids a cross-origin captured target rather than omitting cookies', async () => {
    const transport = createWebTransport(config); publishTurnTarget({ ...readTurnContext()!.target, apiBase: 'https://elsewhere.example/api' }, true)
    await expect(transport.send(request('GET', '/notebooks'))).rejects.toThrow('not sent'); expect(fetcher).not.toHaveBeenCalled()
  })
  it('fences A to B to A and does not bind queued old selection to the new context', async () => {
    const transport = createWebTransport(config); const old = request(); const a = old.context.target
    publishTurnTarget({ ...a, protocol: 'other' }, true); publishTurnTarget(a, true)
    expect(asRequestNotDispatchedError(await transport.send(old).catch(e => e))?.reason).toBe('superseded'); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['context','session'])('rechecks %s after body preparation immediately before native fetch', async kind => {
    const transport = createWebTransport(config); const old = request()
    old.body = { toString() { if (kind === 'context') invalidateTurnContext(); else sessionCoordinator.confirmed(); return '{}' } } as unknown as string
    expect(asRequestNotDispatchedError(await transport.send(old).catch(e => e))?.reason).toBe('superseded'); expect(fetcher).not.toHaveBeenCalled()
  })
  it('captures session generation before a caller body getter runs', async () => {
    const transport = createWebTransport(config); const old = request()
    Object.defineProperty(old,'body',{ get() { sessionCoordinator.confirmed(); return '{}' } })
    expect(asRequestNotDispatchedError(await transport.send(old).catch(e => e))?.reason).toBe('superseded'); expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not restore suspended readiness by constructing another transport', async () => {
    createWebTransport(config); suspendTurnTarget(); const transport = createWebTransport(config)
    await expect(transport.send(request())).rejects.toThrow('not sent'); expect(fetcher).not.toHaveBeenCalled(); expect(readTurnContext()?.ready).toBe(false)
  })
  it('does not return a shared job observer to an already-aborted subscriber', async () => {
    let finish!: (r: Response) => void; fetcher.mockImplementationOnce(() => new Promise(r => { finish = r }))
    const transport = createWebTransport(config); const spec = request('GET','/personal/jobs/j'); const first = transport.send(spec)
    const controller = new AbortController(); controller.abort()
    const second = transport.send({ ...spec,signal:controller.signal }).catch(e => e)
    finish(json()); expect(asRequestNotDispatchedError(await second)?.reason).toBe('aborted'); await first; expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('uses a synchronous duplicate latch and keeps unknown transport outcome unbranded', async () => {
    let reject!: (e: Error) => void; fetcher.mockImplementationOnce(() => new Promise((_resolve,r) => { reject = r }))
    const transport = createWebTransport(config); const spec = { ...request(), operationKey: 'same-key' }
    const first = transport.send(spec).catch(e => e)
    const second = await transport.send(spec).catch(e => e)
    expect(asRequestNotDispatchedError(second)?.reason).toBe('duplicate'); expect(fetcher).toHaveBeenCalledTimes(1)
    reject(new TypeError('network')); const failure = await first
    expect(asRequestNotDispatchedError(failure)).toBeNull(); expect(failure).toMatchObject({ kind: 'unavailable' }); expect(failure).not.toHaveProperty('status')
    expect(spec.operationKey).toBe('same-key'); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not interpret an opaque redirect-error rejection as logout or not-sent', async () => {
    storage.set('auth-storage', JSON.stringify({ state: { token: 'synthetic-password' } })); fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const report = vi.fn(); const unsub = sessionCoordinator.subscribe(report); const transport = createWebTransport(config)
    const error = await transport.send(request()).catch(e => e)
    expect(error).toBeInstanceOf(TransportResponseError); expect(error.kind).toBe('unavailable'); expect(error.status).toBeUndefined(); expect(error.location).toBeUndefined()
    expect(storage.has('auth-storage')).toBe(true); expect(sessionCoordinator.resourcePhase()).toBe('authenticated'); expect(report).toHaveBeenCalledWith('unavailable'); unsub()
  })
  it.each([200,401,503])('classifies visible HTML status %s without clearing auth or returning it as JSON', async status => {
    fetcher.mockResolvedValueOnce(new Response('<html>Sign in</html>', { status, headers: { 'content-type': 'text/html' } }))
    const transport = createWebTransport(config); const error = await transport.send(request()).catch(e => e)
    expect(error).toMatchObject({ kind: 'ingress-unavailable', status }); expect(error.message).not.toContain('Sign in'); expect(asRequestNotDispatchedError(error)).toBeNull()
  })
  it('reports explicit app auth failures but never treats provider NEEDS_REAUTH as app logout', async () => {
    const report = vi.fn(); const unsub = sessionCoordinator.subscribe(report); const transport = createWebTransport(config)
    fetcher.mockResolvedValueOnce(json({ error: { code: 'NEEDS_REAUTH' } }, 401)); expect((await transport.send(request())).status).toBe(401); expect(report).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(json({ error: { code: 'ACCESS_EXPIRED' } }, 401)); await transport.send(request()); expect(report).toHaveBeenCalledWith('refresh-needed'); unsub()
  })
  it('retires late success independently of target equality and suppresses late auth reports', async () => {
    let finish!: (r: Response) => void; fetcher.mockImplementationOnce(() => new Promise(r => { finish = r }))
    const transport = createWebTransport(config); const report = vi.fn(); const unsub = sessionCoordinator.subscribe(report)
    const pending = transport.send(request()).catch(e => e); sessionCoordinator.confirmed(); finish(json({ error: { code: 'ACCESS_EXPIRED' } },401))
    const result = await pending; expect(result).toMatchObject({ kind: 'retired' }); expect(asRequestNotDispatchedError(result)).toBeNull(); expect(report).not.toHaveBeenCalled(); unsub()
  })
  it('purges legacy storage in device mode and supplies CSRF without browser device tokens', async () => {
    storage.set('auth-storage', '{bad}'); const transport = createWebTransport({ ...config, auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' }); await transport.send(request())
    const sent = fetcher.mock.calls[0]![0] as Request; expect(storage.size).toBe(0); expect(sent.headers.has('authorization')).toBe(false); expect(sent.headers.get('X-StudyWorkbench-CSRF')).toBe('1')
  })
  it('honors same-tab or cross-tab legacy credential removal before every dispatch', async () => {
    storage.set('auth-storage', JSON.stringify({ state: { token: 'synthetic-password' } })); const transport = createWebTransport(config); await transport.send(request())
    storage.delete('auth-storage'); await transport.send(request()); expect((fetcher.mock.calls[1]![0] as Request).headers.has('authorization')).toBe(false)
  })
  it('deduplicates the dispatch-capable job observer in-flight without caching or retry', async () => {
    let finish!: (r: Response) => void; fetcher.mockImplementationOnce(() => new Promise(r => { finish = r }))
    const transport = createWebTransport(config); const spec = request('GET','/personal/jobs/job:one'); const a = transport.send(spec); const b = transport.send(spec)
    expect(fetcher).toHaveBeenCalledTimes(1); finish(json({ state: 'queued' })); const [ra,rb] = await Promise.all([a,b]); expect(await ra.json()).toEqual({ state: 'queued' }); expect(await rb.json()).toEqual({ state: 'queued' })
    expect(endpointPolicy('GET',spec.path)).toEqual({ retry: false, prefetch: false, dedupeKey: 'GET /api/personal/jobs/job:one' }); expect(endpointPolicy('POST','/notes')).toEqual({ retry: false, prefetch: false })
  })
  it('retains streaming request bodies and FormData boundary generation', async () => {
    const transport = createWebTransport(config)
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('streamed')); c.close() } })
    await transport.send({ ...request(),body:stream }); expect(await (fetcher.mock.calls[0]![0] as Request).text()).toBe('streamed')
    const form = new FormData(); form.append('file',new Blob(['fixture'],{type:'text/plain'}),'fixture.txt')
    await transport.send({ ...request(),body:form }); const sent = fetcher.mock.calls[1]![0] as Request
    expect(sent.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/); expect(await sent.text()).toContain('fixture.txt')
  })
  it('preserves successful SSE streams and abort identity without buffering', async () => {
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: status\ndata: running\n\n')) } }), { headers: { 'content-type': 'text/event-stream' } })
    const clone = vi.spyOn(response,'clone'); fetcher.mockResolvedValueOnce(response); const transport = createWebTransport(config); const controller = new AbortController()
    expect(await transport.send({ ...request('GET','/personal/jobs/j/events'), signal: controller.signal })).toBe(response); expect(clone).not.toHaveBeenCalled(); controller.abort(); expect((fetcher.mock.calls[0]![0] as Request).signal.aborted).toBe(true)
    await response.body?.cancel()
  })
})
