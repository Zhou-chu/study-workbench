import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { evidenceApi } from '@/lib/api/evidence'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { invalidateTurnContext, publishTurnTarget, readTurnContext } from '@/lib/workbench/turn-context'
import type { SemanticStatus } from '@/lib/types/personal'
import { useWorkbenchRetrieval } from './use-workbench-retrieval'
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { semanticStatus: vi.fn() } }))
const profile = { profile_id: 'p1', model_id: 'm1', provider: 'fake', model_name: 'fake', revision: 'r1', endpoint: 'https://fixture.example/embed', credential_binding_id: 'opaque', dimension: 3, document_prefix: '', query_prefix: '', preprocessing_revision: 'evidence-identity-v1' as const, max_input_bytes: 100, cosine_min_score: 0, destination_descriptor_version: 'd1', destination_kind: 'remote' as const, fingerprint: 'fp1', endpoint_fingerprint: 'ep1' }
const status: SemanticStatus = { notebook_id: 'n1', enabled: true, snapshot: { notebook_id: 'n1', entries: [{ version_id: 'v1', extraction_id: 'e1', manifest_hash: 'h1', scope_epoch: 1 }] }, profiles: [{ profile, index: { state: 'not_indexed', indexed_version_count: 0, selected_version_count: 1, profile_id: 'p1', manifests: [] } }], jobs: [], retry_safe: false, remote_cancel_confirmed: false }
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } })
  const key = QUERY_KEYS.semanticIndex('n1', ['v1'], readTurnContext()!.epoch)
  client.setQueryData(key, structuredClone(status))
  return { client, key, ...renderHook(() => useWorkbenchRetrieval('n1', ['v1']), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }) }
}
beforeEach(() => {
  vi.resetAllMocks(); invalidateTurnContext(); publishTurnTarget(target, true)
  sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue(structuredClone(status))
})
it('defaults lexical with no selected profile; document processing grants no query consent', async () => {
  const { result } = show()
  expect(result.current.options).toEqual({ retrieval_mode: 'lexical' }); expect(result.current.profileId).toBeNull()
  act(() => { result.current.setProfile('p1'); result.current.setMode('hybrid') })
  expect(result.current.available).toBe(false); expect(result.current.queryAcknowledged).toBe(false)
  act(() => result.current.acknowledge(true))
  expect(result.current.available).toBe(true)
  expect(result.current.options).toMatchObject({ disclosed_profile_fingerprint: 'fp1', destination_descriptor_version: 'd1', acknowledge_query_processing: true })
})
it.each(['fingerprint', 'destination_descriptor_version', 'destination_kind'] as const)('resets consent across canonical cache %s ABA before observer delivery', async field => {
  const { result, client, key } = show(); await waitFor(() => expect(evidenceApi.semanticStatus).toHaveBeenCalledTimes(1))
  act(() => { result.current.setProfile('p1'); result.current.setMode('hybrid') })
  act(() => result.current.acknowledge(true))
  expect(result.current.queryAcknowledged).toBe(true)
  const rotated = structuredClone(status); Object.assign(rotated.profiles[0].profile, { [field]: field === 'destination_kind' ? 'unknown' : 'rotated' })
  act(() => { client.setQueryData(key, rotated); client.setQueryData(key, structuredClone(status)) })
  expect(result.current.queryAcknowledged).toBe(false); expect(result.current.available).toBe(false)
  expect(result.current.options.acknowledge_query_processing).toBe(false)
})
it('requires new acknowledgment after mode/profile ABA and fails closed on removed or errored metadata', async () => {
  const { result, client, key } = show(); await waitFor(() => expect(evidenceApi.semanticStatus).toHaveBeenCalledTimes(1))
  act(() => { result.current.setProfile('p1'); result.current.setMode('hybrid') })
  act(() => result.current.acknowledge(true))
  act(() => { result.current.setMode('lexical'); result.current.setMode('hybrid') })
  expect(result.current.available).toBe(false)
  act(() => result.current.acknowledge(true)); expect(result.current.available).toBe(true)
  act(() => { client.removeQueries({ queryKey: key, exact: true }); client.setQueryData(key, structuredClone(status)) })
  expect(result.current.available).toBe(false)
})


it.each(['destination', 'mode ABA'] as const)('does not grant newly canonical consent from a stale rendered checkbox after %s', async change => {
  const { result, client, key } = show()
  await waitFor(() => expect(evidenceApi.semanticStatus).toHaveBeenCalledTimes(1))
  act(() => { result.current.setProfile('p1'); result.current.setMode('hybrid') })
  const oldAcknowledgment = result.current.acknowledge
  const rotated = structuredClone(status); Object.assign(rotated.profiles[0].profile, { fingerprint: 'fp2', endpoint: 'https://rotated.example/endpoint', destination_descriptor_version: 'd2' })
  act(() => {
    if (change === 'destination') client.setQueryData(key, rotated)
    else { result.current.setMode('lexical'); result.current.setMode('hybrid') }
    oldAcknowledgment(true)
  })
  expect(result.current.queryAcknowledged).toBe(false); expect(result.current.available).toBe(false)
  expect(result.current.readOptions().acknowledge_query_processing).toBe(false)
  act(() => result.current.acknowledge(true))
  expect(result.current.queryAcknowledged).toBe(true)
})
