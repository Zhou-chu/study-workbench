import type { DispatchContext, EmbeddingDisclosure } from '@study/domain';
import type { IndexRequest, IndexReceipt, Preview, SemanticStatus, MaintenanceRequest, MaintenanceJob, ChildStatus } from '../../data/retrieval-contracts';

export type RetrievalFence = Readonly<{
    ownerId: string; mount: string; context: DispatchContext; generation: number;
    selectionRevision: number; configuration: string; providerRevision: number; revision: number;
}>;
export type IndexAttempt = Readonly<{
    id: string; fence: RetrievalFence; preview: Preview; request: IndexRequest;
    phase: 'pending' | 'unknown' | 'not-sent' | 'acknowledged';
    receipt: IndexReceipt | null; observedReceipt: IndexReceipt | null; children: readonly ChildStatus[]; observationFailed: boolean;
    httpStatus?: number;
}>;
export type MaintenanceAttempt = Readonly<{
    id: string; readerKey: string; fence: RetrievalFence; request: MaintenanceRequest;
    phase: 'pending' | 'unknown' | 'not-sent' | 'acknowledged'; job: MaintenanceJob | null;
    observationFailed: boolean; httpStatus?: number;
}>;
export type RetrievalState = Readonly<{
    revision: number; boundary: string; mode: 'lexical' | 'hybrid'; profileId: string | null;
    status: SemanticStatus | null; preview: Preview | null; query: EmbeddingDisclosure | null;
    documentAck: boolean; duplicateAck: boolean; retryChild: string | null;
    busy: boolean; busyToken: string | null; error: boolean; httpStatus?: number; dirty: boolean;
    attempts: readonly IndexAttempt[]; maintenance: readonly MaintenanceAttempt[];
}>;
export const initialRetrieval = (): RetrievalState => Object.freeze({
    revision: 0, boundary: '', mode: 'lexical', profileId: null, status: null, preview: null,
    query: null, documentAck: false, duplicateAck: false, retryChild: null,
    busy: false, busyToken: null, error: false, dirty: false, attempts: Object.freeze([]), maintenance: Object.freeze([]),
});
export const invalidateRetrieval = (s: RetrievalState): RetrievalState => Object.freeze({
    ...s, revision: s.revision + 1, status: null, preview: null, query: null,
    documentAck: false, duplicateAck: false, retryChild: null, busy: false, busyToken: null,
});
export function retrievalObligation(s: RetrievalState): 'pending' | 'unknown' | null {
    if (s.attempts.some(a => a.phase === 'unknown' || a.observationFailed || (a.observedReceipt ?? a.receipt)?.state === 'submission_unknown') ||
        s.maintenance.some(a => a.phase === 'unknown' || a.observationFailed || a.job?.state === 'submission_unknown')) return 'unknown';
    if (s.busy || s.attempts.some(a => a.phase === 'pending' || a.receipt && ['queued', 'running'].includes((a.observedReceipt ?? a.receipt).state)) ||
        s.maintenance.some(a => a.phase === 'pending' || a.job && ['queued', 'running'].includes(a.job.state))) return 'pending';
    return null;
}
