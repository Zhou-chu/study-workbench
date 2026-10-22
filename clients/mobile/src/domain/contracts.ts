// Handwritten subset of api/personal_contracts.py, not a generated/complete SDK.
// Opaque records and extensions deliberately remain unknown. Never default missing fields.
export type Opaque = { [key: string]: unknown };
export interface WorkspaceNote extends Opaque { id: string; revision: number; title?: string | null; content?: string | null }
export interface Workspace extends Opaque {
  notebook: Opaque & { id: string; name: string };
  sources: (Opaque & { source_id: string; title: string | null; versions: Opaque[] })[];
  notes: WorkspaceNote[];
  turns: Opaque[]; jobs: Opaque[]; link: Opaque | null; selection: Opaque | null; legacy_history: Opaque[];
}
export interface PersonalNote extends WorkspaceNote {
  note_id: string; notebook_id: string; content: string; created_at: string; updated_at: string;
  citations: Opaque[]; scope_snapshot: Opaque;
}
export interface Receipt extends Opaque { job_id: string; turn_id: string; state: string }
export interface Job extends Opaque { job_id: string; state: string }
// Mirrors TurnRequest fields; key supplied separately by the local repository method.
export interface OutlineRequest {
  notebook_id: string; engine: 'independent' | 'notebooklm'; message: string; task: 'outline';
  selection_origin?: 'local' | 'remote'; source_version_ids?: string[];
  remote_notebook_id?: string | null; remote_source_ids?: string[]; model_id?: string | null;
}
export type SaveResult =
  | {kind: 'saved'; note: PersonalNote; message: string}
  | {kind: 'conflict'; detail: {code: 'NOTE_REVISION_CONFLICT'; current_revision: number}}
  | {kind: 'unknown' | 'error'};
export type SubmissionResult = {kind:'receipt';receipt:Receipt;message:string} | {kind:'unknown' | 'error'};
// For JSON-shaped contract data; recursive copy preserves absent versus explicit null.
export function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => copy(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,copy(item)])) as T;
  }
  return value;
}
