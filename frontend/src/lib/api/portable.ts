import apiClient from './client'
import type { BridgeJob } from '@/lib/types/personal'
export const portableApi = {
  export: async (notebookId: string) => (await apiClient.post<BridgeJob>(`/personal/notebooks/${encodeURIComponent(notebookId)}/exports`, { idempotency_key: crypto.randomUUID() })).data,
  restore: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return (await apiClient.post<{ notebook_id?: string; job_id?: string; report?: unknown }>('/personal/imports/portable', form)).data
  },
  // Never attach the application bearer token to a server-supplied external URL.
  download: async (url: string, signal?: AbortSignal) => {
    const path = url.startsWith('/api/personal/') ? url.slice(4) : url
    if (!path.startsWith('/personal/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid protected download path')
    return (await apiClient.get<Blob>(path, { responseType: 'blob', signal })).data
  },
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.replace(/[\\/]/g, '_')
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
