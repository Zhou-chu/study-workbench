import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './browser-transport'
import './podcasts'
const metadata = vi.hoisted(() => ({ authMode: 'device_sessions', apiUrl: '', webSessionProtocol: 'bff-memory-v1' }))
vi.mock('@/lib/config', () => ({ getConfig: async () => metadata, getApiUrl: async () => metadata.apiUrl }))
beforeEach(() => { metadata.authMode = 'device_sessions'; metadata.apiUrl = ''; localStorage.setItem('auth-storage', '{invalid secret') })
afterEach(() => localStorage.clear())
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

it('a custom AbortSignal reason stays cancellation, not an auth or service outage', async () => {
  const { browserFetch } = await import('./browser-transport')
  const { sessionCoordinator } = await import('@/lib/auth/session-coordinator')
  const onRecovery = vi.fn(); const unsubscribe = sessionCoordinator.subscribe(onRecovery)
  const controller = new AbortController(); const reason = new Error('user stopped this operation')
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(reason); throw reason }))
  try { await expect(browserFetch('/search/ask', { method: 'POST', signal: controller.signal })).rejects.toBe(reason); expect(onRecovery).not.toHaveBeenCalled() }
  finally { unsubscribe(); vi.unstubAllGlobals() }
})

describe('legacy private-ingress cookie boundary', () => {
  it('preserves legacy SSE body, signal and stream with same-origin cookies', async () => {
    const { browserFetch } = await import('./browser-transport')
    const { sessionCoordinator } = await import('@/lib/auth/session-coordinator')
    sessionCoordinator.setPhase('authenticated')
    metadata.authMode = 'legacy_password'; metadata.apiUrl = window.location.origin
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: synthetic\n\n')); c.close() } })
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    try {
      const response = await browserFetch('/search/ask', { method: 'POST', body: 'synthetic', signal })
      expect(response.body).toBe(body)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0][1]).toMatchObject({ body: 'synthetic', signal, credentials: 'same-origin', redirect: 'error' })
    } finally { vi.unstubAllGlobals() }
  })
})
