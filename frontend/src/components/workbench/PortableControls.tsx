'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { portableApi, saveBlob } from '@/lib/api/portable'
import { workbenchApi } from '@/lib/api/workbench'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { activeJob } from '@/lib/hooks/use-workbench'
import { usePortableLimits } from '@/lib/hooks/use-portable-limits'
import { useTranslation } from '@/lib/hooks/use-translation'
import { requestError } from '@/lib/utils/workbench'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type PortableControlsProps = { notebookId: string; onChanged: () => void }

export function PortableControls(props: PortableControlsProps) {
  // A notebook switch must not carry transient requests, files or download feedback across projects.
  return <NotebookPortableControls key={props.notebookId} {...props} />
}

function NotebookPortableControls({ notebookId, onChanged }: PortableControlsProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const limits = usePortableLimits(!!file)
  const validLimits = !!limits.data && [
    limits.data.max_archive_bytes, limits.data.max_expanded_bytes,
    limits.data.max_entity_bytes, limits.data.max_manifest_bytes,
    limits.data.max_request_bytes, limits.data.multipart_overhead_bytes,
    limits.data.max_entries, limits.data.max_compression_ratio,
  ].every(value => Number.isFinite(value) && value > 0)
  // Cached values must never permit an upload while the current check is pending or failed.
  const limitsReady = limits.isSuccess && !limits.isFetching && validLimits
  const tooLarge = limitsReady && !!file && file.size > limits.data!.max_archive_bytes
  const canRestore = limitsReady && !!file && !tooLarge
  const limitsFailed = !limits.isFetching && (limits.isError || (limits.isSuccess && !validLimits))
  const exporting = useMutation({ mutationFn: (id: string) => portableApi.export(id), retry: false, onSuccess: onChanged })
  const submitted = exporting.variables === notebookId ? exporting.data : undefined
  // Isolated from history polling: a failed check here stays paused until explicitly refreshed.
  const exportStatus = useQuery({
    queryKey: [...QUERY_KEYS.personalJob(submitted?.job_id || ''), 'portable-progress'],
    queryFn: () => workbenchApi.job(submitted!.job_id),
    enabled: !!submitted,
    initialData: submitted,
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: query => query.state.status !== 'error' && activeJob(query.state.data?.state) ? 2000 : false,
  })
  const currentExport = submitted ? exportStatus.data || submitted : undefined
  const terminalExport = currentExport && ['succeeded', 'failed', 'cancelled_local'].includes(currentExport.state)
  const exportBusy = exporting.isPending || (!!submitted && (!terminalExport || exportStatus.isError))
  const result = currentExport?.result && typeof currentExport.result === 'object' && !Array.isArray(currentExport.result) ? currentExport.result as Record<string, unknown> : undefined
  const candidate = result?.download_url
  const downloadUrl = currentExport?.state === 'succeeded' && currentExport.operation === 'portable_export' && currentExport.restored_history !== true && typeof candidate === 'string' && /^\/(?:api\/)?personal\/exports\/[^/?#]+\/download$/.test(candidate) ? candidate : undefined
  const download = useMutation({ mutationFn: async () => {
    if (!downloadUrl || !currentExport) return
    const blob = await portableApi.download(downloadUrl)
    saveBlob(blob, 'study-workbench-project.zip')
  }, retry: false })
  const exportMessage = activeJob(currentExport?.state) ? 'workbench.exportPreparing'
    : currentExport?.state === 'failed' ? 'workbench.exportFailed'
    : currentExport?.state === 'cancelled_local' ? 'workbench.exportCancelled'
    : downloadUrl ? 'workbench.exportReady' : 'workbench.exportUnavailable'
  const restoring = useMutation({ mutationFn: (packageFile: File) => portableApi.restore(packageFile), retry: false, onSuccess: () => { setFile(null); onChanged() } })
  return <div className="relative max-w-sm space-y-2">
    <details className="group"><summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{t('workbench.exportDetails')}</summary><div className="mt-2 space-y-2 rounded-md border bg-card p-3">
    <div className="flex flex-wrap gap-2 items-center"><Button size="sm" variant="outline" disabled={exportBusy} onClick={() => { download.reset(); exporting.mutate(notebookId) }}>{t('workbench.exportProject')}</Button>
      <label className="relative cursor-pointer rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">{t('workbench.restoreProject')}<input className="sr-only" type="file" accept=".zip,application/zip" disabled={restoring.isPending} onChange={event => { setFile(event.target.files?.[0] || null); event.target.value = '' }} /></label>
    </div>
    {exporting.isPending && <p role="status" className="text-xs">{t('workbench.exportPreparing')}</p>}
    {exporting.isError && <p role="alert" className="text-xs">{t('workbench.exportRequestUncertain')}</p>}
    {currentExport && <div className="space-y-2 text-xs">
      {exportStatus.isError ? <p role="alert">{t('workbench.exportStatusError')}</p> : <p role="status">{t(exportMessage)}</p>}
      {(exportStatus.isError || (!activeJob(currentExport.state) && !terminalExport) || (currentExport.state === 'succeeded' && !downloadUrl)) && <Button size="sm" variant="outline" disabled={exportStatus.isFetching} onClick={() => void exportStatus.refetch()}>{t('workbench.refreshExportStatus')}</Button>}
      {downloadUrl && !exportStatus.isError && <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>{t('workbench.downloadProject')}</Button>}
      {download.isPending && <p role="status">{t('workbench.exportDownloading')}</p>}
      {download.isError && <p role="alert">{t('workbench.exportDownloadError')}</p>}
      {download.isSuccess && <p role="status">{t('workbench.exportDownloadStarted')}</p>}
      <p className="text-muted-foreground">{t('workbench.exportHistoryHint')}</p>
      <details className="text-muted-foreground"><summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring">{t('workbench.jobTechnicalDetails')}</summary><p className="break-all">{t('workbench.jobId')}: {currentExport.job_id}</p></details>
    </div>}
    <p className="text-xs text-muted-foreground">{t('workbench.exportCoverage')}</p><p className="text-xs text-muted-foreground">{t('workbench.portableLimitsHint')}</p></div></details>
    {restoring.isPending && <p role="status" className="text-xs">{t('common.processing')}</p>}
    {restoring.isError && <p role="alert" className="text-xs text-destructive">{requestError(restoring.error) || t('workbench.error')}</p>}
    {restoring.data?.notebook_id && <Link className="text-sm text-primary hover:underline" href={`/notebooks/${encodeURIComponent(restoring.data.notebook_id)}/study`}>{t('workbench.restoredNotebook')}</Link>}
    <Dialog open={!!file} onOpenChange={open => { if (!open && !restoring.isPending) setFile(null) }}><DialogContent data-workbench-controls className="sm:max-w-lg"><DialogHeader><DialogTitle>{t('workbench.restoreProject')}</DialogTitle><DialogDescription>{t('workbench.restoreConfirm')}</DialogDescription></DialogHeader><p className="text-sm break-all">{file?.name}</p><p className="text-xs text-muted-foreground">{t('workbench.packageSize', { bytes: file?.size.toLocaleString() })}</p>{limits.isFetching && <p role="status" className="text-xs">{t('workbench.portableLimitsLoading')}</p>}
      {limitsFailed && <div><p role="alert" className="text-xs text-destructive">{t('workbench.portableLimitsError')}</p><Button size="sm" variant="outline" onClick={() => void limits.refetch()}>{t('workbench.retry')}</Button></div>}
      {tooLarge && <p role="alert" className="text-xs text-destructive">{t('workbench.packageTooLarge', { bytes: file?.size.toLocaleString(), limit: limits.data!.max_archive_bytes.toLocaleString() })}</p>}
      <DialogFooter><Button variant="outline" disabled={restoring.isPending} onClick={() => setFile(null)}>{t('common.cancel')}</Button><Button disabled={restoring.isPending || !canRestore} onClick={() => { if (file && canRestore) restoring.mutate(file) }}>{t('common.confirm')}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
