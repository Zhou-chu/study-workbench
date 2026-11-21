import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '@study/contracts'
import { createWebTransport, asRequestNotDispatchedError } from './client.js'
import { publishTurnTarget, readTurnContext } from './dispatch-context.js'
import { sessionCoordinator } from './session-coordinator.js'
import { getAuthToken, purgeLegacyAuth } from './legacy-auth.js'

const context = vi.hoisted(() => Object.freeze({
  epoch: 1,
  ready: true,
  target: Object.freeze({ mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }),
}))
vi.mock('./dispatch-context.js', () => ({ readTurnContext: vi.fn(() => context), publishTurnTarget: vi.fn() }))
vi.mock('./session-coordinator.js', () => ({
  sessionCoordinator: { current: () => 1, resourcePhase: () => 'authenticated', report: vi.fn() },
}))
vi.mock('./legacy-auth.js', () => ({ getAuthToken: vi.fn(() => null), purgeLegacyAuth: vi.fn() }))

const config: RuntimeConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }
const json = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal('window', { location: new URL('https://fixture.example/notebooks') })
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
  vi.mocked(readTurnContext).mockReset().mockReturnValue(context)
  vi.mocked(sessionCoordinator.report).mockClear()
  vi.mocked(publishTurnTarget).mockReset()
  vi.mocked(getAuthToken).mockReset().mockReturnValue(null)
  vi.mocked(purgeLegacyAuth).mockClear()
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

it('gives two live subscribers independent readable copies of one shared job reply',async()=>{
  let finish!: (value: Response) => void
  fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const transport=createWebTransport(config), spec=request('GET','/personal/jobs/lookup')
  const one=transport.send(spec), two=transport.send(spec)
  finish(json({state:'running'}))
  const [a,b]=await Promise.all([one,two])
  expect(a).not.toBe(b)
  await expect(a.json()).resolves.toEqual({state:'running'})
  await expect(b.json()).resolves.toEqual({state:'running'})
  expect(fetcher).toHaveBeenCalledOnce()
})

it('discards a completed response if the user has moved to a new context',async()=>{
  let finish!: (value: Response)=>void
  fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const pending=createWebTransport(config).send(request('GET','/notebooks')).catch(error=>error)
  vi.mocked(readTurnContext).mockReturnValue({...context,epoch:2})
  const response=json({items:[]}), close=vi.spyOn(response.body!,'cancel')
  finish(response)
  expect(await pending).toMatchObject({kind:'retired'})
  expect(close).toHaveBeenCalledOnce()
  expect(sessionCoordinator.report).not.toHaveBeenCalled()
})

it('preserves a native cancellation after dispatch and does not report an outage',async()=>{
  const cancellation=new DOMException('user stopped','AbortError')
  fetcher.mockRejectedValueOnce(cancellation)
  await expect(createWebTransport(config).send(request('GET','/notebooks'))).rejects.toBe(cancellation)
  expect(sessionCoordinator.report).not.toHaveBeenCalled()
})

it('reports a well-formed expired-session response while preserving its original body',async()=>{
  const response=json({error:{code:'ACCESS_EXPIRED'}},401)
  fetcher.mockResolvedValueOnce(response)
  const result=await createWebTransport(config).send(request('GET','/notebooks'))
  expect(result).toBe(response)
  expect(sessionCoordinator.report).toHaveBeenCalledOnce()
  await expect(result.json()).resolves.toEqual({error:{code:'ACCESS_EXPIRED'}})
})

it('uses the configured new device session for ordinary reads and mutations without reading legacy storage',async()=>{
  const device: RuntimeConfig={...config,auth_mode:'device_sessions',web_session_protocol:'bff-memory-v1'}
  vi.mocked(readTurnContext).mockReturnValue(null)
  vi.mocked(publishTurnTarget).mockImplementation(target=>{
    vi.mocked(readTurnContext).mockReturnValue({...context,target})
  })
  fetcher.mockImplementation(async()=>json())
  const transport=createWebTransport(device)
  await transport.send(request('GET','/notebooks'))
  await transport.send(request('POST','/notebooks'))
  const sent=fetcher.mock.calls.map(([arg])=>arg as Request)
  expect(publishTurnTarget).toHaveBeenCalledOnce()
  expect(sent.map(r=>[r.credentials,r.headers.get('X-StudyWorkbench-CSRF'),r.headers.get('Authorization')])).toEqual([
    ['same-origin',null,null],['same-origin','1',null],
  ])
  expect(getAuthToken).not.toHaveBeenCalled()
  expect(purgeLegacyAuth).toHaveBeenCalled()
})

it('passes through a legacy read with the locally configured fixture value',async()=>{
  vi.mocked(getAuthToken).mockReturnValueOnce('example-value')
  await createWebTransport(config).send(request('GET','/notebooks'))
  expect((fetcher.mock.calls[0]![0] as Request).headers.get('Authorization')).toBe('Bearer example-value')
})

it('classifies a normal maintenance page as unavailable and closes its body',async()=>{
  const response=new Response('Maintenance',{status:503,headers:{'content-type':'text/html'}})
  const close=vi.spyOn(response.body!,'cancel')
  fetcher.mockResolvedValueOnce(response)
  await expect(createWebTransport(config).send(request('GET','/notebooks'))).rejects.toMatchObject({kind:'ingress-unavailable',status:503})
  expect(close).toHaveBeenCalledOnce()
  expect(sessionCoordinator.report).toHaveBeenCalledExactlyOnceWith('unavailable',1)
})
