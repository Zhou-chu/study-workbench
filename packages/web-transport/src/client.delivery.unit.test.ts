import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '@study/contracts'
import { createWebTransport, asRequestNotDispatchedError } from './client.js'
import { readTurnContext } from './dispatch-context.js'

const context = vi.hoisted(() => Object.freeze({
  epoch: 1,
  ready: true,
  target: Object.freeze({ mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }),
}))
vi.mock('./dispatch-context.js', () => ({ readTurnContext: () => context, publishTurnTarget: vi.fn() }))
vi.mock('./session-coordinator.js', () => ({
  sessionCoordinator: { current: () => 1, resourcePhase: () => 'authenticated', report: vi.fn() },
}))
vi.mock('./legacy-auth.js', () => ({ getAuthToken: () => null, purgeLegacyAuth: vi.fn() }))

const config: RuntimeConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }
const json = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal('window', { location: new URL('https://fixture.example/notebooks') })
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
  fetcher.mockResolvedValue(json())
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const request = (method = 'POST', path = '/personal/chats/c/turns') => ({ method, path, context: readTurnContext()!, body: method === 'POST' ? '{}' : undefined })
describe('single guarded browser dispatch', () => {
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
