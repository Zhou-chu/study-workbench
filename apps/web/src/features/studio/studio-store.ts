import type { LibrarySource } from '../../data/library-api';
import type { NativeSession } from '../../data/native-chat';
import type { OutlineOrigin } from '../chat/ConversationPanel';
import { createEditor, reduceEditor, createOperation, reduceOperation, canDispatch, sameTurnTarget, freezeDispatchContext, type EditorModel, type OperationModel, type OperationToken, type DispatchContext } from '@study/domain';
import type { CreateWorkbenchNoteInput, WorkbenchNote, SnapshotOrigin, SourceSnapshotResult, TurnView } from '@study/contracts';
import { noteForEditor, parseCitation, parseScope, type StudioJob, type AudioRequest, type PortableImport } from '../../data/studio-api';
function freezeValue<T>(value: T): Readonly<T> {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezeValue);
        Object.freeze(value);
    }
    return value;
}
export type SaveOutcome = {
    kind: 'saved';
    note: WorkbenchNote;
} | {
    kind: 'conflict';
    status: 409 | 428;
} | {
    kind: 'unknown' | 'not-sent' | 'rejected';
};
export type ClassicUpdate = Readonly<{
    title?: string;
    content?: string;
    expected_revision: number;
}>;
export type ClassicDraft = Readonly<{
    base?: WorkbenchNote;
    edits: Readonly<{
        title?: number;
        content?: number;
    }>;
    pending?: Readonly<{
        patch?: ClassicUpdate;
        edits: Readonly<{
            title?: number;
            content?: number;
        }>;
    }>;
}>;
export type NoteSession = Readonly<{
    id: string;
    notebookId: string;
    context: DispatchContext;
    generation: number;
    editor: EditorModel;
    operation: OperationModel;
    retired: boolean;
    mode: 'personal' | 'classic';
    noteType: string | null;
    omitClassicTitle?: boolean;
    classic?: ClassicDraft;
    latest?: WorkbenchNote | undefined;
    comparison?: readonly WorkbenchNote[] | undefined;
    history: readonly {
        editor: EditorModel;
        operation: OperationModel;
        classic?: ClassicDraft;
        latest?: WorkbenchNote;
        comparison?: readonly WorkbenchNote[];
    }[];
    originKey?: string;
    outlineOrigin?: OutlineOrigin;
}>;
/** Compare JSON metadata without changing array order, null, or absent fields. */
function canonical(value: unknown): unknown { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value; }
const optionalCitationNullFields = new Set(['remote_reference', 'independent_support', 'provenance', 'reason']);
/** F43: comparison-only equivalence for these top-level fields, never nested metadata or wire data. */
function comparableCitations(citations: WorkbenchNote['citations']): unknown {
    return citations?.map(citation => Object.fromEntries(Object.entries(citation).filter(([key, value]) => value !== null || !optionalCitationNullFields.has(key))));
}
export function compatibleNoteMetadata(row: NoteSession): boolean {
    if (!row.latest)
        return false;
    if (row.mode === 'classic')
        return row.latest.citations === undefined && row.latest.scope_snapshot === undefined;
    return JSON.stringify(canonical({ citations: comparableCitations(row.editor.base.citations), scope_snapshot: row.editor.base.scope_snapshot })) === JSON.stringify(canonical({ citations: comparableCitations(row.latest.citations), scope_snapshot: row.latest.scope_snapshot }));
}
export type NoteReadToken = Readonly<{
    id: string;
    operationToken: OperationToken;
    context: DispatchContext;
    generation: number;
    ticket: number;
}>;
/** Memory-only admission identity; not a remote request field or provider capability. */
export type RemoteTargetAdmission = Readonly<{
    ownerId: string;
    revision: number;
}>;
export type StudioPayload = {
    kind: 'export';
} | {
    kind: 'import';
    file: File;
} | {
    kind: 'audio';
    request: Omit<AudioRequest, 'idempotency_key'>;
    providerRevision: number;
    targetAdmission: RemoteTargetAdmission;
} | {
    kind: 'download';
    remoteNotebookId: string;
    remoteArtifactId: string;
    providerRevision: number;
    targetAdmission: RemoteTargetAdmission;
} | {
    kind: 'promote';
    origin: SnapshotOrigin;
} | {
    kind: 'delete';
    noteId: string;
};
export type StudioOutcome = {
    kind: 'job';
    job: StudioJob;
} | {
    kind: 'imported';
    result: PortableImport;
} | {
    kind: 'promoted';
    result: SourceSnapshotResult;
} | {
    kind: 'succeeded' | 'unknown' | 'not-sent' | 'rejected';
};
export type StudioOperation = Readonly<{
    id: string;
    notebookId: string;
    payload: StudioPayload;
    operation: OperationModel;
    retired: boolean;
    busy: boolean;
    job?: StudioJob;
    imported?: PortableImport;
    promoted?: SourceSnapshotResult;
}>;
function jobMatches(row: StudioOperation, job: StudioJob): boolean {
    const operation = row.payload.kind === 'export' ? 'portable_export' : row.payload.kind;
    return job.notebookId === row.notebookId && job.operation === operation && job.idempotencyKey === row.id && (!row.job || row.job.jobId === job.jobId);
}
/** Exact receipts can reconcile an observation error; they never authorize replay. */
function applyJobReceipt(row: StudioOperation, token: OperationToken, job: StudioJob): OperationModel {
    let operation = reduceOperation(row.operation, { type: 'accepted', token, receipt: { job_id: job.jobId, state: job.state } });
    if (operation.state !== 'accepted')
        return operation;
    if (job.state === 'cancelled_local')
        return reduceOperation(operation, { type: 'stop-waiting' });
    if (job.submissionState === 'unknown' || job.remoteMayContinue)
        return reduceOperation(operation, { type: 'unknown', token });
    if (job.state === 'succeeded' || job.state === 'failed')
        return reduceOperation(operation, { type: job.state, token });
    if (job.state === 'running' || job.state === 'waiting_remote')
        return reduceOperation(operation, { type: 'running', token });
    return job.state === 'queued' ? operation : reduceOperation(operation, { type: 'unknown', token });
}
export function createStudioStore(onChange: () => void) {
    const notes = new Map<string, NoteSession>(), ops = new Map<string, StudioOperation>(), active = new Map<string, string>(), retired = new Set<number>();
    const listeners = new Set<() => void>();
    const comparisons = new Map<string, NoteReadToken>();
    let readSequence = 0;
    let snapshot: Readonly<{
        notes: readonly NoteSession[];
        operations: readonly StudioOperation[];
        active: ReadonlyMap<string, string>;
    }> = Object.freeze({ notes: [], operations: [], active: new Map() });
    const emit = () => { snapshot = Object.freeze({ notes: Object.freeze([...notes.values()]), operations: Object.freeze([...ops.values()]), active: new Map(active) }); listeners.forEach(fn => fn()); onChange(); };
    const sameOwner = (a: DispatchContext, b: DispatchContext) => a.epoch === b.epoch && sameTurnTarget(a.target, b.target);
    const deletions = (noteId: string, context: DispatchContext) => [...ops.values()].filter(r => r.payload.kind === 'delete' && r.payload.noteId === noteId && sameOwner(r.operation.context, context));
    const deleted = (noteId: string, context: DispatchContext) => deletions(noteId, context).some(r => r.operation.state === 'succeeded');
    const noteMutationBlocked = (noteId: string | null | undefined, context: DispatchContext) => !!noteId && deletions(noteId, context).some(r => ['submitting', 'unknown', 'succeeded'].includes(r.operation.state));
    // Editor lifetime is the privacy scope, not a request generation. Every
    // fresh request below captures its own generation; completions keep theirs.
    const current = (row: NoteSession, c: DispatchContext | null) => !row.retired && canDispatch(row.context, c);
    const immutable = (row: NoteSession) => { notes.set(row.id, Object.freeze(row)); emit(); };
    const open = (notebookId: string, draft: CreateWorkbenchNoteInput, context: DispatchContext, generation: number, note?: WorkbenchNote, mode: 'personal' | 'classic' = 'personal', noteType: string | null = 'human', originKey?: string, outlineOrigin?: OutlineOrigin) => {
        const existing = [...notes.values()].find(n => n.notebookId === notebookId && sameOwner(n.context, context) && ((originKey && n.originKey === originKey) || (note && n.editor.noteId === note.id)));
        if (existing)
            return existing.id;
        const id = crypto.randomUUID();
        immutable({ id, notebookId, context: freezeDispatchContext(context), generation, editor: createEditor(notebookId, draft, note), operation: createOperation(context, crypto.randomUUID(), { serverIdempotency: false, sessionGeneration: generation }), retired: retired.has(context.epoch) || !!note && deleted(note.id, context), mode, noteType, ...(mode === 'classic' ? { classic: freezeValue({ ...(note ? { base: structuredClone(note) } : {}), edits: {} }) } : {}), history: [], ...(originKey ? { originKey } : {}), ...(outlineOrigin ? { outlineOrigin: freezeValue(structuredClone(outlineOrigin)) } : {}) });
        return id;
    };
    return {
        get: (id: string) => notes.get(id), getOperation: (id: string) => ops.get(id), getSnapshot: () => snapshot, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, open, noteMutationBlocked,
        select(notebookId: string, id: string | null) {
            if (id && notes.get(id)?.notebookId !== notebookId)
                return;
            if (id)
                active.set(notebookId, id);
            else
                active.delete(notebookId);
            emit();
        },
        discardNote(id: string, expected: NoteSession, c: DispatchContext | null, _g: number) {
            const r = notes.get(id);
            if (!r || r !== expected || !current(r, c) || r.editor.pending || !['idle', 'saved'].includes(r.editor.saveResult))
                return false;
            notes.delete(id);
            if (active.get(r.notebookId) === id)
                active.delete(r.notebookId);
            comparisons.delete(id);
            emit();
            return true;
        },
        captureSourceMessage(notebookId: string, source: LibrarySource, session: NativeSession, content: string, context: DispatchContext, generation: number, originKey: string) {
            if (session.source_id !== source.id || !source.notebooks?.includes(notebookId) || !content.trim() || !session.id || !context.ready)
                return null;
            const id = open(notebookId, { title: '', content, citations: [] }, context, generation, undefined, 'classic', 'ai', originKey);
            const row = notes.get(id)!;
            if (!row.omitClassicTitle)
                immutable({ ...row, omitClassicTitle: true });
            return id;
        },
        captureClassicMessage(notebookId: string, session: NativeSession, content: string, context: DispatchContext, generation: number, originKey: string) {
            if (session.notebook_id !== notebookId || !content.trim() || !session.id || !context.ready)
                return null;
            const id = open(notebookId, { title: '', content, citations: [] }, context, generation, undefined, 'classic', 'ai', originKey);
            const row = notes.get(id)!;
            if (!row.omitClassicTitle)
                immutable({ ...row, omitClassicTitle: true });
            return id;
        },
        captureTurn(notebookId: string, turn: TurnView, context: DispatchContext, generation: number, originKey: string, outlineOrigin?: OutlineOrigin) {
            try {
                if (outlineOrigin && (outlineOrigin.notebookId !== notebookId || outlineOrigin.turnId !== turn.turn_id || !outlineOrigin.operationId || !outlineOrigin.sessionId || !outlineOrigin.owner.mountId))
                    return null;
                if (turn.projection_status || turn.notebook_id !== notebookId || turn.status !== 'succeeded' || typeof turn.turn_id !== 'string' || !turn.turn_id || typeof turn.answer !== 'string' || !turn.answer.trim() || !Array.isArray(turn.citations))
                    return null;
                const draft = { title: typeof turn.message === 'string' ? turn.message.slice(0, 500) : '', content: turn.answer, citations: turn.citations.map(v => parseCitation(v)), scope_snapshot: parseScope(turn.scope_snapshot) };
                return open(notebookId, draft, context, generation, undefined, 'personal', 'human', originKey, outlineOrigin);
            }
            catch {
                return null;
            }
        },
        edit(id: string, patch: {
            title?: string;
            content?: string;
        }) {
            const r = notes.get(id);
            if (!r || r.retired || noteMutationBlocked(r.editor.noteId, r.context))
                return;
            const editor = reduceEditor(r.editor, { type: 'edit', ...patch });
            const classic = r.classic ? freezeValue({ ...r.classic, edits: { ...r.classic.edits, ...(patch.title !== undefined ? { title: (r.classic.edits.title ?? 0) + 1 } : {}), ...(patch.content !== undefined ? { content: (r.classic.edits.content ?? 0) + 1 } : {}) } }) : undefined;
            immutable({ ...r, editor: classic ? Object.freeze({ ...editor, dirty: Object.keys(classic.edits).length > 0 }) : editor, ...(classic ? { classic } : {}) });
        },
        beginSave(id: string, c: DispatchContext | null, g: number) {
            const r = notes.get(id);
            if (!r || !c || !current(r, c) || noteMutationBlocked(r.editor.noteId, r.context))
                return null;
            const key = crypto.randomUUID();
            let classic = r.classic;
            let editor: EditorModel;
            if (classic && r.editor.noteId) {
                if (!Object.keys(classic.edits).length || r.editor.pending || ['unknown', 'conflict', 'rejected'].includes(r.editor.saveResult) || !r.editor.baseRevision)
                    return null;
                const patch: ClassicUpdate = { ...(classic.edits.title !== undefined ? { title: r.editor.title } : {}), ...(classic.edits.content !== undefined ? { content: r.editor.content } : {}), expected_revision: r.editor.baseRevision };
                classic = freezeValue({ ...classic, pending: { patch, edits: classic.edits } });
                editor = freezeValue({ ...r.editor, saveResult: 'saving' as const, pending: { operationId: key, revision: r.editor.revision, payload: { ...r.editor.base, title: r.editor.title, content: r.editor.content, expected_revision: r.editor.baseRevision } } });
            }
            else {
                editor = reduceEditor(r.editor, { type: 'begin-save', operationId: key });
                if (editor === r.editor)
                    return null;
                if (classic)
                    classic = freezeValue({ ...classic, pending: { edits: classic.edits } });
            }
            const operation = reduceOperation(createOperation(r.context, key, { serverIdempotency: false, sessionGeneration: g }), { type: 'begin', context: c, sessionGeneration: g });
            if (!operation.token)
                return null;
            const next = Object.freeze({ ...r, editor, operation, ...(classic ? { classic } : {}) });
            immutable(next);
            return next;
        },
        settleSave(id: string, token: OperationToken, outcome: SaveOutcome, c: DispatchContext | null, g: number) {
            const r = notes.get(id);
            if (!r || r.operation.token !== token || r.editor.saveResult !== 'saving')
                return;
            const result = current(r, c) && token.sessionGeneration === g ? outcome : { kind: 'unknown' as const };
            const operationId = token.operationKey;
            let editor = reduceEditor(r.editor, result.kind === 'saved' ? { type: 'save-success', operationId, note: r.classic ? { ...result.note, title: result.note.title ?? '', content: result.note.content ?? '' } : result.note } : result.kind === 'conflict' ? { type: 'save-conflict', operationId, status: result.status } : { type: result.kind === 'not-sent' ? 'save-not-sent' : result.kind === 'rejected' ? 'save-rejected' : 'save-unknown', operationId });
            const operation = reduceOperation(r.operation, { type: editor.saveResult === 'unknown' ? 'unknown' : result.kind === 'saved' ? 'succeeded' : result.kind === 'not-sent' ? 'not-sent' : result.kind === 'unknown' ? 'unknown' : 'failed', token });
            let classic = r.classic;
            if (classic && result.kind === 'saved' && editor.saveResult === 'saved') {
                const edits: {
                    title?: number;
                    content?: number;
                } = {};
                for (const field of ['title', 'content'] as const) {
                    const version = classic.edits[field];
                    if (version !== undefined && version !== classic.pending?.edits[field])
                        edits[field] = version;
                }
                classic = freezeValue({ base: structuredClone(result.note), edits });
                editor = Object.freeze({ ...editor, dirty: Object.keys(edits).length > 0 });
            }
            else if (classic && result.kind === 'not-sent') {
                classic = freezeValue({ ...classic, edits: classic.edits });
                const { pending: _pending, ...remaining } = classic;
                void _pending;
                classic = remaining;
            }
            immutable({ ...r, editor, operation, ...(classic ? { classic } : {}) });
        },
        beginCompare(id: string, c: DispatchContext | null, g: number): NoteReadToken | null {
            const r = notes.get(id);
            if (!r || !current(r, c) || !r.operation.token || !['conflict', 'unknown', 'rejected'].includes(r.editor.saveResult))
                return null;
            const token = Object.freeze({ id, operationToken: r.operation.token, context: freezeDispatchContext(c!), generation: g, ticket: ++readSequence });
            comparisons.set(id, token);
            return token;
        },
        compare(read: NoteReadToken, candidates: WorkbenchNote[], c: DispatchContext | null, g: number) {
            const r = notes.get(read.id);
            if (!r || comparisons.get(read.id) !== read || r.operation.token !== read.operationToken || !current(r, c) || read.generation !== g || !['conflict', 'unknown', 'rejected'].includes(r.editor.saveResult))
                return;
            const safe = candidates.filter(n => !!noteForEditor(n));
            const matches = safe.filter(n => n.id === r.editor.noteId);
            immutable({ ...r, comparison: freezeValue(safe), ...(matches.length === 1 && matches[0]!.revision >= (r.editor.baseRevision ?? 1) ? { latest: freezeValue(matches[0]!) } : { latest: undefined }) });
        },
        reedit(id: string, expected: NoteSession, c: DispatchContext | null, g: number) {
            const r = notes.get(id);
            if (!r || r !== expected || !current(r, c) || !r.latest || !r.editor.noteId || !['conflict', 'rejected'].includes(r.editor.saveResult))
                return false;
            const parsed = noteForEditor(r.latest);
            if (!parsed || parsed.mode !== r.mode || !compatibleNoteMetadata(r))
                return false;
            // Adopt only the latest revision/editorial base; retain the original captured evidence representation.
            const draft = r.mode === 'personal' ? { ...r.editor.base, title: parsed.draft.title, content: parsed.draft.content } : parsed.draft;
            let editor = createEditor(r.notebookId, draft, r.latest);
            editor = reduceEditor(editor, { type: 'edit', ...(r.classic ? { ...(r.classic.edits.title !== undefined ? { title: r.editor.title } : {}), ...(r.classic.edits.content !== undefined ? { content: r.editor.content } : {}) } : { title: r.editor.title, content: r.editor.content }) });
            immutable({ ...r, editor, ...(r.classic ? { classic: freezeValue({ base: structuredClone(r.latest), edits: r.classic.edits }) } : {}), latest: undefined, comparison: undefined, history: [...r.history, { editor: r.editor, operation: r.operation, latest: r.latest, ...(r.comparison ? { comparison: r.comparison } : {}), ...(r.classic ? { classic: r.classic } : {}) }], operation: createOperation(r.context, crypto.randomUUID(), { serverIdempotency: false, sessionGeneration: g }) });
            return true;
        },
        reload(id: string, expected: NoteSession, c: DispatchContext | null, g: number) {
            const r = notes.get(id);
            if (!r || r !== expected || !current(r, c) || !r.latest || !r.editor.noteId || !['conflict', 'rejected'].includes(r.editor.saveResult))
                return false;
            const parsed = noteForEditor(r.latest);
            if (!parsed || parsed.mode !== r.mode)
                return false;
            immutable({ ...r, editor: createEditor(r.notebookId, parsed.draft, r.latest), ...(r.classic ? { classic: freezeValue({ base: structuredClone(r.latest), edits: {} }) } : {}), latest: undefined, comparison: undefined, history: [...r.history, { editor: r.editor, operation: r.operation, ...(r.classic ? { classic: r.classic } : {}) }], operation: createOperation(r.context, crypto.randomUUID(), { serverIdempotency: false, sessionGeneration: g }) });
            return true;
        },
        promotion(id: string): SnapshotOrigin | null { const r = notes.get(id); return r && !r.retired && !noteMutationBlocked(r.editor.noteId, r.context) && !r.editor.dirty && !r.editor.pending && r.editor.noteId && r.editor.baseRevision && !['unknown', 'conflict', 'rejected'].includes(r.editor.saveResult) ? { kind: 'note', id: r.editor.noteId, revision: r.editor.baseRevision } : null; },
        capture(notebookId: string, payload: StudioPayload, context: DispatchContext, generation: number) {
            const existing = [...ops.values()].find(r => r.notebookId === notebookId && r.operation.context.epoch === context.epoch && r.payload.kind === payload.kind && !(['export', 'audio', 'download'].includes(r.payload.kind) && ['succeeded', 'failed'].includes(r.operation.state)) && (payload.kind === 'import' ? r.payload.kind === 'import' && r.payload.file === payload.file : payload.kind === 'promote' ? r.payload.kind === 'promote' && JSON.stringify(r.payload.origin) === JSON.stringify(payload.origin) : payload.kind === 'download' ? r.payload.kind === 'download' && r.payload.remoteArtifactId === payload.remoteArtifactId && r.payload.remoteNotebookId === payload.remoteNotebookId : payload.kind === 'delete' ? r.payload.kind === 'delete' && r.payload.noteId === payload.noteId : !['succeeded', 'failed'].includes(r.operation.state)));
            if (existing)
                return existing.id;
            const id = crypto.randomUUID();
            const frozen = payload.kind === 'import' ? Object.freeze({ ...payload }) : freezeValue(structuredClone(payload));
            ops.set(id, Object.freeze({ id, notebookId, payload: frozen, operation: createOperation(context, id, { serverIdempotency: !['import', 'delete'].includes(payload.kind), sessionGeneration: generation }), retired: retired.has(context.epoch), busy: false }));
            emit();
            return id;
        },
        discardUnsent(id: string) {
            const r = ops.get(id);
            if (!r || r.operation.state !== 'idle' || r.operation.token)
                return false;
            ops.delete(id);
            emit();
            return true;
        },
        begin(id: string, c: DispatchContext | null, g: number) {
            const r = ops.get(id);
            if (!r || r.retired || !c || r.operation.state !== 'idle')
                return null;
            const payload = r.payload;
            if (payload.kind === 'delete' && (noteMutationBlocked(payload.noteId, r.operation.context) || [...notes.values()].some(note => note.editor.noteId === payload.noteId && sameOwner(note.context, r.operation.context) && (note.editor.dirty || note.editor.pending))))
                return null;
            if (payload.kind === 'promote' && payload.origin.kind === 'note' && noteMutationBlocked(payload.origin.id, r.operation.context))
                return null;
            const operation = reduceOperation(r.operation, { type: 'begin', context: c, sessionGeneration: g });
            if (operation === r.operation)
                return null;
            const next = Object.freeze({ ...r, operation });
            ops.set(id, next);
            emit();
            return next;
        },
        settle(id: string, token: OperationToken, outcome: StudioOutcome, c: DispatchContext | null, g: number) {
            const r = ops.get(id);
            if (!r || r.operation.token !== token || r.operation.state !== 'submitting')
                return;
            const ok = !r.retired && canDispatch(r.operation.context, c) && token.sessionGeneration === g;
            const result = ok && (outcome.kind !== 'job' || jobMatches(r, outcome.job)) ? outcome : { kind: 'unknown' as const };
            let operation = r.operation, extra: Partial<StudioOperation> = {};
            if (result.kind === 'job') {
                operation = applyJobReceipt(r, token, result.job);
                extra = { job: freezeValue(result.job) };
            }
            else {
                operation = reduceOperation(operation, { type: result.kind === 'not-sent' ? 'not-sent' : result.kind === 'unknown' ? 'unknown' : result.kind === 'rejected' ? 'failed' : 'succeeded', token });
                if (result.kind === 'imported')
                    extra = { imported: freezeValue(result.result) };
                if (result.kind === 'promoted')
                    extra = { promoted: freezeValue(result.result) };
            }
            ops.set(id, Object.freeze({ ...r, ...extra, operation }));
            if (r.payload.kind === 'delete' && result.kind === 'succeeded') {
                for (const [noteId, note] of notes) {
                    if (note.editor.noteId !== r.payload.noteId || !sameOwner(note.context, r.operation.context)) continue;
                    notes.set(noteId, Object.freeze({ ...note, retired: true }));
                    comparisons.delete(noteId);
                }
            }
            emit();
        },
        beginObserve(id: string, c: DispatchContext | null, g: number) {
            const r = ops.get(id);
            if (!r || r.retired || r.busy || !r.job || !r.operation.token || !canDispatch(r.operation.context, c) || r.operation.token.sessionGeneration !== g || !['queued', 'running', 'waiting_remote'].includes(r.job.state) || !['not_submitted', 'confirmed'].includes(r.job.submissionState))
                return null;
            ops.set(id, Object.freeze({ ...r, busy: true }));
            emit();
            return r;
        },
        observed(id: string, token: OperationToken, job: StudioJob | null, c: DispatchContext | null, g: number) {
            const r = ops.get(id);
            if (!r || r.operation.token !== token)
                return;
            const valid = !r.retired && canDispatch(r.operation.context, c) && token.sessionGeneration === g && !!job && jobMatches(r, job);
            ops.set(id, Object.freeze({ ...r, busy: false, ...(valid ? { job: freezeValue(job!) } : {}), operation: valid ? applyJobReceipt(r, token, job!) : reduceOperation(r.operation, { type: 'unknown', token }) }));
            emit();
        },
        retire(epoch: number) {
            retired.add(epoch);
            for (const [id, r] of notes)
                if (r.context.epoch === epoch) {
                    const editor = r.editor.pending && r.editor.saveResult === 'saving' ? reduceEditor(r.editor, { type: 'save-unknown', operationId: r.editor.pending.operationId }) : r.editor;
                    notes.set(id, Object.freeze({ ...r, retired: true, editor }));
                }
            for (const [id, r] of ops)
                if (r.operation.context.epoch === epoch)
                    ops.set(id, Object.freeze({ ...r, retired: true, busy: false, operation: r.operation.token && ['submitting', 'accepted'].includes(r.operation.state) ? reduceOperation(r.operation, { type: 'unknown', token: r.operation.token }) : r.operation }));
            emit();
        },
        blocked(notebookId?: string) { return [...notes.values()].some(r => (!notebookId || r.notebookId === notebookId) && !!r.editor.pending) || [...ops.values()].some(r => (!notebookId || r.notebookId === notebookId) && ['submitting', 'unknown'].includes(r.operation.state)); },
        dirty(notebookId?: string) { return [...notes.values()].some(r => (!notebookId || r.notebookId === notebookId) && r.editor.dirty) || [...ops.values()].some(r => (!notebookId || r.notebookId === notebookId) && r.operation.state === 'idle' && r.payload.kind === 'import'); },
        hasUnsaved() { return [...notes.values()].some(r => r.editor.dirty || r.editor.pending) || [...ops.values()].some(r => ['idle', 'submitting', 'unknown'].includes(r.operation.state)); }
    };
}
export type StudioStore = ReturnType<typeof createStudioStore>;
