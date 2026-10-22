'use client'
import Link from 'next/link'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NotebookLMPanel } from '@/components/integrations/NotebookLMPanel'
import type { RemoteLink, WorkbenchSelection } from '@/lib/types/personal'

interface Props {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  selection: WorkbenchSelection
  onSelectionChange: (patch: Partial<WorkbenchSelection>) => void
  link: RemoteLink | null
  onChanged: () => void
  modelStatus: string
  connectionStatus: string
}
export function NotebookSettingsDialog({ notebookId, open, onOpenChange, onCloseAutoFocus, selection, onSelectionChange, link, onChanged, modelStatus, connectionStatus }: Props) {
  const { t } = useTranslation()
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{t('learningWorkspace.notebookSettings')}</DialogTitle><DialogDescription>{t('learningWorkspace.notebookSettingsDescription')}</DialogDescription></DialogHeader>
    <section className="space-y-4 rounded-lg border p-4">
      <div className="space-y-2"><label htmlFor="workbench-engine" className="block text-sm font-medium">{t('workbench.engine')}</label><select id="workbench-engine" className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={selection.engine} onChange={event => onSelectionChange({ engine: event.target.value as WorkbenchSelection['engine'] })}><option value="notebooklm">{t('workbench.notebooklm')}</option><option value="independent">{t('workbench.independent')}</option></select><p className="text-xs leading-5 text-muted-foreground">{t(selection.engine === 'independent' ? modelStatus : connectionStatus)}</p></div>
      <div className="space-y-2"><label htmlFor="workbench-scope" className="block text-sm font-medium">{t('workbench.scope')}</label><select id="workbench-scope" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={selection.selection_origin} onChange={event => onSelectionChange({ selection_origin: event.target.value as 'local' | 'remote' })}><option value="local">{t('workbench.localScope')}</option><option value="remote">{t('workbench.remoteScope')}</option></select><p className="text-xs leading-5 text-muted-foreground">{t('workbench.readingScopeHint')}</p>{selection.selection_origin === 'remote' && <p className="text-xs leading-5 text-muted-foreground">{t('workbench.remoteOriginalWarning')}</p>}</div>
      <Link href="/settings" target="_blank" rel="noopener noreferrer" className="block text-sm text-primary underline underline-offset-4">{t('learningWorkspace.settingsOpenSeparately')}</Link>
    </section>
    <NotebookLMPanel notebookId={notebookId} selectedVersionIds={selection.source_version_ids} remoteSourceIds={selection.remote_source_ids} selectionOrigin={selection.selection_origin} link={link} onRemoteSelection={ids => onSelectionChange({ remote_source_ids: ids })} onChanged={onChanged} />
  </DialogContent></Dialog>
}
