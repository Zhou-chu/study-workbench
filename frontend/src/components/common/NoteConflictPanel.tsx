'use client'
import { useState } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { noteProblemKeys, type NoteWriteProblem } from '@/lib/utils/note-conflict'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'

export interface NoteComparison { title: string | null; content: string | null; revision?: number; citations?: unknown[]; scope_snapshot?: unknown }
export function NoteConflictPanel({ problem, baseRevision, draft, latest, loading, readFailed, onCompare, onReload }: {
  problem: NoteWriteProblem; baseRevision: number | null; draft: NoteComparison; latest: NoteComparison[] | null
  loading: boolean; readFailed: boolean; onCompare: () => void; onReload?: () => void
}) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  const snapshot = (value: NoteComparison) => <><h4 className="font-medium break-words">{value.title}</h4><p className="whitespace-pre-wrap break-words text-sm">{value.content}</p>{value.revision != null && <p className="text-xs text-muted-foreground">{t('noteConflict.serverRevision')}: {value.revision}</p>}{(value.citations || value.scope_snapshot) && <details className="text-xs"><summary>{t('noteConflict.references')}</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({ citations: value.citations, scope: value.scope_snapshot }, null, 2)}</pre></details>}</>
  return <section className="space-y-3 rounded-md border p-3" aria-label={t('noteConflict.review')}>
    <p role="alert" className="text-sm text-muted-foreground">{t(noteProblemKeys[problem.kind])}</p>
    {baseRevision != null && <p className="text-xs text-muted-foreground">{t('noteConflict.baseRevision')}: {baseRevision}{problem.currentRevision != null && <> · {t('noteConflict.serverRevision')}: {problem.currentRevision}</>}</p>}
    <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onCompare}>{t(loading ? 'common.loading' : 'noteConflict.compare')}</Button>
    {readFailed && <p role="alert" className="text-sm">{t('noteConflict.readFailed')}</p>}
    {latest && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-2"><h3 className="text-xs text-muted-foreground">{t('noteConflict.yourDraft')}</h3>{snapshot(draft)}</div><div className="min-w-0 space-y-2"><h3 className="text-xs text-muted-foreground">{t('noteConflict.latest')}</h3>{latest.length ? latest.map((value, index) => <div key={index} className="space-y-2">{snapshot(value)}</div>) : <p className="text-sm">{t('noteConflict.notFound')}</p>}</div></div>}
    {latest?.length === 1 && onReload && <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(true)}>{t('noteConflict.reload')}</Button>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogTitle>{t('noteConflict.discardTitle')}</AlertDialogTitle><AlertDialogDescription>{t('noteConflict.discardDescription')}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={onReload}>{t('noteConflict.discard')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
