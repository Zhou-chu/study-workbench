import { afterEach, expect, it, vi } from 'vitest'
import { sourceChatApi } from './source-chat'

vi.mock('@/lib/config', () => ({ getConfig: async () => ({ authMode: 'device_sessions', apiUrl: '' }), getApiUrl: async () => '' }))
afterEach(() => vi.unstubAllGlobals())

it('forwards cancellation through the real browser transport without buffering or replaying the SSE request', async () => {
  const controller = new AbortController()
  let bodyController!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(value) { bodyController = value } })
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    options?.signal?.addEventListener('abort', () => bodyController.error(new DOMException('Canceled', 'AbortError')))
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetcher)
  const stream = await sourceChatApi.sendMessage('source:one', 'chat_session:one', { message: 'hello' }, controller.signal)
  expect(stream).toBe(body)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, options] = fetcher.mock.calls[0]
  expect(url).toBe('/api/sources/source:one/chat/sessions/chat_session:one/messages')
  expect(options).toMatchObject({ method: 'POST', signal: controller.signal, credentials: 'same-origin', redirect: 'error', body: JSON.stringify({ message: 'hello' }) })
  expect(new Headers(options?.headers).get('X-StudyWorkbench-CSRF')).toBe('1')
  expect(new Headers(options?.headers).has('Authorization')).toBe(false)
  const reading = stream!.getReader().read()
  controller.abort()
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
