'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { portableApi } from '@/lib/api/portable'
import { usePortableLimits } from '@/lib/hooks/use-portable-limits'
import { useTranslation } from '@/lib/hooks/use-translation'
import { requestError } from '@/lib/utils/workbench'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function PortableControls({ notebookId, onChanged }: { notebookId: string; onChanged: () => void }) {
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
  const exporting = useMutation({ mutationFn: () => portableApi.export(notebookId), retry: false, onSuccess: onChanged })
  const restoring = useMutation({ mutationFn: (packageFile: File) => portableApi.restore(packageFile), retry: false, onSuccess: () => { setFile(null); onChanged() } })
  return <div className="relative max-w-sm space-y-2">
    <details className="group"><summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{t('workbench.exportDetails')}</summary><div className="mt-2 space-y-2 rounded-md border bg-card p-3">
    <div className="flex flex-wrap gap-2 items-center"><Button size="sm" variant="outline" disabled={exporting.isPending} onClick={() => exporting.mutate()}>{t('workbench.exportProject')}</Button>
      <label className="relative cursor-pointer rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">{t('workbench.restoreProject')}<input className="sr-only" type="file" accept=".zip,application/zip" disabled={restoring.isPending} onChange={event => { setFile(event.target.files?.[0] || null); event.target.value = '' }} /></label>
    </div>
    <p className="text-xs text-muted-foreground">{t('workbench.exportCoverage')}</p><p className="text-xs text-muted-foreground">{t('workbench.portableLimitsHint')}</p></div></details>
    {(exporting.isPending || restoring.isPending) && <p role="status" className="text-xs">{t('common.processing')}</p>}
    {exporting.data && <p className="max-w-48 truncate text-xs text-muted-foreground" title={exporting.data.job_id}>{t('workbench.jobs')}: {exporting.data.job_id}</p>}
    {(exporting.isError || restoring.isError) && <p role="alert" className="text-xs text-destructive">{requestError(exporting.error || restoring.error) || t('workbench.error')}</p>}
    {restoring.data?.notebook_id && <Link className="text-sm text-primary hover:underline" href={`/notebooks/${encodeURIComponent(restoring.data.notebook_id)}/study`}>{t('workbench.restoredNotebook')}</Link>}
    <Dialog open={!!file} onOpenChange={open => { if (!open && !restoring.isPending) setFile(null) }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{t('workbench.restoreProject')}</DialogTitle><DialogDescription>{t('workbench.restoreConfirm')}</DialogDescription></DialogHeader><p className="text-sm break-all">{file?.name}</p><p className="text-xs text-muted-foreground">{t('workbench.packageSize', { bytes: file?.size.toLocaleString() })}</p>{limits.isFetching && <p role="status" className="text-xs">{t('workbench.portableLimitsLoading')}</p>}
      {limitsFailed && <div><p role="alert" className="text-xs text-destructive">{t('workbench.portableLimitsError')}</p><Button size="sm" variant="outline" onClick={() => void limits.refetch()}>{t('workbench.retry')}</Button></div>}
      {tooLarge && <p role="alert" className="text-xs text-destructive">{t('workbench.packageTooLarge', { bytes: file?.size.toLocaleString(), limit: limits.data!.max_archive_bytes.toLocaleString() })}</p>}
      <DialogFooter><Button variant="outline" disabled={restoring.isPending} onClick={() => setFile(null)}>{t('common.cancel')}</Button><Button disabled={restoring.isPending || !canRestore} onClick={() => { if (file && canRestore) restoring.mutate(file) }}>{t('common.confirm')}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
