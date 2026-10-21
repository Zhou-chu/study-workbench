'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { portableApi } from '@/lib/api/portable'
import { useTranslation } from '@/lib/hooks/use-translation'
import { requestError } from '@/lib/utils/workbench'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function PortableControls({ notebookId, onChanged }: { notebookId: string; onChanged: () => void }) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const exporting = useMutation({ mutationFn: () => portableApi.export(notebookId), retry: false, onSuccess: onChanged })
  const restoring = useMutation({ mutationFn: (packageFile: File) => portableApi.restore(packageFile), retry: false, onSuccess: () => { setFile(null); onChanged() } })
  return <div className="relative max-w-sm space-y-2">
    <details className="group"><summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{t('workbench.exportDetails')}</summary><div className="mt-2 space-y-2 rounded-md border bg-card p-3">
    <div className="flex flex-wrap gap-2 items-center"><Button size="sm" variant="outline" disabled={exporting.isPending} onClick={() => exporting.mutate()}>{t('workbench.exportProject')}</Button>
      <label className="relative cursor-pointer rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring">{t('workbench.restoreProject')}<input className="sr-only" type="file" accept=".zip,application/zip" disabled={restoring.isPending} onChange={event => { setFile(event.target.files?.[0] || null); event.target.value = '' }} /></label>
    </div>
    <p className="text-xs text-muted-foreground">{t('workbench.exportCoverage')}</p></div></details>
    {(exporting.isPending || restoring.isPending) && <p role="status" className="text-xs">{t('common.processing')}</p>}
    {exporting.data && <p className="max-w-48 truncate text-xs text-muted-foreground" title={exporting.data.job_id}>{t('workbench.jobs')}: {exporting.data.job_id}</p>}
    {(exporting.isError || restoring.isError) && <p role="alert" className="text-xs text-destructive">{requestError(exporting.error || restoring.error) || t('workbench.error')}</p>}
    {restoring.data?.notebook_id && <Link className="text-sm text-primary hover:underline" href={`/notebooks/${encodeURIComponent(restoring.data.notebook_id)}/study`}>{t('workbench.restoredNotebook')}</Link>}
    <Dialog open={!!file} onOpenChange={open => { if (!open && !restoring.isPending) setFile(null) }}><DialogContent><DialogHeader><DialogTitle>{t('workbench.restoreProject')}</DialogTitle><DialogDescription>{t('workbench.restoreConfirm')}</DialogDescription></DialogHeader><p className="text-sm break-all">{file?.name}</p><p className="text-xs text-muted-foreground">{t('workbench.packageSize', { bytes: file?.size.toLocaleString() })}</p><DialogFooter><Button variant="outline" disabled={restoring.isPending} onClick={() => setFile(null)}>{t('common.cancel')}</Button><Button disabled={restoring.isPending} onClick={() => { if (file) restoring.mutate(file) }}>{t('common.confirm')}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
