import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sourceSnapshotsApi } from '@/lib/api/source-snapshots'
import { QUERY_KEYS } from '@/lib/api/query-client'
import type { SourceSnapshotRequest } from '@/lib/types/source-snapshots'

// Carry the notebook in the mutation variables: navigation while a request is
// pending must invalidate the original notebook, not the currently shown one.
export function useSourceSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ notebookId, request }: { notebookId: string; request: SourceSnapshotRequest }) => sourceSnapshotsApi.create(notebookId, request),
    retry: false,
    onSuccess: (_result, { notebookId }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) })
      void queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })
}
