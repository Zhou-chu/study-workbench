import { afterEach, expect, expectTypeOf, it, vi } from 'vitest'
import apiClient from './client'
import { workbenchApi } from './workbench'
import type { JobState, TurnSubmissionResponse } from '@/lib/types/personal'

vi.mock('@/lib/config', () => ({ getApiUrl: async () => 'http://127.0.0.1:5055', getConfig: async () => ({ authMode: 'legacy_password', apiUrl: 'http://127.0.0.1:5055' }) }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => 'synthetic-not-a-credential' }))

const original = apiClient.defaults.adapter
afterEach(() => { apiClient.defaults.adapter = original })

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
