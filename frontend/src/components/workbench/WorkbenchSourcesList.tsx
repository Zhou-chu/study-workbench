'use client'
import Link from 'next/link'
import { FileText, Globe2, StickyNote } from 'lucide-react'
import type { Workspace } from '@/lib/types/personal'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { SourceProvenance } from '@/components/evidence/SourceProvenance'
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
  return <div className="divide-y">{sources.map(source => {
    const Icon = source.versions.some(version => version.origin === 'derived_snapshot') ? StickyNote : source.versions.some(version => version.origin === 'web_snapshot') ? Globe2 : FileText
    return <article className="space-y-3 py-4 first:pt-1" key={source.source_id}>
      <h3 className="flex items-start gap-2 text-sm font-medium leading-5"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-words">{source.title}</span></h3>
      {!source.versions.length && <div className="space-y-1"><p className="text-xs leading-5 text-muted-foreground">{t('learningWorkspace.noVersion')}</p><Link href={`/notebooks/${encodeURIComponent(notebookId)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">{t('learningWorkspace.classicNotebook')}</Link></div>}
      <div className="space-y-2">{source.versions.map(version => <div key={version.source_version_id} className={cn('space-y-2 rounded-md border p-2.5', selectedVersionIds.includes(version.source_version_id) ? 'border-primary/30 bg-muted' : 'border-transparent')}>
        <div className="flex items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-xs"><input className="size-3.5 shrink-0 accent-primary" aria-label={`${source.title} · ${version.source_version_id}`} type="checkbox" checked={selectedVersionIds.includes(version.source_version_id)} onChange={event => onSelectionChange(event.target.checked ? [...selectedVersionIds, version.source_version_id] : selectedVersionIds.filter(id => id !== version.source_version_id))} /><time dateTime={version.created_at}>{version.created_at.slice(0, 10)}</time></label><Button size="sm" variant="ghost" onClick={() => onRead(version.source_version_id)}>{t('workbench.read')}</Button></div>
        <p className="text-xs text-muted-foreground">{t(stateKeys[version.status || version.extraction_status || 'pending'] || 'workbench.unavailable')}</p>
        {version.provenance && <SourceProvenance provenance={version.provenance} compact />}
        {version.original_status !== 'available' && <p className="text-xs leading-5 text-muted-foreground">{t('workbench.originalMissing')}</p>}
      </div>)}</div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer rounded-sm py-1 focus-visible:ring-2 focus-visible:ring-ring">{t('learningWorkspace.sourceDetails')}</summary><div className="space-y-2 pt-2">{source.versions.map(version => <p key={version.source_version_id} className="truncate" title={version.source_version_id}>{version.source_version_id}</p>)}<label className="relative block cursor-pointer rounded-sm py-1 text-primary focus-within:ring-2 focus-within:ring-ring">{t('workbench.uploadVersion')}<input className="sr-only" type="file" accept=".pdf,.md,.markdown,.txt" onChange={event => { onUpload(event.target.files, source.source_id); event.target.value = '' }} /></label></div></details>
    </article>
  })}</div>
}
