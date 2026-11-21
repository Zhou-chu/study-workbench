'use client'

import { Copy, Edit3, MoreVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/lib/hooks/use-translation'

interface ProfileActionsProps {
  kind: 'episode' | 'speaker'
  name: string
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  duplicatePending: boolean
  deletePending: boolean
  deleteDisabled?: boolean
}

export function ProfileActions({
  kind,
  name,
  onEdit,
  onDuplicate,
  onDelete,
  duplicatePending,
  deletePending,
  deleteDisabled = false,
}: ProfileActionsProps) {
  const { t } = useTranslation()
  const speaker = kind === 'speaker'

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Edit3 className="mr-2 h-4 w-4" /> {t('podcasts.edit')}
      </Button>
      <AlertDialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={speaker ? 'w-48' : 'w-44'}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={onDuplicate} disabled={duplicatePending}>
              <Copy className="h-4 w-4 mr-2" />
              {t('podcasts.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialogTrigger asChild>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={speaker && deleteDisabled}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('podcasts.delete')}
              </DropdownMenuItem>
            </AlertDialogTrigger>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(speaker ? 'podcasts.deleteSpeakerProfileTitle' : 'podcasts.deleteProfileTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(speaker ? 'podcasts.deleteSpeakerProfileDesc' : 'podcasts.deleteProfileDesc', { name })}
            </AlertDialogDescription>
            {speaker && deleteDisabled ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('podcasts.deleteSpeakerDisabledHint')}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={(speaker && deleteDisabled) || deletePending}
            >
              {deletePending ? t('podcasts.deleting') : t('podcasts.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
