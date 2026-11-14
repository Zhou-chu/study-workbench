'use client'
import { useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { evidenceApi } from '@/lib/api/evidence'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import type { RetrievalOptions, SemanticStatus } from '@/lib/types/personal'
import { readTurnContext, subscribeTurnContext, validRetrievalOptions } from '@/lib/workbench/turn-context'
const serverContext = () => null
export function semanticStatusKey(notebookId: string, ids: readonly string[]) { return QUERY_KEYS.semanticIndex(notebookId, ids, readTurnContext()?.epoch) }
export function currentSemanticStatus(client: QueryClient, notebookId: string, ids: readonly string[]) {
  const query = client.getQueryState<SemanticStatus>(semanticStatusKey(notebookId, ids))
  const data = query?.status === 'success' ? query.data : undefined
  if (!data || data.notebook_id !== notebookId || JSON.stringify(data.snapshot?.entries.map(entry => entry.version_id).sort()) !== JSON.stringify([...ids].sort())) return undefined
  return data
}
export function semanticOptionsAllowed(client: QueryClient, notebookId: string, ids: readonly string[], options?: RetrievalOptions): boolean {
  if (!options || options.retrieval_mode !== 'hybrid') return !options || validRetrievalOptions(options)
  if (!validRetrievalOptions(options)) return false
  const status = currentSemanticStatus(client, notebookId, ids)
  const profile = status?.profiles.find(row => row.profile.profile_id === options.embedding_profile_id)?.profile
  return status?.enabled === true && !!profile && profile.fingerprint === options.disclosed_profile_fingerprint && profile.destination_descriptor_version === options.destination_descriptor_version && (profile.destination_kind === 'on_device' || options.acknowledge_query_processing === true)
}
/** Safe metadata read only. Polling never creates a model, preview, or submission. */
export function useSemanticStatus(notebookId: string, ids: readonly string[]) {
  const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, serverContext)
  const phase = useAuthStore(state => state.phase)
  return useQuery({ queryKey: QUERY_KEYS.semanticIndex(notebookId, ids, context?.epoch),
    queryFn: () => evidenceApi.semanticStatus(notebookId, ids, context ?? undefined),
    enabled: ids.length > 0 && !!context?.ready && phase === 'authenticated' && sessionCoordinator.resourcePhase() === 'authenticated',
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 0,
    refetchInterval: query => !query.state.error && query.state.data?.jobs.some(job => ['queued', 'running'].includes(job.state)) ? 2000 : false,
  })
}
