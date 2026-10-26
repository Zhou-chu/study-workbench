import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest'
import apiClient from './client'
import { workbenchApi } from './workbench'
import { invalidateTurnContext, publishTurnTarget, readTurnContext } from '@/lib/workbench/turn-context'
import type { TurnContext } from '@/lib/workbench/turn-context'
import type { JobState, TurnRequest, TurnSubmissionResponse } from '@/lib/types/personal'

vi.mock('@/lib/config', () => ({ getApiUrl: async () => 'http://127.0.0.1:5055', getConfig: async () => ({ authMode: 'legacy_password', apiUrl: 'http://127.0.0.1:5055' }) }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => 'synthetic-not-a-credential' }))

const original = apiClient.defaults.adapter
beforeEach(() => { vi.stubGlobal('Request', BrowserRequest); publishTurnTarget({ mode: 'legacy_password', apiBase: 'http://127.0.0.1:5055/api', protocol: null }, true) })
class BrowserRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) { super(typeof input === 'string' ? new URL(input, window.location.href) : input, init) }
}
afterEach(() => { vi.unstubAllGlobals(); apiClient.defaults.adapter = original })

it('types a turn acknowledgement as a receipt, not an answer', async () => {
  expectTypeOf<Awaited<ReturnType<typeof workbenchApi.turn>>>().toEqualTypeOf<TurnSubmissionResponse>()
  const receipt = { job_id: 'job:opaque', turn_id: 'turn:opaque', state: 'future_state' }
  const adapter = vi.fn(async config => ({ data: receipt, status: 200, statusText: 'OK', headers: {}, config }))
  apiClient.defaults.adapter = adapter
  const response = await workbenchApi.turn('chat/opaque', { notebook_id: 'notebook:synthetic', engine: 'independent', message: 'Synthetic', task: 'question', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], idempotency_key: 'synthetic-key' })
  expect(response).toEqual(receipt)
  expect(adapter).toHaveBeenCalledTimes(1)
})

it('preserves unknown and historical fields without retry or normalization', async () => {
  const state: JobState = 'future_state'
  const payload = { job_id: 'job:opaque', operation: 'future_operation', state, submission_state: 'future_submission', result: null, restored_history: true, replay_allowed: false, historical_state: 'submission_unknown', extension: { provenance: { independent_support: false }, nullable: null } }
  const adapter = vi.fn(async config => ({ data: payload, status: 200, statusText: 'OK', headers: {}, config }))
  apiClient.defaults.adapter = adapter
  expect(await workbenchApi.job('job:opaque')).toEqual(payload)
  expect(adapter).toHaveBeenCalledTimes(1)
  expect(await workbenchApi.cancelJob('job:opaque')).toEqual(payload)
  expect(adapter).toHaveBeenCalledTimes(2) // Explicit call only; no state-derived actions.
})

it('retains workspace nulls, absent fields and opaque extensions without projection or writes', async () => {
  const { default: fixture } = await import('../../../../contracts/v1/fixtures/workspace-read-compatibility.json')
  for (const { value } of fixture.selections) {
    const payload = { ...fixture.workspace, selection: value }
    const adapter = vi.fn(async config => ({ data: payload, status: 200, statusText: 'OK', headers: {}, config }))
    apiClient.defaults.adapter = adapter
    const response = await workbenchApi.workspace('notebook:synthetic')
    expect(response).toEqual(payload)
    expect(response.sources[0].versions[2]).not.toHaveProperty('source_version_id')
    expect(response.notes[1]).not.toHaveProperty('content')
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(adapter.mock.calls[0][0].method).toBe('get')
  }
})

it('offers optional context on turn and read-only recovery endpoints; no reading in the turn write contract', async () => {
  expectTypeOf<TurnRequest>().not.toHaveProperty('reading')
  expectTypeOf<Parameters<typeof workbenchApi.turn>[2]>().toEqualTypeOf<TurnContext | undefined>()
  expectTypeOf<Parameters<typeof workbenchApi.workspace>[1]>().toEqualTypeOf<TurnContext | undefined>()
  expectTypeOf<Parameters<typeof workbenchApi.turns>[1]>().toEqualTypeOf<TurnContext | undefined>()
  const receipt = { job_id: 'job:opaque', turn_id: 'turn:opaque', state: 'future_state', dispatch_receipt: { retry_safe: true, future: null } }
  const native = vi.fn<typeof fetch>(async () => Response.json(receipt))
  vi.stubGlobal('fetch', native); apiClient.defaults.adapter = 'fetch'
  const context = readTurnContext()!
  const result = await workbenchApi.turn('chat/opaque', { notebook_id: 'notebook:synthetic', engine: 'independent', message: 'Synthetic', task: 'question', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], idempotency_key: 'synthetic-key' }, context)
  expectTypeOf(result.dispatch_receipt).toEqualTypeOf<unknown>()
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
