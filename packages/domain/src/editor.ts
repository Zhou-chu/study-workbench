import type { CreateWorkbenchNoteInput, UpdateWorkbenchNoteInput, WorkbenchNote } from '@study/contracts'
import { freezeValue } from './values.js'
export type EditorModel = Readonly<{
  notebookId: string; noteId: string | null; baseRevision: number | null; revision: number
  title: string; content: string; dirty: boolean; base: Readonly<CreateWorkbenchNoteInput>
  saveResult: 'idle' | 'saving' | 'saved' | 'unknown' | 'conflict' | 'rejected'
  pending: Readonly<{ operationId: string; revision: number; payload: CreateWorkbenchNoteInput | UpdateWorkbenchNoteInput }> | null
}>
export type EditorEvent =
  | { type: 'edit'; title?: string; content?: string }
  | { type: 'begin-save'; operationId: string }
  | { type: 'save-success'; operationId: string; note: WorkbenchNote }
  | { type: 'save-unknown' | 'save-not-sent' | 'save-rejected'; operationId: string }
  | { type: 'save-conflict'; operationId: string; status: 409 | 428 }
function copyDraft(draft: CreateWorkbenchNoteInput): CreateWorkbenchNoteInput { return freezeValue(JSON.parse(JSON.stringify({ title: draft.title, content: draft.content, citations: draft.citations, ...(draft.scope_snapshot !== undefined ? { scope_snapshot: draft.scope_snapshot } : {}) })) as CreateWorkbenchNoteInput) }
export function createEditor(notebookId: string, draft: CreateWorkbenchNoteInput, note?: Pick<WorkbenchNote, 'id' | 'revision'>): EditorModel {
  const base = copyDraft(draft)
  return Object.freeze({ notebookId, noteId: note?.id ?? null, baseRevision: note?.revision ?? null, revision: 0, title: draft.title, content: draft.content, base, dirty: !note && !!(draft.title || draft.content), saveResult: 'idle', pending: null })
}
export function reduceEditor(state: EditorModel, event: EditorEvent): EditorModel {
  const update = (patch: Partial<EditorModel>): EditorModel => Object.freeze({ ...state, ...patch })
  if (event.type === 'edit') {
    const title = event.title ?? state.title; const content = event.content ?? state.content
    return update({ title, content, revision: state.revision + 1, dirty: title !== state.base.title || content !== state.base.content || !state.noteId })
  }
  if (event.type === 'begin-save') {
    if (!event.operationId.trim() || !state.content.trim() || state.pending || ['unknown','conflict','rejected'].includes(state.saveResult) || (state.noteId !== null && state.baseRevision === null)) return state
    const payload = copyDraft({ ...state.base, title: state.title, content: state.content })
    return update({ saveResult: 'saving', pending: freezeValue({ operationId: event.operationId, revision: state.revision, payload: state.noteId ? { ...payload, expected_revision: state.baseRevision! } : payload }) })
  }
  if (!state.pending || state.pending.operationId !== event.operationId) return state
  if (event.type === 'save-success') {
    if (!event.note.id || !Number.isSafeInteger(event.note.revision) || event.note.revision < 1 || (state.noteId !== null && event.note.id !== state.noteId) || (state.baseRevision !== null && event.note.revision <= state.baseRevision)) return update({ saveResult: 'unknown' })
    const payload = state.pending.payload
    const base = copyDraft({ title: event.note.title ?? payload.title, content: event.note.content ?? payload.content, citations: event.note.citations ?? payload.citations, ...(event.note.scope_snapshot ?? payload.scope_snapshot ? { scope_snapshot: event.note.scope_snapshot ?? payload.scope_snapshot } : {}) })
    return update({ noteId: event.note.id, baseRevision: event.note.revision, base, pending: null, saveResult: 'saved', dirty: state.title !== base.title || state.content !== base.content })
  }
  if (event.type === 'save-not-sent') return state.saveResult === 'saving' ? update({ pending: null, saveResult: 'idle' }) : state
  return update({ saveResult: event.type === 'save-conflict' ? 'conflict' : event.type === 'save-rejected' ? 'rejected' : 'unknown' })
}
