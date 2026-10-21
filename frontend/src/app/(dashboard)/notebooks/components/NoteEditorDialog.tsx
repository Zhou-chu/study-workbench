'use client'

import { Controller, useForm, useWatch } from 'react-hook-form'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCreateNote, useUpdateNote, useNote } from '@/lib/hooks/use-notes'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { InlineEdit } from '@/components/common/InlineEdit'
import { cn } from "@/lib/utils";
import { useTranslation } from '@/lib/hooks/use-translation'
import { NoteConflictPanel } from '@/components/common/NoteConflictPanel'
import { noteWriteProblem, type NoteWriteProblem } from '@/lib/utils/note-conflict'
import { notesApi } from '@/lib/api/notes'
import type { NoteResponse } from '@/lib/types/api'
import { ContentUnavailable } from '@/components/common/ContentUnavailable'
import { isNotFoundError } from '@/lib/utils/error-handler'

const createNoteSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1, 'Content is required'),
})

type CreateNoteFormData = z.infer<typeof createNoteSchema>

interface NoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: { id: string; title: string | null; content: string | null }
}

export function NoteEditorDialog({ open, onOpenChange, notebookId, note }: NoteEditorDialogProps) {
  const { t } = useTranslation()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const queryClient = useQueryClient()
  const isEditing = Boolean(note)

  // Ensure note ID has 'note:' prefix for API calls
  const noteIdWithPrefix = note?.id
    ? (note.id.includes(':') ? note.id : `note:${note.id}`)
    : ''

  const {
    data: fetchedNote,
    isLoading: noteLoading,
    isError: noteError,
    error: noteFetchError,
  } = useNote(noteIdWithPrefix, { enabled: open && !!note?.id })
  // When editing, a failed fetch means we must not render the editor: the
  // note may have been deleted (dangling chat/ask references) and offering
  // an empty editor would invite ghost edits.
  const isSaving = updateNote.isPending || createNote.isPending
  const {
    handleSubmit,
    control,
    formState: { errors },
    reset,
    setValue,
  } = useForm<CreateNoteFormData>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: {
      title: '',
      content: '',
    },
  })
  const watchContent = useWatch({ control, name: 'content' })
  const watchTitle = useWatch({ control, name: 'title' })
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)

  const session = useRef(0)
  const generation = useRef(0)
  const initialized = useRef(false)
  const pending = useRef(false)
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const noteUnavailable = isEditing && noteError && baseRevision == null
  const [savedId, setSavedId] = useState<string | null>(null)
  const hasSavedIdentity = isEditing || !!savedId
  const [problem, setProblem] = useState<NoteWriteProblem | null>(null)
  const [candidates, setCandidates] = useState<NoteResponse[] | null>(null)
  const [latest, setLatest] = useState<NoteResponse[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  useEffect(() => {
    session.current++
    initialized.current = false
    setBaseRevision(null); setSavedId(null); setProblem(null); setLatest(null); setCandidates(null); setComparing(false); setReadFailed(false)
    reset({ title: '', content: '' })
  }, [open, notebookId, noteIdWithPrefix, reset])
  useEffect(() => {
    // Summary rows are projections, never editable bodies. Background refresh
    // must not reset a session that already captured its body and predecessor.
    if (!open || initialized.current) return
    if (isEditing) {
      if (!fetchedNote || fetchedNote.id !== noteIdWithPrefix || !Number.isInteger(fetchedNote.revision) || fetchedNote.revision < 1) return
      reset({ title: fetchedNote.title ?? '', content: fetchedNote.content ?? '' })
      setBaseRevision(fetchedNote.revision)
    }
    initialized.current = true
  }, [open, notebookId, isEditing, noteIdWithPrefix, fetchedNote, reset])
  const compareNote = async () => {
    const currentSession = session.current
    setComparing(true); setReadFailed(false)
    try {
      const id = savedId || noteIdWithPrefix
      if (id) {
        const value = await notesApi.get(id)
        if (currentSession === session.current) setLatest([value])
      } else {
        // Listings are projections, not confirmed empty bodies. Inspect a
        // candidate only by explicit selection; never guess the saved identity.
        const summaries = await notesApi.list({ notebook_id: notebookId })
        if (currentSession === session.current) { setCandidates(summaries); setLatest(null) }
      }
    } catch { if (currentSession === session.current) setReadFailed(true) }
    finally { if (currentSession === session.current) setComparing(false) }
  }
  const inspectCandidate = async (id: string) => {
    const currentSession = session.current
    setComparing(true); setReadFailed(false); setLatest(null)
    try {
      const value = await notesApi.get(id)
      if (currentSession === session.current) setLatest([value])
    } catch { if (currentSession === session.current) setReadFailed(true) }
    finally { if (currentSession === session.current) setComparing(false) }
  }
  const reloadNote = () => {
    const value = latest?.[0]
    if (!value || value.id !== (savedId || noteIdWithPrefix)) return
    session.current++
    reset({ title: value.title ?? '', content: value.content ?? '' })
    setBaseRevision(value.revision); setProblem(null); setLatest(null)
  }

  useEffect(() => {
    if (!open) return

    const observer = new MutationObserver(() => {
      setIsEditorFullscreen(!!document.querySelector('.w-md-editor-fullscreen'))
    })
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [open])

  const onSubmit = async (data: CreateNoteFormData) => {
    const id = savedId || noteIdWithPrefix
    if (pending.current || problem || (id && baseRevision == null) || !initialized.current) return
    const currentSession = session.current
    const currentGeneration = generation.current
    pending.current = true
    try {
      const saved = id ? await updateNote.mutateAsync({ id, data: { title: data.title || '', content: data.content, expected_revision: baseRevision! } }) :
        notebookId ? await createNote.mutateAsync({ title: data.title || undefined, content: data.content, note_type: 'human', notebook_id: notebookId }) : null
      if (!saved || currentSession !== session.current) return
      setBaseRevision(saved.revision); setSavedId(saved.id)
      if (notebookId) queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      if (currentGeneration === generation.current) { reset(); onOpenChange(false) }
    } catch (error) {
      if (currentSession === session.current) setProblem(noteWriteProblem(error))
    } finally { pending.current = false }
  }

  const handleClose = () => {
    session.current++
    reset()
    setIsEditorFullscreen(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onEscapeKeyDown={event => {
        // InlineEdit owns Escape while its title input is focused. Radix's
        // capture listener otherwise dismisses the entire dialog first.
        if (event.target instanceof HTMLElement && event.target.id === 'note-title') event.preventDefault()
      }} className={cn(
          "sm:max-w-3xl w-full h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col",
          isEditorFullscreen && "!max-w-screen !max-h-screen border-none w-screen h-screen"
      )}>
        <DialogTitle className="sr-only">
          {hasSavedIdentity ? t('sources.editNote') : t('sources.createNote')}
        </DialogTitle>
        {noteUnavailable ? (
          <ContentUnavailable
            variant={isNotFoundError(noteFetchError) ? 'not-found' : 'error'}
            onClose={handleClose}
          />
        ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 min-h-0 flex-col min-w-0">
          {isEditing && (noteLoading || baseRevision == null) ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
            </div>
          ) : (
            <>
              <div className="border-b px-6 py-4">
                <InlineEdit
                  id="note-title"
                  name="title"
                  value={watchTitle ?? ''}
                  onSave={(value) => { generation.current++; setValue('title', value || '') }}
                  onDraftChange={() => { generation.current++ }}
                  placeholder={t('sources.addTitle')}
                  emptyText={t('sources.untitledNote')}
                  className="text-xl font-semibold"
                  inputClassName="text-xl font-semibold"
                />
              </div>

              <div className={cn(
                  "flex-1 min-h-0 overflow-y-auto",
                  !isEditorFullscreen && "px-6 py-4")
              }>
                <Controller
                  control={control}
                  name="content"
                  render={({ field }) => (
                    <MarkdownEditor
                      key={note?.id ?? 'new'}
                      textareaId="note-content"
                      value={field.value}
                      onChange={value => { generation.current++; field.onChange(value) }}
                      height={420}
                      placeholder={t('sources.writeNotePlaceholder')}
                      className={cn(
                          "w-full h-full min-h-[420px] overflow-hidden [&_.w-md-editor]:!static [&_.w-md-editor]:!w-full [&_.w-md-editor]:!h-full [&_.w-md-editor-content]:overflow-y-auto",
                          !isEditorFullscreen && "rounded-md border"
                      )}
                    />
                  )}
                />
                {errors.content && (
                  <p className="text-sm text-destructive mt-1">{errors.content.message}</p>
                )}
              </div>
            </>
          )}

          {problem && <div className="overflow-y-auto px-6 py-3"><NoteConflictPanel problem={problem} baseRevision={baseRevision} draft={{ title: watchTitle ?? '', content: watchContent }} latest={latest} loading={comparing} readFailed={readFailed} onCompare={compareNote} onReload={savedId || noteIdWithPrefix ? reloadNote : undefined} />{candidates && <section className="mt-3 space-y-2" aria-label={t('noteConflict.candidates')}><h3 className="text-sm font-medium">{t('noteConflict.candidates')}</h3>{candidates.length ? candidates.map(candidate => <Button key={candidate.id} type="button" variant="outline" size="sm" className="block max-w-full truncate" disabled={comparing} aria-label={`${t('noteConflict.inspectCandidate')}: ${candidate.title || t('sources.untitledNote')}`} onClick={() => inspectCandidate(candidate.id)}>{candidate.title || t('sources.untitledNote')}</Button>) : <p className="text-sm text-muted-foreground">{t('noteConflict.notFound')}</p>}</section>}</div>}
          <div className="border-t px-6 py-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !!problem || (isEditing && (noteLoading || baseRevision == null))}
            >
              {isSaving
                ? hasSavedIdentity ? `${t('common.saving')}...` : `${t('common.creating')}...`
                : hasSavedIdentity
                  ? t('sources.saveNote')
                  : t('sources.createNoteBtn')}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
