import { isRecord, parseWorkspaceView, parseSourceVersionView, parseJobView, type WorkbenchSelection, type SourceVersionView, type WorkspaceViewV1 } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, RequestNotDispatchedError, TransportResponseError, type DispatchContext, type WebTransport } from '@study/web-transport';
export interface UploadReceipt {
    source_id: string;
    source_version_id: string;
    job_id: string;
}
export interface WebResult {
    id: string;
    url: string;
    title: string;
    snippet: string;
    domain: string;
}
export interface WebStatus {
    state: 'ready' | 'configuration_required';
    provider: 'firecrawl';
    configured: boolean;
    max_results: number;
    access_mode: 'api_key' | 'keyless_trial' | null;
}
export interface WebResults {
    provider: 'firecrawl';
    searched_at: string;
    results: WebResult[];
    total_count: number;
}
export interface WebImportReceipt {
    state: 'queued' | 'already_imported' | 'saved';
    source_id: string;
    source_version_id: string;
    job_id: string | null;
    url: string;
    warning: string | null;
}
export interface RemoteSource {
    id: string;
    title: string;
    status?: string;
}
export interface RemotePage {
    items: RemoteSource[];
    next_cursor: string | null;
    listing_complete: boolean;
}
export type RemoteAction = Readonly<{
    kind: 'sync' | 'import' | 'associate';
    remoteNotebookId: string;
    versionIds: readonly string[];
    remoteIds: readonly string[];
    idempotencyKey: string;
}>;
export interface RemoteCapabilities {
    operations: ReadonlyArray<{
        name: string;
        support: string;
    }>;
}
export interface EvidenceHit {
    evidence_id: string;
    source_version_id: string;
    quote: string;
    page_index?: number;
}
export interface EvidenceResults {
    hits: EvidenceHit[];
    retrieval?: {
        requested_method: string;
        retrieval_method: string;
        fallback_reason: string | null;
        indexed_version_count: number;
        selected_version_count: number;
    };
}
export class SourceRequestError extends Error {
    constructor(readonly status: number, readonly code: string | null) { super('Source request was not confirmed'); }
}
function record(v: unknown) { if (!isRecord(v))
    throw new Error('Invalid source response'); return v; }
function str(v: unknown): string { if (typeof v !== 'string' || !v.trim())
    throw new Error('Invalid identity'); return v; }
function stringValue(v: unknown): string { if (typeof v !== 'string')
    throw new Error('Invalid string'); return v; }
function list(v: unknown): unknown[] { if (!Array.isArray(v))
    throw new Error('Invalid list'); return v; }
function integer(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0)
    throw new Error('Invalid count'); return v as number; }
function uploadReceipt(v: unknown): UploadReceipt { const r = record(v); return { source_id: str(r.source_id), source_version_id: str(r.source_version_id), job_id: str(r.job_id) }; }
function webResult(v: unknown): WebResult { const r = record(v); return { id: str(r.id), url: str(r.url), title: stringValue(r.title), snippet: stringValue(r.snippet), domain: stringValue(r.domain) }; }
function safeCode(v: unknown): string | null { if (!isRecord(v))
    return null; for (const e of [v.detail, v.error, v]) {
    if (isRecord(e) && typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(e.code))
        return e.code;
} return null; }
export function safeSourceUrl(value: unknown): string | undefined { if (typeof value !== 'string')
    return; try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined;
}
catch {
    return;
} }
export function createSourceApi(transport: WebTransport) {
    async function request(method: string, path: string, context: DispatchContext, body?: BodyInit, signal?: AbortSignal): Promise<unknown> {
        const generation = sessionCoordinator.current(), captured = freezeDispatchContext(context);
        if (!canDispatch(captured, readTurnContext()))
            throw new RequestNotDispatchedError('superseded');
        const response = await transport.send({ method, path, context: captured, ...(body !== undefined ? { body } : {}), ...(signal ? { signal } : {}) });
        if (!canDispatch(captured, readTurnContext()) || generation !== sessionCoordinator.current()) {
            void response.body?.cancel();
            throw new TransportResponseError('retired');
        }
        const data: unknown = await response.json();
        if (signal?.aborted || !canDispatch(captured, readTurnContext()) || generation !== sessionCoordinator.current())
            throw new TransportResponseError('retired');
        if (!response.ok)
            throw new SourceRequestError(response.status, safeCode(data));
        return data;
    }
    const path = (n: string, suffix: string) => `/personal/notebooks/${encodeURIComponent(n)}/${suffix}`;
    return Object.freeze({
        async upload(input: {
            notebookId: string;
            file: File;
            idempotencyKey: string;
            sourceId?: string;
        }, context: DispatchContext) { const form = new FormData(); form.append('file', input.file); form.append('title', input.file.name); form.append('idempotency_key', input.idempotencyKey); if (input.sourceId)
            form.append('source_id', input.sourceId); return uploadReceipt(await request('POST', path(input.notebookId, 'sources/upload'), context, form)); },
        async workspace(notebookId: string, context: DispatchContext, signal?: AbortSignal): Promise<WorkspaceViewV1> { const value = parseWorkspaceView(await request('GET', path(notebookId, 'workspace-view'), context, undefined, signal)); if (value.notebook.id !== notebookId)
            throw new Error('Workspace identity mismatch'); return value; },
        async saveSelection(notebookId: string, input: WorkbenchSelection, context: DispatchContext) { await request('PATCH', path(notebookId, 'selection'), context, JSON.stringify({ engine: input.engine, selection_origin: input.selection_origin, source_version_ids: [...input.source_version_ids], remote_source_ids: [...input.remote_source_ids], ...(input.reading !== undefined ? { reading: input.reading } : {}) })); },
        async versions(sourceId: string, context: DispatchContext): Promise<SourceVersionView[]> { return list(await request('GET', `/personal/sources/${encodeURIComponent(sourceId)}/versions`, context)).map(parseSourceVersionView); },
        async webStatus(context: DispatchContext): Promise<WebStatus> { const r = record(await request('GET', '/personal/web-search/status', context)); if (!['ready', 'configuration_required'].includes(String(r.state)) || r.provider !== 'firecrawl' || typeof r.configured !== 'boolean' || !['api_key', 'keyless_trial', null].includes(r.access_mode as string | null))
            throw new Error('Invalid discovery readiness'); return { state: r.state as WebStatus['state'], provider: 'firecrawl', configured: r.configured, max_results: integer(r.max_results), access_mode: r.access_mode as WebStatus['access_mode'] }; },
        async searchWeb(query: string, limit: number, context: DispatchContext): Promise<WebResults> { const r = record(await request('POST', '/personal/web-search', context, JSON.stringify({ query, limit }))); if (r.provider !== 'firecrawl')
            throw new Error('Invalid provider'); return { provider: 'firecrawl', searched_at: str(r.searched_at), results: list(r.results).map(webResult), total_count: integer(r.total_count) }; },
        async importWeb(notebookId: string, result: WebResult, idempotencyKey: string, context: DispatchContext): Promise<WebImportReceipt> { const r = record(await request('POST', path(notebookId, 'sources/web-import'), context, JSON.stringify({ url: result.url, title: result.title, snippet: result.snippet, provider: 'firecrawl', idempotency_key: idempotencyKey }))); if (!['queued', 'already_imported', 'saved'].includes(String(r.state)))
            throw new Error('Invalid import receipt'); return { state: r.state as WebImportReceipt['state'], source_id: str(r.source_id), source_version_id: str(r.source_version_id), job_id: r.job_id === null ? null : str(r.job_id), url: str(r.url), warning: r.warning === null ? null : stringValue(r.warning) }; },
        async remoteCapabilities(context: DispatchContext): Promise<RemoteCapabilities> { const r = record(await request('GET', '/personal/notebooklm/capabilities', context)); return { operations: list(r.operations).map(v => { const x = record(v); return { name: str(x.name), support: str(x.support) }; }) }; },
        async remoteSources(remoteNotebookId: string, cursor: string | null, context: DispatchContext): Promise<RemotePage> { const r = record(await request('GET', `/personal/notebooklm/notebooks/${encodeURIComponent(remoteNotebookId)}/sources${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`, context)); return { items: list(r.items).map(v => { const x = record(v); return { id: str(x.id), title: stringValue(x.title), ...(typeof x.status === 'string' ? { status: x.status } : {}) }; }), next_cursor: r.next_cursor == null ? null : str(r.next_cursor), listing_complete: r.listing_complete === true }; },
        async remoteAction(notebookId: string, input: RemoteAction, context: DispatchContext) { const body = input.kind === 'associate' ? { remote_notebook_id: input.remoteNotebookId, source_version_id: input.versionIds[0], remote_source_id: input.remoteIds[0], user_confirmed: true } : { remote_notebook_id: input.remoteNotebookId, ...(input.kind === 'sync' ? { source_version_ids: input.versionIds } : { remote_source_ids: input.remoteIds, include_text: true }), idempotency_key: input.idempotencyKey }; const r = await request('POST', path(notebookId, { sync: 'sync/notebooklm', import: 'imports/notebooklm', associate: 'notebooklm-source-link' }[input.kind]), context, JSON.stringify(body)); return input.kind === 'associate' ? null : parseJobView(r); },
        async cancelJob(jobId: string, context: DispatchContext) { return parseJobView(await request('POST', `/personal/jobs/${encodeURIComponent(jobId)}/cancel`, context)); },
        async searchEvidence(notebookId: string, query: string, versionIds: readonly string[], context: DispatchContext): Promise<EvidenceResults> { const r = record(await request('POST', '/personal/search', context, JSON.stringify({ notebook_id: notebookId, query, source_version_ids: versionIds, retrieval_mode: 'lexical' }))); const hits = list(r.hits).map(v => { const x = record(v); const loc = isRecord(x.locator) ? x.locator : {}; return { evidence_id: str(x.evidence_id), source_version_id: str(x.source_version_id), quote: stringValue(x.quote), ...(Number.isSafeInteger(loc.page_index) && Number(loc.page_index) >= 0 ? { page_index: loc.page_index as number } : {}) }; }); if (!r.retrieval)
            return { hits }; const m = record(r.retrieval); return { hits, retrieval: { requested_method: str(m.requested_method), retrieval_method: str(m.retrieval_method), fallback_reason: m.fallback_reason === null ? null : stringValue(m.fallback_reason), indexed_version_count: integer(m.indexed_version_count), selected_version_count: integer(m.selected_version_count) } }; }
    });
}
export type SourceApi = ReturnType<typeof createSourceApi>;
