import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyAuthFailure, prepareBrowserRequest, protectedApiPath } from './browser-transport'
import { resolvePodcastAssetUrl } from './podcasts'
const metadata = vi.hoisted(() => ({ authMode: 'device_sessions', apiUrl: '', webSessionProtocol: 'bff-memory-v1' }))
vi.mock('@/lib/config', () => ({ getConfig: async () => metadata, getApiUrl: async () => metadata.apiUrl }))
beforeEach(() => { metadata.authMode = 'device_sessions'; metadata.apiUrl = ''; localStorage.setItem('auth-storage', '{invalid secret') })
afterEach(() => localStorage.clear())
describe('shared fetch policy', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('uses cookie custody and CSRF for %s', async method => {
    const request = await prepareBrowserRequest(method, '/api/search/ask')
    expect(request).toMatchObject({ url: '/api/search/ask', credentials: 'same-origin', redirect: 'error' })
    expect(new Headers(request.headers).get('X-StudyWorkbench-CSRF')).toBe('1')
    expect(new Headers(request.headers).get('Authorization')).toBeNull()
    expect(localStorage.getItem('auth-storage')).toBeNull()
  })
  it('does not add unsafe headers to reads', async () => {
    expect(new Headers((await prepareBrowserRequest('GET', '/api/notebooks')).headers).has('X-StudyWorkbench-CSRF')).toBe(false)
  })
  it.each(['https://outside.example/api/a', '//outside.example/api/a', '/api/a/../auth/status', '/api/a/%2e%2e/auth/status', '/api/a%5cb', '/api/a#fragment'])('rejects noncanonical paths %s', async path => {
    await expect(prepareBrowserRequest('GET', path)).rejects.toThrow()
  })
  it('allows encoded IDs, not path traversal', () => {
    expect(protectedApiPath('/personal/source-versions/sv%3Aold%2F%E4%B8%80/download')).toBe('/personal/source-versions/sv%3Aold%2F%E4%B8%80/download')
  })
  it.each(['https://outside.example/audio', '//outside.example/audio', '/api/podcasts/episodes/a/audio/../../config', '/tmp/secret.mp3'])('rejects server-returned podcast escape %s', async path => {
    await expect(resolvePodcastAssetUrl(path)).rejects.toThrow()
  })
  it('keeps canonical protected podcast audio on the shared client', async () => {
    expect(await resolvePodcastAssetUrl('/api/podcasts/episodes/ep1/audio')).toBe('/podcasts/episodes/ep1/audio')
  })
})
describe('bounded auth classification without changing the resource error', () => {
  it.each([
    [401, 'ACCESS_EXPIRED', 'refresh-needed'], [401, 'AUTH_REQUIRED', 'reauth-required'],
    [401, 'AUTH_PENDING', 'pending'], [503, 'AUTH_UNAVAILABLE', 'unavailable'],
    [429, 'AUTH_BUSY', 'unavailable'], [401, 'NEEDS_REAUTH', null], [409, 'NOTE_CONFLICT', null],
  ])('classifies %s %s', async (status, code, phase) => {
    expect(await classifyAuthFailure(status as number, { error: { code } })).toBe(phase)
  })
  it('distinguishes an unknown/private ingress 401 from an app credential rejection', async () => {
    expect(await classifyAuthFailure(401, '<html>ingress sign-in</html>')).toBe('unavailable')
    expect(await classifyAuthFailure(503, { detail: 'resource outage' })).toBeNull()
  })
  it('reads only bounded JSON Blob errors without consuming the original', async () => {
    const blob = new Blob([JSON.stringify({ error: { code: 'ACCESS_EXPIRED' } })], { type: 'application/json' })
    expect(await classifyAuthFailure(401, blob)).toBe('refresh-needed')
    expect(blob.size).toBeGreaterThan(0)
    const huge = new Blob([' '.repeat(8193)], { type: 'application/json' })
    expect(await classifyAuthFailure(401, huge)).toBe('unavailable')
  })
})

it('direct SSE sends one private POST with signal, cookie/CSRF and redirect rejection', async () => {
  const { searchApi } = await import('./search')
  const signal = new AbortController().signal
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: fixture\n\n')); controller.close() } })
  const fetcher = vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetcher)
  const stream = await searchApi.askKnowledgeBase({ question: 'fixture question' } as never, signal)
  expect(stream).toBe(body)
  const options = fetcher.mock.calls[0][1] as RequestInit
  expect(options).toMatchObject({ method: 'POST', signal, redirect: 'error', credentials: 'same-origin' })
  expect(new Headers(options.headers).get('X-StudyWorkbench-CSRF')).toBe('1')
  expect(new Headers(options.headers).get('Authorization')).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
})
it('explicit legacy mode remains separate and is the only path that may read old credentials', async () => {
  metadata.authMode = 'legacy_password'; metadata.apiUrl = 'http://127.0.0.1:5055'
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-legacy-only' } }))
  const request = await prepareBrowserRequest('POST', '/api/search/ask')
  expect(request).toMatchObject({ url: 'http://127.0.0.1:5055/api/search/ask', credentials: 'omit', redirect: 'error' })
  expect(new Headers(request.headers).get('Authorization')).toBe('Bearer synthetic-legacy-only')
  metadata.authMode = 'device_sessions'; metadata.apiUrl = ''
  const device = await prepareBrowserRequest('POST', '/api/search/ask')
  expect(new Headers(device.headers).has('Authorization')).toBe(false)
  expect(localStorage.getItem('auth-storage')).toBeNull()
})
it('legacy requests observe another tab removing stored authorization immediately', async () => {
  const { getAuthToken, setLegacyAuthToken } = await import('@/lib/auth-token')
  setLegacyAuthToken('synthetic-tab-password')
  expect(getAuthToken('legacy_password')).toBe('synthetic-tab-password')
  localStorage.removeItem('auth-storage')
  window.dispatchEvent(new StorageEvent('storage', { key: 'auth-storage', newValue: null }))
  expect(getAuthToken('legacy_password')).toBeNull()
  metadata.authMode = 'legacy_password'
  expect(new Headers((await prepareBrowserRequest('GET', '/api/notebooks')).headers).has('Authorization')).toBe(false)
})
it('poll classification leaves Google reauth and unrelated backend failures distinct', async () => {
  const { isAuthRecoveryError } = await import('./browser-transport')
  expect(isAuthRecoveryError({ response: { status: 401, data: { error: { code: 'NEEDS_REAUTH' } } } })).toBe(false)
  expect(isAuthRecoveryError({ response: { status: 503, data: { detail: 'Resource unavailable' } } })).toBe(false)
  expect(isAuthRecoveryError({ response: { status: 401, data: { error: { code: 'ACCESS_EXPIRED' } } } })).toBe(true)
})

it('legacy corruption cannot reuse a previously loaded password', async () => {
  const { getAuthToken, setLegacyAuthToken } = await import('@/lib/auth-token')
  setLegacyAuthToken('synthetic-old-password')
  localStorage.setItem('auth-storage', '{corrupt')
  expect(getAuthToken('legacy_password')).toBeNull()
})

it('a custom AbortSignal reason stays cancellation, not an auth or service outage', async () => {
  const { browserFetch } = await import('./browser-transport')
  const { sessionCoordinator } = await import('@/lib/auth/session-coordinator')
  const onRecovery = vi.fn(); const unsubscribe = sessionCoordinator.subscribe(onRecovery)
  const controller = new AbortController(); const reason = new Error('user stopped this operation')
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(reason); throw reason }))
  try { await expect(browserFetch('/search/ask', { method: 'POST', signal: controller.signal })).rejects.toBe(reason); expect(onRecovery).not.toHaveBeenCalled() }
  finally { unsubscribe(); vi.unstubAllGlobals() }
})
