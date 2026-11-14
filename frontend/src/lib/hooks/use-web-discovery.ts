import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { webDiscoveryApi, type WebResult } from '@/lib/api/web-discovery'
import { QUERY_KEYS } from '@/lib/api/query-client'

export const WEB_DISCOVERY_QUERY_KEYS = { status: ['personal', 'web-search', 'status'] as const }

export function useWebSearchStatus(enabled = true) {
  return useQuery({ queryKey: WEB_DISCOVERY_QUERY_KEYS.status, queryFn: ({ signal }) => webDiscoveryApi.status(signal), enabled, retry: false, staleTime: 30000 })
}

export function useWebSearch() {
  // Queries are not query-cache keys, browser storage or search history.
  return useMutation({ mutationFn: ({ query, signal }: { query: string; signal: AbortSignal }) => webDiscoveryApi.search(query, signal), retry: false, gcTime: 0 })
}

export function useImportWebSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ notebookId, result, idempotencyKey }: { notebookId: string; result: WebResult; idempotencyKey: string }) => webDiscoveryApi.importSource(notebookId, result, idempotencyKey),
    retry: false,
    onSettled: (_data, _error, variables) => {
      // An interrupted response is not proof that import did not finish.
      void client.invalidateQueries({ queryKey: QUERY_KEYS.workbench(variables.notebookId) })
      void client.invalidateQueries({ queryKey: ['sources'] })
    },
  })
}
