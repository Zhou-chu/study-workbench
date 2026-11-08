import { useMemo, useSyncExternalStore } from 'react';
import { canDispatch, readTurnContext, subscribeTurnContext, sessionCoordinator, asRequestNotDispatchedError } from '@study/web-transport';
import type { UpdateWorkbenchNoteInput, TurnView } from '@study/contracts';
import { useAppData, useAppDrafts } from '../../app/providers';
import { useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import { createStudioApi, StudioError, noteForEditor, type JobBinding } from '../../data/studio-api';
import { createNotebookApi } from '../../data/notebook-api';
import type { SaveOutcome, StudioOutcome } from './studio-store';
export function useStudio(notebookId: string, onChanged?: () => void) {
    const { transport } = useAppData(), drafts = useAppDrafts(), store = drafts.studio, snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot), context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null), session = useWorkbenchSnapshot();
    const api = useMemo(() => transport ? createStudioApi(transport) : null, [transport]), notebooks = useMemo(() => transport ? createNotebookApi(transport) : null, [transport]);
    const ready = !!api && context?.ready === true && session.state?.ready === true;
    async function save(id: string) {
        if (!ready || !api)
            return;
        const a = store.beginSave(id, readTurnContext(), sessionCoordinator.current());
        if (!a?.operation.token || !a.editor.pending)
            return;
        const token = a.operation.token, p = a.editor.pending.payload;
        let outcome: SaveOutcome;
        try {
            const note = a.mode === 'classic' ? (a.editor.noteId ? await api.updateClassic(a.editor.noteId, a.classic!.pending!.patch!, a.context) : await api.createClassic(notebookId, { title: p.title, content: p.content, note_type: 'human' }, a.context)) : (a.editor.noteId ? await api.updateNote(notebookId, a.editor.noteId, p as UpdateWorkbenchNoteInput, a.context) : await api.createNote(notebookId, p, a.context));
            outcome = { kind: 'saved', note };
        }
        catch (e) {
            outcome = asRequestNotDispatchedError(e) ? { kind: 'not-sent' } : e instanceof StudioError && e.kind === 'conflict' ? { kind: 'conflict', status: e.status as 409 | 428 } : e instanceof StudioError && e.kind === 'rejected' ? { kind: 'rejected' } : { kind: 'unknown' };
        }
        store.settleSave(id, token, outcome, readTurnContext(), sessionCoordinator.current());
        if (store.get(id)?.editor.saveResult === 'saved')
            onChanged?.();
    }
    async function compare(id: string) {
        const r = store.get(id);
        if (!ready || !api || !notebooks || !r || !canDispatch(r.context, readTurnContext()) || r.generation !== sessionCoordinator.current())
            return false;
        try {
            const read = store.beginCompare(id, readTurnContext(), sessionCoordinator.current());
            if (!read)
                return false;
            const notes = (await notebooks.workspace(notebookId, r.context)).notes.flatMap(n => {
                try {
                    return 'id' in n ? [n] : [];
                }
                catch {
                    return [];
                }
            });
            store.compare(read, notes.flatMap(n => { const p = noteForEditor(n); return p ? [p.note] : []; }), readTurnContext(), sessionCoordinator.current());
            return true;
        }
        catch {
            return false;
        }
    }
    const admission = (id:string,admit?:()=>boolean) => {const kind=store.getOperation(id)?.payload.kind;return admit?admit():kind!=='audio'&&kind!=='download';};
    async function run(id: string, admit?: () => boolean) {
        if (!ready || !api || !admission(id,admit) || store.getOperation(id)?.notebookId !== notebookId)
            return;
        const a = store.begin(id, readTurnContext(), sessionCoordinator.current());
        if (!a?.operation.token || a.notebookId !== notebookId)
            return;
        const token = a.operation.token, c = a.operation.context, p = a.payload;
        let outcome: StudioOutcome;
        try {
            if (p.kind === 'export')
                outcome = { kind: 'job', job: await api.exportPortable(notebookId, a.id, c) };
            else if (p.kind === 'import')
                outcome = { kind: 'imported', result: await api.importPortable(p.file, notebookId, c) };
            else if (p.kind === 'audio')
                outcome = { kind: 'job', job: await api.audio(notebookId, { ...p.request, idempotency_key: a.id }, c) };
            else if (p.kind === 'download')
                outcome = { kind: 'job', job: await api.downloadRemote(notebookId, p.remoteNotebookId, p.remoteArtifactId, a.id, c) };
            else if (p.kind === 'promote')
                outcome = { kind: 'promoted', result: await api.promote({ notebookId, origin: p.origin, idempotencyKey: a.id }, c) };
            else {
                await api.deleteClassic(p.noteId, c);
                outcome = { kind: 'succeeded' };
            }
        }
        catch (e) {
            outcome = asRequestNotDispatchedError(e) ? { kind: 'not-sent' } : e instanceof StudioError && e.kind === 'rejected' ? { kind: 'rejected' } : { kind: 'unknown' };
        }
        if (!admission(id,admit))
            outcome = { kind: 'unknown' };
        store.settle(id, token, outcome, readTurnContext(), sessionCoordinator.current());
        if (store.getOperation(id)?.operation.state === 'succeeded')
            onChanged?.();
    }
    async function observe(id: string, cancel = false, admit?: () => boolean) {
        if (!ready || !api || !admission(id,admit))
            return;
        const a = store.beginObserve(id, readTurnContext(), sessionCoordinator.current());
        if (!a?.job || !a.operation.token)
            return;
        const binding: JobBinding & {
            jobId: string;
        } = { notebookId: a.notebookId, operation: a.job.operation, idempotencyKey: a.id, jobId: a.job.jobId };
        let job = null;
        try {
            job = await (cancel ? api.cancel(binding, a.operation.context) : api.job(binding, a.operation.context));
        }
        catch { /* A known receipt is retained, never replayed. */ }
        store.observed(id, a.operation.token, admission(id,admit) ? job : null, readTurnContext(), sessionCoordinator.current());
    }
    function saveAnswer(turn: TurnView) {
        const c = readTurnContext();
        if (!ready || !c)
            return;
        const id = store.captureTurn(notebookId, turn, c, sessionCoordinator.current(), `answer:${String(turn.turn_id)}`);
        if (!id)
            return;
        const row = store.get(id)!;
        if (!row.editor.noteId && !row.editor.pending && row.editor.saveResult === 'idle')
            void save(id);
    }
    return { ...session, api, context, ready, store, snapshot, save, compare, run, observe, saveAnswer, notes: snapshot.notes.filter(n => n.notebookId === notebookId), operations: snapshot.operations.filter(r => r.notebookId === notebookId) };
}
export type StudioConnection = ReturnType<typeof useStudio>;
