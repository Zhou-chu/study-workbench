import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import apiClient from './client'
import { workbenchApi } from './workbench'
import { invalidateTurnContext, publishTurnTarget, readTurnContext } from '@/lib/workbench/turn-context'

vi.mock('@/lib/config', () => ({ getApiUrl: async () => 'http://127.0.0.1:5055', getConfig: async () => ({ authMode: 'legacy_password', apiUrl: 'http://127.0.0.1:5055' }) }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => 'synthetic-not-a-credential' }))

const original = apiClient.defaults.adapter
beforeEach(() => { vi.stubGlobal('Request', BrowserRequest); publishTurnTarget({ mode: 'legacy_password', apiBase: 'http://127.0.0.1:5055/api', protocol: null }, true) })
class BrowserRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) { super(typeof input === 'string' ? new URL(input, window.location.href) : input, init) }
}
afterEach(() => { vi.unstubAllGlobals(); apiClient.defaults.adapter = original })

it('offers optional context on turn and read-only recovery endpoints; no reading in the turn write contract', async () => {
  const receipt = { job_id: 'job:opaque', turn_id: 'turn:opaque', state: 'future_state', dispatch_receipt: { retry_safe: true, future: null } }
  const native = vi.fn<typeof fetch>(async () => Response.json(receipt))
  vi.stubGlobal('fetch', native); apiClient.defaults.adapter = 'fetch'
  const context = readTurnContext()!
  const result = await workbenchApi.turn('chat/opaque', { notebook_id: 'notebook:synthetic', engine: 'independent', message: 'Synthetic', task: 'question', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], idempotency_key: 'synthetic-key' }, context)
  expect(result).toEqual(receipt)
  await workbenchApi.workspace('notebook:synthetic', context); await workbenchApi.turns('chat/opaque', context)
  expect(native.mock.calls).toHaveLength(3)
  const wire = native.mock.calls.map(call => call[0] as Request)
  expect(wire.map(request => request.method)).toEqual(['POST', 'GET', 'GET'])
  expect(wire.map(request => request.url)).toEqual(['http://127.0.0.1:5055/api/personal/chats/chat%2Fopaque/turns', 'http://127.0.0.1:5055/api/personal/notebooks/notebook%3Asynthetic/workspace', 'http://127.0.0.1:5055/api/personal/chats/chat%2Fopaque/turns'])
  expect(await wire[0].text()).not.toContain('reading')
})

it.each(['turn', 'workspace', 'turns'] as const)('passes the context precondition to %s rather than silently ignoring it', async endpoint => {
  const native = vi.fn<typeof fetch>(async () => Response.json({}))
  vi.stubGlobal('fetch', native); apiClient.defaults.adapter = 'fetch'
  const context = readTurnContext()!; invalidateTurnContext()
  const pending = endpoint === 'turn' ? workbenchApi.turn('c', { notebook_id: 'n', engine: 'independent', message: 'Synthetic', task: 'question', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], idempotency_key: 'k' }, context) : workbenchApi[endpoint]('n', context)
  await expect(pending).rejects.toMatchObject({ name: 'RequestNotDispatchedError' }); expect(native).not.toHaveBeenCalled()
})


it('guards selection PATCH with optional captured context and preserves the complete wire payload', async () => {
  const native = vi.fn<typeof fetch>(async () => Response.json({}))
  vi.stubGlobal('fetch', native); apiClient.defaults.adapter = 'fetch'
  const context = readTurnContext()!
  const body = { engine: 'independent' as const, selection_origin: 'local' as const, source_version_ids: ['sv:old'], remote_source_ids: [], reading: { source_version_id: 'sv:old', page_index: 8 } }
  await workbenchApi.saveSelection('notebook:synthetic', body, context)
  const wire = native.mock.calls[0][0] as Request
  expect(wire.method).toBe('PATCH'); expect(wire.url).toBe('http://127.0.0.1:5055/api/personal/notebooks/notebook%3Asynthetic/selection')
  expect(JSON.parse(await wire.text())).toEqual(body)
  invalidateTurnContext()
  await expect(workbenchApi.saveSelection('notebook:synthetic', body, context)).rejects.toMatchObject({ name: 'RequestNotDispatchedError' })
  expect(native).toHaveBeenCalledTimes(1)
})


it('rechecks selection context at final native send after body preparation, without replay', async () => {
  const native = vi.fn<typeof fetch>(async () => Response.json({}))
  vi.stubGlobal('fetch', native); apiClient.defaults.adapter = 'fetch'
  const context = readTurnContext()!
  const selection = { engine: 'independent' as const, selection_origin: 'local' as const, source_version_ids: ['sv:old'], remote_source_ids: [], reading: { source_version_id: 'sv:old', page_index: 8 } }
  const body = { ...selection, toJSON() { queueMicrotask(invalidateTurnContext); return selection } }
  // The real adapter awaits body-length preparation only with a finite budget.
  const budget = apiClient.defaults.maxBodyLength
  apiClient.defaults.maxBodyLength = 4096
  try {
    await expect(workbenchApi.saveSelection('notebook:synthetic', body, context)).rejects.toMatchObject({ name: 'RequestNotDispatchedError' })
    expect(native).not.toHaveBeenCalled()
  } finally { apiClient.defaults.maxBodyLength = budget }
})
