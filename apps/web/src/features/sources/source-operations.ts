import { createOperation, reduceOperation, canDispatch, freezeDispatchContext, type OperationModel, type OperationToken, type DispatchContext } from '@study/domain';
import type { WorkspaceViewV1, WorkbenchSelection } from '@study/contracts';
import type { UploadReceipt, WebResult, RemoteAction } from '../../data/source-api';
import { selectionFromView, sameSelection } from './source-selection';
export type SourcePayload = {
    kind: 'upload';
    sourceId?: string;
} | {
    kind: 'selection';
    selection: WorkbenchSelection;
} | {
    kind: 'web';
    result: WebResult;
} | {
    kind: 'remote';
    action: RemoteAction;
} | {
    kind: 'cancel';
    jobId: string;
};
export type SourceOperation = Readonly<{
    id: string;
    notebookId: string;
    file: File | null;
    fileSignature: string | null;
    payload: SourcePayload;
    operation: OperationModel;
    retired: boolean;
    hidden: boolean;
    receipt?: UploadReceipt;
    versionIds?: readonly string[];
    jobId?: string;
}>;
export type SourceCheckToken = Readonly<{
    id: string;
    operationToken: OperationToken;
    context: DispatchContext;
    generation: number;
}>;
export type SourceOutcome = {
    kind: 'unknown' | 'not-sent' | 'succeeded';
} | {
    kind: 'upload';
    receipt: UploadReceipt;
} | {
    kind: 'import';
    sourceVersionId: string;
    jobId: string | null;
} | {
    kind: 'job';
    jobId: string;
};
async function fileSignature(file: File | null): Promise<string | null> { if (!file)
    return null; const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('File read failed')); reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('File read failed')); reader.readAsArrayBuffer(file); }); const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)); return JSON.stringify([file.name, file.size, file.type, file.lastModified, Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')]); }
function freezePayload(p: SourcePayload): SourcePayload { if (p.kind === 'selection')
    return Object.freeze({ kind: p.kind, selection: Object.freeze({ ...p.selection, source_version_ids: Object.freeze([...p.selection.source_version_ids]) as unknown as string[], remote_source_ids: Object.freeze([...p.selection.remote_source_ids]) as unknown as string[], ...(p.selection.reading ? { reading: Object.freeze({ ...p.selection.reading }) } : {}) }) }); if (p.kind === 'remote')
    return Object.freeze({ kind: p.kind, action: Object.freeze({ ...p.action, versionIds: Object.freeze([...p.action.versionIds]), remoteIds: Object.freeze([...p.action.remoteIds]) }) }); if (p.kind === 'web')
    return Object.freeze({ kind: p.kind, result: Object.freeze({ ...p.result }) }); return Object.freeze({ ...p }); }
/** App-lifetime in-memory ownership. No disk cache, automatic queue, or server replay claim. */
export function createSourceOperations(onChange: () => void) {
    const retiredEpochs = new Set<number>();
    const rows = new Map<string, SourceOperation>();
    let snapshot: readonly SourceOperation[] = Object.freeze([]);
    const listeners = new Set<() => void>();
    const emit = () => { snapshot = Object.freeze([...rows.values()]); listeners.forEach(fn => fn()); onChange(); };
    const add = (notebookId: string, payload: SourcePayload, context: DispatchContext, generation: number, file: File | null = null, signature: string | null = null) => { const id = crypto.randomUUID(); rows.set(id, Object.freeze({ id, notebookId, file, fileSignature: signature, payload: freezePayload(payload), operation: createOperation(context, id, { serverIdempotency: false, sessionGeneration: generation }), retired: retiredEpochs.has(context.epoch), hidden: false })); emit(); return id; };
    return { get: (id: string) => rows.get(id), getSnapshot: () => snapshot, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        async captureUpload(notebookId: string, file: File | null, context: DispatchContext, generation: number, sourceId?: string) { const captured = freezeDispatchContext(context); const signature = await fileSignature(file); const existing = [...rows.values()].find(r => r.payload.kind === 'upload' && r.notebookId === notebookId && r.payload.sourceId === sourceId && signature !== null && r.fileSignature === signature); if (existing)
            return existing.id; return add(notebookId, { kind: 'upload', ...(sourceId ? { sourceId } : {}) }, captured, generation, file, signature); },
        capture(notebookId: string, payload: Exclude<SourcePayload, {
            kind: 'upload';
        }>, context: DispatchContext, generation: number) { if (payload.kind === 'selection' && !selectionFromView(payload.selection))
            throw new Error('Unsupported selection'); const existing = [...rows.values()].find(r => r.notebookId === notebookId && (payload.kind === 'selection' ? r.payload.kind === 'selection' && ['idle', 'submitting', 'unknown'].includes(r.operation.state) : payload.kind === 'web' ? r.payload.kind === 'web' && r.payload.result.url === payload.result.url : payload.kind === 'remote' ? r.payload.kind === 'remote' && r.payload.action.kind === payload.action.kind && r.payload.action.remoteNotebookId === payload.action.remoteNotebookId && JSON.stringify([r.payload.action.versionIds, r.payload.action.remoteIds]) === JSON.stringify([payload.action.versionIds, payload.action.remoteIds]) : r.payload.kind === 'cancel' && r.payload.jobId === payload.jobId)); return existing?.id ?? add(notebookId, payload, context, generation); },
        begin(id: string, current: DispatchContext | null, generation: number) { const r = rows.get(id); if (!r || r.retired || !current || r.payload.kind === 'upload' && !r.file || r.operation.state !== 'idle')
            return null; const operation = reduceOperation(r.operation, { type: 'begin', context: current, sessionGeneration: generation }); if (operation === r.operation)
            return null; const next = Object.freeze({ ...r, operation }); rows.set(id, next); emit(); return next; },
        settle(id: string, token: OperationToken, outcome: SourceOutcome, current: DispatchContext | null, generation: number) { const r = rows.get(id); if (!r || r.operation.token !== token || r.operation.state !== 'submitting')
            return; const valid = !r.retired && canDispatch(r.operation.context, current) && generation === token.sessionGeneration; let operation = r.operation; let extra: Partial<SourceOperation> = {}; if (!valid || outcome.kind === 'unknown')
            operation = reduceOperation(operation, { type: 'unknown', token });
        else if (outcome.kind === 'not-sent')
            operation = reduceOperation(operation, { type: 'not-sent', token });
        else {
            operation = reduceOperation(operation, { type: 'succeeded', token });
            if (outcome.kind === 'upload')
                extra = { receipt: Object.freeze({ ...outcome.receipt }), versionIds: Object.freeze([outcome.receipt.source_version_id]), jobId: outcome.receipt.job_id };
            if (outcome.kind === 'import')
                extra = { versionIds: Object.freeze([outcome.sourceVersionId]), ...(outcome.jobId ? { jobId: outcome.jobId } : {}) };
            if (outcome.kind === 'job')
                extra = { jobId: outcome.jobId };
        } rows.set(id, Object.freeze({ ...r, ...extra, operation })); emit(); },
        beginCheck(id: string, current: DispatchContext | null, generation: number): SourceCheckToken | null { const r = rows.get(id); if (!r || r.retired || !current || !canDispatch(r.operation.context, current) || r.operation.state !== 'unknown' || !r.operation.token)
            return null; return Object.freeze({ id, operationToken: r.operation.token, context: freezeDispatchContext(current), generation }); },
        check(check: SourceCheckToken, workspace: WorkspaceViewV1, current: DispatchContext | null, generation: number) { const { id } = check; const r = rows.get(id); if (!r || r.retired || !canDispatch(r.operation.context, current) || !canDispatch(check.context, current) || check.generation !== generation || r.operation.state !== 'unknown' || r.operation.token !== check.operationToken)
            return false; const receipt = r.payload.kind === 'upload' ? reconcileUpload(r, workspace) : null; const selected = r.payload.kind === 'selection' ? selectionFromView(workspace.selection) : null; if (!receipt && !(r.payload.kind === 'selection' && workspace.notebook.id === r.notebookId && selected && sameSelection(r.payload.selection, selected)))
            return false; rows.set(id, Object.freeze({ ...r, ...(receipt ? { receipt, versionIds: Object.freeze([receipt.source_version_id]), jobId: receipt.job_id } : {}), operation: reduceOperation(r.operation, { type: 'succeeded', token: r.operation.token }) })); emit(); return true; },
        retire(epoch: number) { retiredEpochs.add(epoch); for (const [id, r] of rows)
            if (r.operation.context.epoch === epoch)
                rows.set(id, Object.freeze({ ...r, retired: true, operation: r.operation.state === 'submitting' && r.operation.token ? reduceOperation(r.operation, { type: 'unknown', token: r.operation.token }) : r.operation })); emit(); },
        dismiss(id: string) { const r = rows.get(id); if (r?.operation.state !== 'succeeded')
            return; rows.set(id, Object.freeze({ ...r, hidden: true })); emit(); },
        pending(notebookId: string) { return [...rows.values()].some(r => r.notebookId === notebookId && ['submitting', 'unknown'].includes(r.operation.state)); },
        hasUnsaved() { return [...rows.values()].some(r => r.operation.state !== 'succeeded'); }
    };
}
/** A matching job is a stable read receipt only, never permission to repeat POST. */
export function reconcileUpload(row: SourceOperation, workspace: WorkspaceViewV1): UploadReceipt | null {
    if (row.payload.kind !== 'upload' || workspace.notebook.id !== row.notebookId || workspace.notebook.projection_status)
        return null;
    const jobs = workspace.jobs.filter(j => 'idempotency_key' in j && j.idempotency_key === row.id);
    if (jobs.length !== 1)
        return null;
    const job = jobs[0]!;
    if (!('job_id' in job) || job.projection_status || job.operation !== 'extract_evidence' || job.notebook_id !== row.notebookId || job.restored_history === true || typeof job.job_id !== 'string' || !job.job_id || typeof job.source_id !== 'string' || !job.source_id || typeof job.source_version_id !== 'string' || !job.source_version_id || row.payload.sourceId !== undefined && job.source_id !== row.payload.sourceId)
        return null;
    if (workspace.jobs.some(j => j !== job && (!('job_id' in j) || j.job_id === job.job_id)))
        return null;
    const sources = workspace.sources.filter(s => 'source_id' in s && s.source_id === job.source_id);
    if (sources.length !== 1)
        return null;
    const source = sources[0]!;
    if (!('versions' in source) || source.projection_status || !Array.isArray(source.versions))
        return null;
    const versions = source.versions.filter(v => 'source_version_id' in v && v.source_version_id === job.source_version_id);
    if (versions.length !== 1)
        return null;
    const v = versions[0]!;
    if (!('source_version_id' in v) || v.projection_status || v.source_id !== job.source_id || v.notebook_id !== row.notebookId)
        return null;
    return { source_id: job.source_id, source_version_id: job.source_version_id, job_id: job.job_id };
}
