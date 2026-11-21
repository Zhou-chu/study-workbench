'use client'

import Link from 'next/link'
import { NotebookResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MoreHorizontal, Archive, ArchiveRestore, Trash2, FileText, StickyNote } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { useState } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'

interface NotebookRowProps {
  notebook: NotebookResponse
}

export function NotebookRow({ notebook }: NotebookRowProps) {
  const { t, language } = useTranslation()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const updateNotebook = useUpdateNotebook()

  const handleArchiveToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived }
    })
  }

  return (
    <>
      <div className="group flex items-center gap-4 rounded-lg border bg-card px-4 py-3 card-hover">
        <Link
          href={`/notebooks/${encodeURIComponent(notebook.id)}/study`}
          aria-label={notebook.name}
          className="flex flex-1 min-w-0 items-center gap-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{notebook.name}</span>
            {notebook.archived && (
              <Badge variant="secondary">
                {t('notebooks.archived')}
              </Badge>
            )}
          </div>
          {notebook.description && (
            <p className="text-sm text-muted-foreground truncate">
              {notebook.description}
            </p>
          )}
          <span className="mt-1 inline-flex text-xs font-medium text-primary group-hover:underline">{t('workbench.open')}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span>{notebook.source_count}</span>
          </span>
          <span className="flex items-center gap-1">
            <StickyNote className="h-3 w-3" />
            <span>{notebook.note_count}</span>
          </span>
        </div>

        <div className="hidden sm:block w-40 shrink-0 text-right text-xs text-muted-foreground">
          {t('common.updated', { time: formatDistanceToNow(new Date(notebook.updated), {
            addSuffix: true,
            locale: getDateLocale(language)
          }) })}
        </div>

        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t('common.actions')}
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={handleArchiveToggle}>
              {notebook.archived ? (
                <>
                  <ArchiveRestore className="h-4 w-4 mr-2" />
                  {t('notebooks.unarchive')}
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-2" />
                  {t('notebooks.archive')}
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteDialog(true)
              }}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
      />
    </>
  )
}
