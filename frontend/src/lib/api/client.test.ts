import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MutationObserver } from '@tanstack/react-query'
import apiClient from './client'
import { queryClient } from './query-client'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { getConfig } from '@/lib/config'
import { RequestNotDispatchedError } from './browser-transport'
import { invalidateTurnContext, publishTurnTarget, readTurnContext, suspendTurnTarget } from '@/lib/workbench/turn-context'

const config = vi.hoisted(() => ({ authMode: 'device_sessions', apiUrl: '', webSessionProtocol: 'bff-memory-v1' as string | null }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => config), getApiUrl: async () => config.apiUrl }))
const originalAdapter = apiClient.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
const adapter = vi.fn(async (request: InternalAxiosRequestConfig) => {
  requests.push(request)
  return { data: {}, status: 200, statusText: 'OK', headers: {}, config: request }
})
function rejected(status: number, data: unknown) {
  return async (request: InternalAxiosRequestConfig) => {
    const response = { data, status, statusText: 'Failure', headers: {}, config: request } as AxiosResponse
    throw new AxiosError('Original resource error', 'ERR_BAD_REQUEST', request, undefined, response)
  }
}
beforeEach(() => {
  requests.length = 0; adapter.mockClear(); apiClient.defaults.adapter = adapter
  vi.mocked(getConfig).mockReset().mockImplementation(async () => config as never)
  config.authMode = 'device_sessions'; config.apiUrl = ''; config.webSessionProtocol = 'bff-memory-v1'
  sessionCoordinator.setPhase('authenticated')
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'obsolete-password' } }))
})
afterEach(() => { vi.unstubAllGlobals(); apiClient.defaults.adapter = originalAdapter; localStorage.clear(); queryClient.clear() })

describe('same client, cookie-only device transport', () => {
  it.each(['get', 'post', 'put', 'patch', 'delete', 'head'] as const)('never sends password Bearer for %s; unsafe requests have exact CSRF', async method => {
    await apiClient.request({ method, url: '/notebooks', headers: { Authorization: 'Bearer supplied-password' } })
    expect(requests[0].baseURL).toBe('/api')
    expect(requests[0].headers.get('Authorization')).toBeUndefined()
    expect(requests[0].headers.get('X-StudyWorkbench-CSRF')).toBe(['get', 'head'].includes(method) ? undefined : '1')
    expect(localStorage.getItem('auth-storage')).toBeNull()
  })
  it('preserves original FormData, timeout, response mode and signal', async () => {
    const body = new FormData(); const file = new File(['draft'], 'draft.txt'); body.append('file', file)
    const signal = new AbortController().signal
    await apiClient.post('/personal/imports/portable', body, { signal, timeout: 42, responseType: 'blob' })
    expect(requests[0]).toMatchObject({ data: body, signal, timeout: 42, responseType: 'blob' })
    expect((requests[0].data as FormData).get('file')).toBe(file)
    expect(requests[0].headers.get('Content-Type')).not.toContain('application/json')
    expect(requests[0].headers.get('X-StudyWorkbench-CSRF')).toBe('1')
  })
  it.each(['https://outside.example/api/notebooks', '//outside.example/x', '/\\outside.example/x', '/notebooks/../auth/status', '/notebooks/%2e%2e/auth/status'])('rejects destination escape %s before dispatch', async url => {
    await expect(apiClient.get(url)).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })
  it('rejects custom baseURL and axios basic-auth credential destinations', async () => {
    await expect(apiClient.get('/notebooks', { baseURL: 'https://outside.example' })).rejects.toThrow()
    await expect(apiClient.get('/notebooks', { auth: { username: 'x', password: 'y' } })).rejects.toThrow()
    expect(adapter).not.toHaveBeenCalled()
  })
  it.each([
    [401, { error: { code: 'NEEDS_REAUTH' } }],
    [401, { error: { code: 'AUTH_REQUIRED' } }],
    [401, '<html>Private ingress login</html>'],
    [409, { error: { code: 'NOTE_CONFLICT' } }],
    [503, { detail: 'Resource unavailable' }],
  ])('preserves original %s resource failure without navigation or retries', async (status, body) => {
    const location = window.location.href
    const failing = vi.fn(rejected(status as number, body))
    await expect(apiClient.patch('/notes/n', { expected_revision: 7 }, { adapter: failing })).rejects.toThrow('Original resource error')
    expect(window.location.href).toBe(location)
    expect(failing).toHaveBeenCalledTimes(1)
  })
  it('generic mutations with no hook override make only one request', async () => {
    let calls = 0
    const observer = new MutationObserver(queryClient, { mutationFn: async () => { calls++; throw new Error('unknown save outcome') } })
    await expect(observer.mutate()).rejects.toThrow('unknown save outcome')
    expect(calls).toBe(1)
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false)
  })
})

it('uses the installed fetch adapter to reject browser redirects before forwarding a private body', async () => {
  expect(originalAdapter).toBe('fetch')
  const requestFetch = vi.fn(async (request: Request) => {
    expect(request.redirect).toBe('error')
    expect(request.credentials).toBe('same-origin')
    expect(request.headers.has('Authorization')).toBe(false)
    expect(request.headers.get('X-StudyWorkbench-CSRF')).toBe('1')
    expect(await request.text()).toBe(JSON.stringify({ privateDraft: 'fixture' }))
    throw new TypeError('redirect rejected')
  })
  class BrowserRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) { super(typeof input === 'string' ? new URL(input, window.location.href) : input, init) }
  }
  await expect(apiClient.post('/notes', { privateDraft: 'fixture' }, {
    adapter: 'fetch', env: { fetch: requestFetch as typeof fetch, Request: BrowserRequest }, fetchOptions: { redirect: 'follow' },
  })).rejects.toThrow('redirect rejected')
  expect(requestFetch).toHaveBeenCalledTimes(1)
})

class BrowserRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) { super(typeof input === 'string' ? new URL(input, window.location.href) : input, init) }
}
it('real fetch adapter preserves multipart bytes and a browser-generated boundary', async () => {
  const body = new FormData(); body.append('idempotency_key', 'keep-operation-7'); body.append('title', 'Draft title')
  let wire = ''
  const requestFetch = vi.fn(async (request: Request) => {
    const contentType = request.headers.get('Content-Type')
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    wire = await request.text()
    expect(wire).toContain('name="idempotency_key"'); expect(wire).toContain('keep-operation-7')
    expect(wire).toContain(contentType!.split('boundary=')[1])
    expect(request.credentials).toBe('same-origin'); expect(request.redirect).toBe('error')
    return new Response(JSON.stringify({ accepted: true }), { headers: { 'content-type': 'application/json' } })
  })
  const response = await apiClient.post('/personal/imports/portable', body, { adapter: 'fetch', env: { fetch: requestFetch as typeof fetch, Request: BrowserRequest }, withCredentials: true, fetchOptions: { credentials: 'include', redirect: 'follow' }, maxRedirects: 0 })
  expect(response.data).toEqual({ accepted: true }); expect(wire).toContain('Draft title')
})
it('real fetch adapter returns the original JSON error Blob without auto replay', async () => {
  const requestFetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'ACCESS_EXPIRED' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
  const error = await apiClient.get('/personal/source-versions/sv1/download', { adapter: 'fetch', responseType: 'blob', env: { fetch: requestFetch as typeof fetch, Request: BrowserRequest } }).catch(error => error)
  expect(error.response.status).toBe(401)
  expect(error.response.data).toBeInstanceOf(Blob)
  const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(error.response.data) })
  expect(content).toContain('ACCESS_EXPIRED')
  expect(requestFetch).toHaveBeenCalledTimes(1)
})
it.each(['timeout', 'abort'])('real fetch adapter retains %s cancellation', async reason => {
  const controller = new AbortController()
  const requestFetch = vi.fn((request: Request) => new Promise<Response>((_, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
    if (reason === 'abort') controller.abort()
  }))
  const promise = apiClient.post('/notes', { content: 'fixture' }, { adapter: 'fetch', timeout: reason === 'timeout' ? 5 : 0, signal: controller.signal, env: { fetch: requestFetch as typeof fetch, Request: BrowserRequest } })
  await expect(promise).rejects.toThrow(reason === 'timeout' ? /timeout/i : /cancel|abort/i)
  expect(requestFetch).toHaveBeenCalledTimes(1)
})

describe('constrained turns use the installed fetch adapter, with a final native-fetch gate', () => {
  const target = { mode: 'device_sessions' as const, apiBase: `${window.location.origin}/api`, protocol: 'bff-memory-v1' }
  const other = { mode: 'legacy_password' as const, apiBase: 'https://other.example/api', protocol: null }
  const body = { message: 'private synthetic fixture', idempotency_key: 'same-key' }
  const native = vi.fn<typeof fetch>()
  beforeEach(() => {
    invalidateTurnContext(); publishTurnTarget(target, true)
    native.mockReset().mockImplementation(async () => Response.json({ job_id: 'j', turn_id: 't', state: 'queued' }))
    // Only test-environment globals emulate browser-relative Request URLs.
    // The guarded factory initializes after this shim, without per-call env hooks.
    vi.stubGlobal('Request', BrowserRequest); vi.stubGlobal('fetch', native)
  })
  const options = () => ({ adapter: 'fetch' as const, turnContext: readTurnContext()! })
  it('emits the exact JSON once, preserving device credentials/CSRF/redirect/signal and stripping forged internal options', async () => {
    const controller = new AbortController()
    await apiClient.post('/personal/chats/c/turns', body, { ...options(), timeout: 0, signal: controller.signal, withCredentials: true, fetchOptions: { credentials: 'include', redirect: 'follow', __studyWorkbenchTurnDispatch: { epoch: -1, target: other, expectedAbsoluteUrl: 'https://escape.example/api' } } })
    expect(native).toHaveBeenCalledTimes(1)
    const [request, init] = native.mock.calls[0] as [Request, RequestInit]
    expect(request.url).toBe(`${target.apiBase}/personal/chats/c/turns`)
    expect(request.credentials).toBe('same-origin'); expect(request.redirect).toBe('error')
    expect(request.signal.aborted).toBe(false); expect(request.headers.get('X-StudyWorkbench-CSRF')).toBe('1'); expect(request.headers.has('Authorization')).toBe(false)
    expect(await request.text()).toBe(JSON.stringify(body))
    expect(JSON.stringify(init)).not.toContain('studyWorkbenchTurnDispatch'); expect(JSON.stringify(init)).not.toContain('expectedAbsoluteUrl')
    expect(JSON.stringify([...request.headers])).not.toContain('epoch')
  })
  it('preserves legacy Bearer with omit credentials and no CSRF on the same guarded adapter', async () => {
    config.authMode = 'legacy_password'; config.apiUrl = 'https://legacy.example'; config.webSessionProtocol = null
    const legacy = { mode: 'legacy_password' as const, apiBase: 'https://legacy.example/api', protocol: null }
    publishTurnTarget(legacy, true)
    await apiClient.post('/personal/chats/c/turns', body, options())
    const [request] = native.mock.calls[0] as [Request]
    expect(request.credentials).toBe('omit'); expect(request.redirect).toBe('error')
    expect(request.headers.get('Authorization')).toBe('Bearer obsolete-password'); expect(request.headers.has('X-StudyWorkbench-CSRF')).toBe(false)
  })
  it('rejects when target changes during awaited configuration', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(getConfig).mockImplementationOnce(() => new Promise(resolve => { finish = value => resolve(value as Awaited<ReturnType<typeof getConfig>>) }))
    const pending = apiClient.post('/personal/chats/c/turns', body, options()).catch(error => error)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    publishTurnTarget(other, true); finish({ authMode: 'legacy_password', apiUrl: 'https://other.example', webSessionProtocol: null })
    expect(await pending).toBeInstanceOf(RequestNotDispatchedError); expect(native).not.toHaveBeenCalled()
  })
  it('compares actual prepared policy, even if a stale config did not publish its different target', async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ authMode: 'legacy_password', apiUrl: 'https://other.example', webSessionProtocol: null } as never)
    await expect(apiClient.post('/personal/chats/c/turns', body, options())).rejects.toBeInstanceOf(RequestNotDispatchedError)
    expect(native).not.toHaveBeenCalled()
  })
  it('rechecks readiness after interceptor without inventing an identity change', async () => {
    const saved = options()
    const pending = apiClient.post('/personal/chats/c/turns', { toJSON() { suspendTurnTarget(); return body } }, saved)
    await expect(pending).rejects.toMatchObject({ reason: 'configuration' })
    expect(readTurnContext()!.epoch).toBe(saved.turnContext.epoch); expect(native).not.toHaveBeenCalled()
  })
  it('uses the same transport-owned env.fetch factory across independent context epochs', async () => {
    const first = await apiClient.post('/personal/chats/c/turns', body, options())
    invalidateTurnContext()
    const second = await apiClient.post('/personal/chats/c/turns', { ...body, idempotency_key: 'different-key' }, options())
    expect(first.config.env?.fetch).toBeTypeOf('function'); expect(second.config.env?.fetch).toBe(first.config.env?.fetch); expect(native).toHaveBeenCalledTimes(2)
  })
  it('rejects target change after interceptor, before native fetch', async () => {
    const saved = options()
    await expect(apiClient.post('/personal/chats/c/turns', { toJSON() { publishTurnTarget(other, true); return body } }, saved)).rejects.toMatchObject({ reason: 'superseded' })
    expect(native).not.toHaveBeenCalled()
  })
  it('rejects invalidation while the real adapter awaits body-length preparation, and does not report an auth outage', async () => {
    const report = vi.spyOn(sessionCoordinator, 'report')
    try {
      const error = await apiClient.post('/personal/chats/c/turns', { toJSON() { queueMicrotask(invalidateTurnContext); return body } }, { ...options(), maxBodyLength: 4096 }).catch(error => error)
      expect(error).toBeInstanceOf(RequestNotDispatchedError); expect(error.reason).toBe('superseded')
      expect(native).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled()
    } finally { report.mockRestore() }
  })
  it('rejects the old epoch even when A to B to A restores the same URL', async () => {
    const saved = options(); publishTurnTarget(other, true); publishTurnTarget(target, true)
    await expect(apiClient.post('/personal/chats/c/turns', body, saved)).rejects.toBeInstanceOf(RequestNotDispatchedError)
    expect(native).not.toHaveBeenCalled()
  })
  it('rejects a per-call Request whose public URL masks a different internal destination before construction', async () => {
    const constructors = vi.fn()
    class RedirectedRequest extends BrowserRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) { constructors(); super(String(input).includes('/personal/') ? 'https://escape.example/api/personal/chats/c/turns' : input, init) }
      get url() { return super.url.includes('/personal/') ? `${target.apiBase}/personal/chats/c/turns` : super.url }
    }
    await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), env: { Request: RedirectedRequest } })).rejects.toMatchObject({ reason: 'destination' })
    expect(constructors).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
  })
  it('rechecks the current resource-auth phase immediately before native fetch', async () => {
    const data = { toJSON() { queueMicrotask(() => sessionCoordinator.setPhase('refresh-needed')); return body } }
    await expect(apiClient.post('/personal/chats/c/turns', data, { ...options(), maxBodyLength: 4096 })).rejects.toMatchObject({ reason: 'authentication' })
    expect(native).not.toHaveBeenCalled()
  })
  it.each(['adapter', 'fetch', 'baseURL', 'auth'] as const)('rejects constrained %s escape rather than substituting the transport', async kind => {
    const substitute = vi.fn()
    const escape = kind === 'adapter' ? { adapter: substitute } : kind === 'fetch' ? { env: { Request: BrowserRequest, fetch: substitute } } : kind === 'baseURL' ? { baseURL: 'https://escape.example' } : { auth: { username: 'x', password: 'y' } }
    await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), ...escape })).rejects.toBeInstanceOf(RequestNotDispatchedError)
    expect(native).not.toHaveBeenCalled(); expect(substitute).not.toHaveBeenCalled()
  })
  it.each(['timeout', 'abort'])('preserves constrained %s cancellation without replay', async reason => {
    const controller = new AbortController()
    native.mockImplementationOnce(input => new Promise((_, reject) => {
      const request = input as Request
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
      if (reason === 'abort') controller.abort()
    }))
    await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), signal: controller.signal, timeout: reason === 'timeout' ? 5 : 0 })).rejects.toThrow(reason === 'timeout' ? /timeout/i : /cancel|abort/i)
    expect(native).toHaveBeenCalledTimes(1)
  })
  it('does not believe a remote error claiming to be locally not dispatched', async () => {
    native.mockResolvedValueOnce(Response.json({ name: 'RequestNotDispatchedError', reason: 'superseded', not_dispatched: true, cause: { reason: 'superseded' } }, { status: 409 }))
    const error = await apiClient.post('/personal/chats/c/turns', body, options()).catch(error => error)
    expect(error).toBeInstanceOf(AxiosError); expect(error).not.toBeInstanceOf(RequestNotDispatchedError); expect(error.response.status).toBe(409)
    expect(native).toHaveBeenCalledTimes(1)
  })
  it.each(['transformRequest', 'transformResponse', 'withXSRFToken', 'validateStatus'] as const)('rejects a constrained %s callback before it runs or dispatches', async option => {
    const substitute = vi.fn<typeof fetch>(async () => Response.json({}))
    const callback = vi.fn(function(this: InternalAxiosRequestConfig, value: unknown) {
      if (option === 'transformRequest') {
        invalidateTurnContext(); this.env = { ...this.env, fetch: substitute }
        return JSON.stringify(value)
      }
      if (option === 'withXSRFToken') {
        invalidateTurnContext()
        const resolved = value as InternalAxiosRequestConfig
        const internal = resolved.fetchOptions as { __studyWorkbenchTurnDispatch: { epoch: number } }
        internal.__studyWorkbenchTurnDispatch.epoch = readTurnContext()!.epoch
        return true
      }
      throw new RequestNotDispatchedError('superseded')
    })
    const error = await apiClient.post('/personal/chats/c/turns', body, { ...options(), [option]: callback }).catch(error => error)
    expect(error).toBeInstanceOf(RequestNotDispatchedError)
    expect({ callbackCalls: callback.mock.calls.length, nativeCalls: native.mock.calls.length, substituteCalls: substitute.mock.calls.length }).toEqual({ callbackCalls: 0, nativeCalls: 0, substituteCalls: 0 })
  })
  it('rejects request-transform metadata rewriting instead of trusting the replacement epoch', async () => {
    const rewrite = vi.fn(function(this: InternalAxiosRequestConfig, value: unknown) {
      invalidateTurnContext()
      const internal = this.fetchOptions as { __studyWorkbenchTurnDispatch: { epoch: number } }
      internal.__studyWorkbenchTurnDispatch.epoch = readTurnContext()!.epoch
      return JSON.stringify(value)
    })
    await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), transformRequest: [rewrite] })).rejects.toBeInstanceOf(RequestNotDispatchedError)
    expect(rewrite).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
  })
  it.each(['transformRequest', 'transformResponse'] as const)('rejects a replaced instance-default %s list, but accepts the captured installed list', async option => {
    const original = apiClient.defaults[option]
    const installed = Array.isArray(original) ? [...original] : original
    const substitute = vi.fn(() => { throw new RequestNotDispatchedError('superseded') })
    try {
      apiClient.defaults[option] = [substitute]
      await expect(apiClient.post('/personal/chats/c/turns', body, options())).rejects.toBeInstanceOf(RequestNotDispatchedError)
      expect(substitute).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
      await apiClient.post('/personal/chats/c/turns', body, { ...options(), [option]: installed })
      expect(native).toHaveBeenCalledTimes(1)
    } finally { apiClient.defaults[option] = original }
  })
  it.each(['transformRequest', 'transformResponse'] as const)('rejects in-place mutation of the default %s list', async option => {
    const original = apiClient.defaults[option]
    expect(Array.isArray(original)).toBe(true)
    if (!Array.isArray(original)) return
    const saved = [...original]
    const substitute = vi.fn(() => { throw new RequestNotDispatchedError('superseded') })
    try {
      original.splice(0, original.length, substitute)
      await expect(apiClient.post('/personal/chats/c/turns', body, options())).rejects.toBeInstanceOf(RequestNotDispatchedError)
      expect(substitute).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
    } finally { original.splice(0, original.length, ...saved) }
  })
  it('rejects a replaced default validator and keeps the installed status behavior', async () => {
    const original = apiClient.defaults.validateStatus
    const substitute = vi.fn(() => { throw new RequestNotDispatchedError('superseded') })
    try {
      apiClient.defaults.validateStatus = substitute
      await expect(apiClient.post('/personal/chats/c/turns', body, options())).rejects.toBeInstanceOf(RequestNotDispatchedError)
      expect(substitute).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled()
      native.mockResolvedValueOnce(Response.json({ conflict: true }, { status: 409 }))
      await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), validateStatus: original })).rejects.toBeInstanceOf(AxiosError)
      expect(native).toHaveBeenCalledTimes(1)
    } finally { apiClient.defaults.validateStatus = original }
  })
  it('keeps ordinary custom transform and validator behavior unchanged', async () => {
    const requestTransform = vi.fn((value: unknown) => JSON.stringify({ fixture: value }))
    const responseTransform = vi.fn((value: string) => ({ ordinary: JSON.parse(value) }))
    const validateStatus = vi.fn(() => true)
    const withXSRFToken = vi.fn(() => true)
    native.mockResolvedValueOnce(Response.json({ conflict: true }, { status: 409 }))
    const response = await apiClient.post('/personal/chats/c/turns', body, { adapter: 'fetch', env: { Request: BrowserRequest }, transformRequest: [requestTransform], transformResponse: [responseTransform], validateStatus, withXSRFToken })
    expect(requestTransform).toHaveBeenCalledTimes(1); expect(responseTransform).toHaveBeenCalledTimes(1); expect(validateStatus).toHaveBeenCalledWith(409)
    expect(response.data).toEqual({ ordinary: { conflict: true } }); expect(native).toHaveBeenCalledTimes(1)
    expect(await (native.mock.calls[0][0] as Request).text()).toBe(JSON.stringify({ fixture: body }))
  })
  it('rejects strict-JSON parseReviver before native dispatch or reviver execution', async () => {
    const reviver = vi.fn(() => { throw new RequestNotDispatchedError('superseded') })
    const error = await apiClient.post('/personal/chats/c/turns', body, { ...options(), responseType: 'json', transitional: { silentJSONParsing: false }, parseReviver: reviver }).catch(error => error)
    expect(error).toBeInstanceOf(RequestNotDispatchedError)
    expect({ nativeCalls: native.mock.calls.length, reviverCalls: reviver.mock.calls.length }).toEqual({ nativeCalls: 0, reviverCalls: 0 })
  })
  it('rejects an inherited instance-default parseReviver before dispatch', async () => {
    const original = apiClient.defaults.parseReviver
    const reviver = vi.fn(() => { throw new RequestNotDispatchedError('superseded') })
    try {
      apiClient.defaults.parseReviver = reviver
      const error = await apiClient.post('/personal/chats/c/turns', body, { ...options(), responseType: 'json', transitional: { silentJSONParsing: false } }).catch(error => error)
      expect(error).toBeInstanceOf(RequestNotDispatchedError)
      expect({ nativeCalls: native.mock.calls.length, reviverCalls: reviver.mock.calls.length }).toEqual({ nativeCalls: 0, reviverCalls: 0 })
    } finally { apiClient.defaults.parseReviver = original }
  })
  it('rejects env.Response before the adapter can manufacture unsent evidence from its post-fetch stream wrapper', async () => {
    const constructedAfterFetch = vi.fn()
    class ForgedResponse extends Response {
      constructor(value?: BodyInit | null, init?: ResponseInit) {
        super(value, init)
        if (native.mock.calls.length) { constructedAfterFetch(); throw new RequestNotDispatchedError('superseded') }
      }
    }
    const error = await apiClient.post('/personal/chats/c/turns', body, { ...options(), maxContentLength: 4096, env: { ...apiClient.defaults.env, Response: ForgedResponse } }).catch(error => error)
    expect(error).toBeInstanceOf(RequestNotDispatchedError)
    expect({ nativeCalls: native.mock.calls.length, postFetchConstructors: constructedAfterFetch.mock.calls.length }).toEqual({ nativeCalls: 0, postFetchConstructors: 0 })
  })
  it.each(['replace', 'mutate'] as const)('does not trust %s changes to instance-default environment hooks', async change => {
    const original = apiClient.defaults.env
    const constructors = vi.fn()
    class ReplacedRequest extends BrowserRequest {
      constructor(value: RequestInfo | URL, init?: RequestInit) { constructors(); super(value, init) }
    }
    const previousRequest = original?.Request
    try {
      if (change === 'replace') apiClient.defaults.env = { ...original, Request: ReplacedRequest }
      else if (original) original.Request = ReplacedRequest
      await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), env: undefined })).rejects.toBeInstanceOf(RequestNotDispatchedError)
      expect({ nativeCalls: native.mock.calls.length, constructors: constructors.mock.calls.length }).toEqual({ nativeCalls: 0, constructors: 0 })
    } finally {
      apiClient.defaults.env = original
      if (original) { if (previousRequest) original.Request = previousRequest; else delete original.Request }
    }
  })
  it('rejects unknown environment keys rather than forwarding an open platform-hook object', async () => {
    const env = { ...apiClient.defaults.env, unexpectedHook: true }
    await expect(apiClient.post('/personal/chats/c/turns', body, { ...options(), env })).rejects.toBeInstanceOf(RequestNotDispatchedError)
    expect(native).not.toHaveBeenCalled()
  })
  it('preserves ordinary parseReviver behavior', async () => {
    const reviver = vi.fn((_key: string, value: unknown) => value)
    const response = await apiClient.post('/personal/chats/c/turns', body, { adapter: 'fetch', env: { Request: BrowserRequest }, responseType: 'json', transitional: { silentJSONParsing: false }, parseReviver: reviver })
    expect(response.data).toMatchObject({ job_id: 'j' }); expect(native).toHaveBeenCalledTimes(1); expect(reviver).toHaveBeenCalled()
  })

  it('accepts copies of installed environment references and preserves every default platform reference', async () => {
    const env = { ...apiClient.defaults.env }
    const response = await apiClient.post('/personal/chats/c/turns', body, { ...options(), env })
    for (const key of Reflect.ownKeys(env)) {
      expect((response.config.env as Record<PropertyKey, unknown>)[key]).toBe((env as Record<PropertyKey, unknown>)[key])
    }
    expect(native).toHaveBeenCalledTimes(1)
  })

})
