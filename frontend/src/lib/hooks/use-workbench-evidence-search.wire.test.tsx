import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import apiClient from '@/lib/api/client'
import { useWorkbenchEvidenceSearch } from '@/lib/hooks/use-workbench-evidence-search'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { invalidateTurnContext, publishTurnTarget } from '@/lib/workbench/turn-context'
import cases from '../../../../contracts/v1/fixtures/hybrid-search.json'
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => ({ authMode: 'legacy_password', apiUrl: 'https://fixture.example', webSessionProtocol: null })) }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => null }))
const original = apiClient.defaults.adapter
beforeEach(() => {
  sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
  invalidateTurnContext(); publishTurnTarget({ mode: 'legacy_password', apiBase: 'https://fixture.example/api', protocol: null }, true)
  apiClient.defaults.adapter = 'fetch'
})
afterEach(() => { vi.unstubAllGlobals(); apiClient.defaults.adapter = original })
it.each(Object.entries(cases))('preserves actual route JSON through transport and hook: %s', async (_name, wire) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(wire)))
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  const selection = { engine: 'independent', selection_origin: 'local', source_version_ids: ['v1'], remote_source_ids: [] }
  const sources = [{ source_id: 'source:public', title: 'Synthetic source', versions: [{ source_version_id: 'v1', status: 'ready' }] }]
  const { result } = renderHook(() => useWorkbenchEvidenceSearch('notebook:allowed', selection, sources), {
    wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  })
  act(() => { result.current.setQuery('Solar'); result.current.submit() })
  await waitFor(() => expect(result.current.status).toBe(wire.hits.length ? 'success' : 'empty'))
  expect(result.current.hits).toEqual(wire.hits)
  expect(result.current.metadata).toEqual('retrieval' in wire ? wire.retrieval : undefined)
})
