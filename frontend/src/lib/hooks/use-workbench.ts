import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workbenchApi } from '@/lib/api/workbench'
import { QUERY_KEYS } from '@/lib/api/query-client'
import type { WorkbenchSelection } from '@/lib/types/personal'
import { useToast } from './use-toast'
import { useTranslation } from './use-translation'

export const activeJob = (state?: string) => ['queued', 'running', 'waiting_remote'].includes(state || '')
export function useWorkbench(notebookId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.workbench(notebookId), queryFn: () => workbenchApi.workspace(notebookId), retry: false,
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.jobs?.some(job => activeJob(job.state)) || data?.sources?.some(source => source.versions.some(version => ['queued', 'running', 'pending', 'extracting'].includes(version.status || version.extraction_status || ''))) ? 2000 : false
    },
  })
}
export function useSaveWorkbenchSelection(notebookId: string) {
  const { toast } = useToast()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (selection: WorkbenchSelection) => workbenchApi.saveSelection(notebookId, selection),
    scope: { id: `workbench-selection:${notebookId}` }, retry: false,
    onError: () => toast({ title: t('workbench.error'), variant: 'destructive' }),
  })
}
export function useWorkbenchAction<T>(notebookId: string, action: () => Promise<T>) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  return useMutation({ mutationFn: action, retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) }),
    onError: () => toast({ title: t('workbench.error'), variant: 'destructive' }),
  })
}
