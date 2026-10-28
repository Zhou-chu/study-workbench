import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest'
import apiClient from './client'
import { evidenceApi } from './evidence'
import { getConfig } from '@/lib/config'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { invalidateTurnContext, publishTurnTarget, readTurnContext, type TurnContext } from '@/lib/workbench/turn-context'

vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => ({ authMode: 'legacy_password', apiUrl: 'https://fixture.example', webSessionProtocol: null })) }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => null }))
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
const result = { hits: [], retrieval_method: 'lexical' }
const original = apiClient.defaults.adapter
beforeEach(() => {
  vi.mocked(getConfig).mockReset().mockResolvedValue({ authMode: 'legacy_password', apiUrl: 'https://fixture.example', webSessionProtocol: null } as never)
  sessionCoordinator.setPhase('authenticated')
  invalidateTurnContext(); publishTurnTarget(target, true)
  apiClient.defaults.adapter = 'fetch'
})
afterEach(() => { vi.unstubAllGlobals(); apiClient.defaults.adapter = original })

it('preserves the exact two-argument search DTO and result', async () => {
  const native = vi.fn<typeof fetch>(async () => Response.json(result)); vi.stubGlobal('fetch', native)
  expect(await evidenceApi.search('exact query', ['sv_old', 'sv_new'])).toEqual(result)
  expect(native).toHaveBeenCalledTimes(1)
  const wire = native.mock.calls[0][0] as Request
  expect(wire.method).toBe('POST'); expect(wire.url).toBe('https://fixture.example/api/personal/search')
  expect(JSON.parse(await wire.text())).toEqual({ query: 'exact query', source_version_ids: ['sv_old', 'sv_new'] })
})
it('forwards optional captured context without adding metadata to the search DTO', async () => {
  expectTypeOf<Parameters<typeof evidenceApi.search>[2]>().toEqualTypeOf<TurnContext | undefined>()
  const native = vi.fn<typeof fetch>(async () => Response.json(result)); vi.stubGlobal('fetch', native)
  expect(await evidenceApi.search('exact query', ['sv_old'], readTurnContext()!)).toEqual(result)
  expect(native).toHaveBeenCalledTimes(1)
  expect(JSON.parse(await (native.mock.calls[0][0] as Request).text())).toEqual({ query: 'exact query', source_version_ids: ['sv_old'] })
})
it.each(['privacy', 'target'] as const)('rejects a captured search after %s changes before native dispatch', async change => {
  const native = vi.fn<typeof fetch>(async () => Response.json(result)); vi.stubGlobal('fetch', native)
  const context = readTurnContext()!
  if (change === 'privacy') invalidateTurnContext()
  else publishTurnTarget({ ...target, apiBase: 'https://other.example/api' }, true)
  await expect(evidenceApi.search('private query', ['sv_old'], context)).rejects.toMatchObject({ name: 'RequestNotDispatchedError' })
  expect(native).not.toHaveBeenCalled()
})
it('rejects a target change during asynchronous transport preparation instead of sending the old query to the new endpoint', async () => {
  const native = vi.fn<typeof fetch>(async () => Response.json(result)); vi.stubGlobal('fetch', native)
  let finish!: (value: Awaited<ReturnType<typeof getConfig>>) => void
  vi.mocked(getConfig).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const pending = evidenceApi.search('private query', ['sv_old'], readTurnContext()!)
  await vi.waitFor(() => expect(getConfig).toHaveBeenCalled())
  publishTurnTarget({ ...target, apiBase: 'https://other.example/api' }, true)
  finish({ authMode: 'legacy_password', apiUrl: 'https://other.example', webSessionProtocol: null } as never)
  await expect(pending).rejects.toMatchObject({ name: 'RequestNotDispatchedError' })
  expect(native).not.toHaveBeenCalled()
})
