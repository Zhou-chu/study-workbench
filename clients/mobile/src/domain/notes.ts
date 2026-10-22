import type { SaveResult, WorkspaceNote } from './contracts.ts';
export interface SaveAttempt { noteId:string; serial:number; content:string; expectedRevision:number }
export interface NoteDraft {
  noteId:string; content:string | null | undefined; expectedRevision:number; serial:number;
  status:'clean'|'dirty'|'saving'|'saved'|'conflict'|'unknown'|'error';
  pending?:SaveAttempt; outcome?:SaveResult;
}
export function openDraft(note:WorkspaceNote):NoteDraft {
  return {noteId:note.id,content:note.content,expectedRevision:note.revision,serial:0,status:'clean'};
}
export function editDraft(draft:NoteDraft,content:string):NoteDraft {
  return {...draft,content,status:draft.pending ? 'saving' : draft.status === 'unknown' ? 'unknown' : 'dirty'};
}
export function beginSave(draft:NoteDraft):{draft:NoteDraft;attempt:SaveAttempt|null} {
  if (draft.pending || draft.status === 'unknown' || typeof draft.content !== 'string') return {draft,attempt:null};
  const attempt = {noteId:draft.noteId,serial:draft.serial+1,content:draft.content,expectedRevision:draft.expectedRevision};
  return {draft:{...draft,serial:attempt.serial,pending:attempt,status:'saving'},attempt};
}
export function finishSave(draft:NoteDraft,attempt:SaveAttempt,result:SaveResult):NoteDraft {
  // Attempts are in-memory capability objects. Serial/note IDs are not ownership:
  // a reopened or reset editor can have the same values but never the same object.
  // UI callbacks must retain the exact attempt returned by beginSave.
  if (draft.noteId !== attempt.noteId || draft.pending !== attempt) return draft;
  const {pending:_,...rest} = draft;
  if (result.kind !== 'saved') return {...rest,status:result.kind,outcome:result};
  if (result.note.id !== draft.noteId) return {...rest,status:'unknown',outcome:{kind:'unknown'}};
  return {...rest,expectedRevision:result.note.revision,status:draft.content === attempt.content ? 'saved' : 'dirty',outcome:result};
}
