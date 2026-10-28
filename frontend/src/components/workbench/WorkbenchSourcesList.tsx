'use client'
import Link from 'next/link'
import { FileText, Globe2, StickyNote } from 'lucide-react'
import type { Workspace } from '@/lib/types/personal'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { SourceProvenance } from '@/components/evidence/SourceProvenance'
import { projectWorkbenchVersion } from '@/lib/utils/workbench-read-model'
import { stateKeys } from '@/lib/utils/workbench'
import { cn } from '@/lib/utils'

interface Props {
  notebookId: string
  sources: Workspace['sources']
  selectedVersionIds: string[]
  onSelectionChange: (ids: string[]) => void
  onRead: (id: string) => void
  onUpload: (files: FileList | null, sourceId: string) => void
}
export function WorkbenchSourcesList({ notebookId, sources, selectedVersionIds, onSelectionChange, onRead, onUpload }: Props) {
  const { t } = useTranslation()
  const statusLabel = (status: string | null) => t(status && Object.hasOwn(stateKeys, status) ? stateKeys[status] : 'workbench.unavailable')
  return <div className="divide-y">{sources.map(source => {
    const versions = source.versions.map(projectWorkbenchVersion)
    const Icon = versions.some(version => version.origin === 'derived_snapshot') ? StickyNote : versions.some(version => version.origin === 'web_snapshot') ? Globe2 : FileText
    return <article className="space-y-3 py-4 first:pt-1" key={source.source_id}>
      <h3 className="flex items-start gap-2 text-sm font-medium leading-5"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{source.title}</span></h3>
      {!versions.length && <div className="space-y-1"><p className="text-xs leading-5 text-muted-foreground">{t('learningWorkspace.noVersion')}</p><Link href={`/notebooks/${encodeURIComponent(notebookId)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">{t('learningWorkspace.classicNotebook')}</Link></div>}
      <div className="space-y-2">{versions.map((version, index) => <div key={`${version.source_version_id ?? 'missing'}:${index}`} className={cn('space-y-2 rounded-md border p-2.5', version.source_version_id !== null && selectedVersionIds.includes(version.source_version_id) ? 'border-primary/30 bg-muted' : 'border-transparent')}>
        <div className="flex items-center gap-2"><label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-xs"><input className="size-3.5 shrink-0 accent-primary" aria-label={`${source.title ?? t('workbench.unavailable')} · ${version.source_version_id ?? t('workbench.unavailable')}`} type="checkbox" disabled={!version.source_version_id} checked={version.source_version_id !== null && selectedVersionIds.includes(version.source_version_id)} onChange={event => version.source_version_id && onSelectionChange(event.target.checked ? [...selectedVersionIds, version.source_version_id] : selectedVersionIds.filter(id => id !== version.source_version_id))} />{version.created_at ? <time dateTime={version.created_at}>{version.created_at.slice(0, 10)}</time> : <span>{t('workbench.unavailable')}</span>}</label><Button size="sm" variant="ghost" disabled={!version.source_version_id} onClick={() => { if (version.source_version_id) onRead(version.source_version_id) }}>{t('workbench.read')}</Button></div>
        <p className="text-xs text-muted-foreground">{statusLabel(version.status || version.extraction_status)}</p>
        {version.provenance != null && <SourceProvenance provenance={version.provenance} compact />}
        {version.original_status !== 'available' && <p className="text-xs leading-5 text-muted-foreground">{t('workbench.originalMissing')}</p>}
      </div>)}</div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer rounded-sm py-1 focus-visible:ring-2 focus-visible:ring-ring">{t('learningWorkspace.sourceDetails')}</summary><div className="space-y-2 pt-2">{versions.map((version, index) => <p key={`${version.source_version_id ?? 'missing'}:${index}`} className="truncate" title={version.source_version_id ?? undefined}>{version.source_version_id ?? t('workbench.unavailable')}</p>)}<label className="relative block cursor-pointer rounded-sm py-1 text-primary focus-within:ring-2 focus-within:ring-ring">{t('workbench.uploadVersion')}<input className="sr-only" type="file" accept=".pdf,.md,.markdown,.txt" onChange={event => { onUpload(event.target.files, source.source_id); event.target.value = '' }} /></label></div></details>
    </article>
  })}</div>
}
