'use client'
import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { workbenchApi } from '@/lib/api/workbench'
import { requestError } from '@/lib/utils/workbench'

type UploadState = 'uploading' | 'uploadAccepted' | 'uploadFailed' | 'uploadUncertain'
interface UploadItem { id: string; name: string; state: UploadState; error?: string | null }
interface PendingUpload { notebookId: string; file: File; sourceId?: string; inFlight: boolean }

// Files and recovery keys live only in this mounted workbench, never browser storage.
export function useWorkbenchUploads(notebookId: string, onAccepted: () => unknown) {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const pending = useRef(new Map<string, PendingUpload>())
  useEffect(() => {
    const entries = pending.current
    setUploads([])
    return () => { entries.clear() }
  }, [notebookId])

  const retryUpload = async (id: string) => {
    const entry = pending.current.get(id)
    if (!entry || entry.inFlight) return
    entry.inFlight = true
    setUploads(items => items.map(item => item.id === id ? { ...item, state: 'uploading', error: null } : item))
    try {
      await workbenchApi.upload(entry.notebookId, entry.file, id, entry.sourceId)
      if (pending.current.get(id) !== entry) return
      pending.current.delete(id)
      setUploads(items => items.map(item => item.id === id ? { ...item, state: 'uploadAccepted', error: null } : item))
      onAccepted()
    } catch (error) {
      if (pending.current.get(id) !== entry) return
      entry.inFlight = false
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      // A missing response or server error cannot prove the upload wasn't saved.
      const rejected = status !== undefined && status >= 400 && status < 500 && status !== 408
      setUploads(items => items.map(item => item.id === id ? { ...item, state: rejected ? 'uploadFailed' : 'uploadUncertain', error: rejected ? requestError(error) : null } : item))
    }
  }
  const upload = async (files: FileList | null, sourceId?: string) => {
    if (!files) return
    const ids: string[] = []
    for (const file of Array.from(files)) {
      // Re-selecting a pending file must not create a second submission. Use its row to retry.
      if ([...pending.current.values()].some(entry => entry.sourceId === sourceId && entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified && entry.file.type === file.type)) continue
      const id = crypto.randomUUID()
      pending.current.set(id, { notebookId, file, sourceId, inFlight: false })
      setUploads(items => [...items, { id, name: file.name, state: 'uploading' }])
      ids.push(id)
    }
    await Promise.all(ids.map(retryUpload))
  }
  const dismissUpload = (id: string) => {
    if (pending.current.get(id)?.inFlight) return
    pending.current.delete(id)
    setUploads(items => items.filter(item => item.id !== id))
  }
  return { uploads, upload, retryUpload, dismissUpload }
}
