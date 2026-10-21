import { isAuthRecoveryError } from '@/lib/api/browser-transport'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { notebooklmApi } from '@/lib/api/notebooklm'
import { QUERY_KEYS } from '@/lib/api/query-client'
export function useNotebookLMStatus() { return useQuery({ queryKey: [...QUERY_KEYS.notebooklm, 'status'], queryFn: notebooklmApi.status, retry: false }) }
export function useNotebookLMCapabilities() { return useQuery({ queryKey: [...QUERY_KEYS.notebooklm, 'capabilities'], queryFn: notebooklmApi.capabilities, retry: false }) }
export function useNotebookLMFlow(flowId?: string) { return useQuery({ queryKey: [...QUERY_KEYS.notebooklm, 'flow', flowId], queryFn: () => notebooklmApi.flow(flowId!), enabled: !!flowId, retry: false, refetchInterval: query => !isAuthRecoveryError(query.state.error) && ['awaiting_user_login', 'verifying'].includes(query.state.data?.state || '') ? 2500 : false }) }
export function useRemoteNotebooks(enabled: boolean) { return useInfiniteQuery({ queryKey: [...QUERY_KEYS.notebooklm, 'notebooks'], queryFn: ({ pageParam }) => notebooklmApi.notebooks(pageParam), initialPageParam: undefined as string | undefined, getNextPageParam: page => page.next_cursor || undefined, enabled, retry: false }) }
export function useRemoteSources(remoteId: string, enabled: boolean) { return useInfiniteQuery({ queryKey: [...QUERY_KEYS.notebooklm, 'sources', remoteId], queryFn: ({ pageParam }) => notebooklmApi.sources(remoteId, pageParam), initialPageParam: undefined as string | undefined, getNextPageParam: page => page.next_cursor || undefined, enabled: enabled && !!remoteId, retry: false }) }

export function useRemoteArtifacts(remoteId: string, enabled: boolean) { return useQuery({ queryKey: [...QUERY_KEYS.notebooklm, 'artifacts', remoteId], queryFn: () => notebooklmApi.artifacts(remoteId), enabled: enabled && !!remoteId, retry: false }) }
