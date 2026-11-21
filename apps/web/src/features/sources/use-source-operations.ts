import { useSyncExternalStore } from 'react';
import { readTurnContext, sessionCoordinator, asRequestNotDispatchedError } from '@study/web-transport';
import { useAppDrafts } from '../../app/providers';
import { useSourceConnection } from '../../data/use-source-connection';
import type { SourceOutcome } from './source-operations';
export function useSourceOperations(notebookId: string, onChanged?: () => void) {
    const store = useAppDrafts().sources, rows = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const connection = useSourceConnection();
    async function run(id: string, admit: () => boolean = () => true) {
        const api = connection.api;
        if (!api || !connection.controller?.getSnapshot().ready || !admit())
            return;
        const candidate = store.get(id);
        if (!candidate || candidate.notebookId !== notebookId)
            return;
        if (candidate.payload.kind === 'upload' && (!candidate.file || candidate.file.size > (connection.controller.getSnapshot().capabilities?.limits.source_upload_max_bytes ?? -1)))
            return;
        const originalAdmission=()=>{const state=connection.controller!.getSnapshot();return admit()&&(!candidate.transaction||candidate.transaction.providerRevision===state.providerEvidenceRevision&&!state.providerChecking&&!state.providerNeedsReauth)&&(candidate.payload.kind!=='remote'||!store.selectionUnconfirmed(notebookId,candidate.operation.context.epoch)&&candidate.selectionRevision===store.selectionRevision(notebookId));};
        if(!originalAdmission())return;
        const active = store.begin(id, readTurnContext(), sessionCoordinator.current(),connection.controller.getSnapshot().providerEvidenceRevision);
        if (!active?.operation.token)
            return;
        const token = active.operation.token, context = active.operation.context;
        let outcome: SourceOutcome;
        try {
            const p = active.payload;
            if (p.kind === 'upload') {
                outcome = { kind: 'upload', receipt: await api.upload({ notebookId: active.notebookId, file: active.file!, idempotencyKey: id, ...(p.sourceId ? { sourceId: p.sourceId } : {}) }, context) };
            }
            else if (p.kind === 'selection') {
                await api.saveSelection(active.notebookId, p.selection, context);
                outcome = { kind: 'succeeded' };
            }
            else if (p.kind === 'web') {
                const r = await api.importWeb(active.notebookId, p.result, id, context);
                outcome = { kind: 'import', sourceVersionId: r.source_version_id, jobId: r.job_id };
            }
            else if (p.kind === 'remote') {
                const r = await api.remoteAction(active.notebookId, p.action, context);
                if (r && typeof r.job_id !== 'string')
                    throw new Error('Missing job receipt');
                outcome = r ? { kind: 'job', jobId: r.job_id as string } : { kind: 'succeeded' };
            }
            else {
                await api.cancelJob(p.jobId, context);
                outcome = { kind: 'succeeded' };
            }
        }
        catch (error) {
            outcome = { kind: asRequestNotDispatchedError(error) ? 'not-sent' : 'unknown' };
        }
        if ((active.payload.kind === 'remote' || active.payload.kind === 'selection') && !originalAdmission()) outcome = { kind: 'unknown' };
        store.settle(id, token, outcome, readTurnContext(), sessionCoordinator.current());
        if (store.get(id)?.operation.state === 'succeeded')
            onChanged?.();
    }
    return { ...connection, store, rows: rows.filter(r => r.notebookId === notebookId), run };
}
