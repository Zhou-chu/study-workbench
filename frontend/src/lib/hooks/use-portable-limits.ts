import { useQuery } from '@tanstack/react-query'
import { portableApi } from '@/lib/api/portable'
import { QUERY_KEYS } from '@/lib/api/query-client'

export function usePortableLimits(enabled: boolean) {
  return useQuery({
    queryKey: QUERY_KEYS.portableLimits,
    queryFn: portableApi.limits,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
