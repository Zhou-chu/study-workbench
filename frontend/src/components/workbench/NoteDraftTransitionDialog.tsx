'use client'

import type { ComponentProps } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'

export type NoteTransitionKind = 'new' | 'edit' | 'outline'
const titles = { new: 'workbench.noteTransitionNewTitle', edit: 'workbench.noteTransitionEditTitle', outline: 'workbench.noteTransitionOutlineTitle' }

export function NoteDraftTransitionDialog({ kind, onCancel, onConfirm, onCloseAutoFocus }: {
  kind: NoteTransitionKind | null
  onCancel: () => void
  onConfirm: () => void
  onCloseAutoFocus: ComponentProps<typeof AlertDialogContent>['onCloseAutoFocus']
}) {
  const { t } = useTranslation()
  return <AlertDialog open={kind !== null} onOpenChange={open => { if (!open) onCancel() }}>
    <AlertDialogContent data-workbench-controls onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogTitle>{t(titles[kind ?? 'new'])}</AlertDialogTitle>
      <AlertDialogDescription>{t(kind === 'outline' ? 'workbench.noteTransitionOutlineDescription' : 'workbench.noteTransitionReplaceDescription')}</AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>{t(kind === 'outline' ? 'workbench.noteTransitionGenerate' : 'workbench.noteTransitionReplace')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
