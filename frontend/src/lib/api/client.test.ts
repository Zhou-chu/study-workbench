import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MutationObserver } from '@tanstack/react-query'
import apiClient from './client'
import { queryClient } from './query-client'

const config = vi.hoisted(() => ({ authMode: 'device_sessions', apiUrl: '', webSessionProtocol: 'bff-memory-v1' }))
vi.mock('@/lib/config', () => ({ getConfig: async () => config, getApiUrl: async () => config.apiUrl }))
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
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'obsolete-password' } }))
})
afterEach(() => { apiClient.defaults.adapter = originalAdapter; localStorage.clear(); queryClient.clear() })

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
