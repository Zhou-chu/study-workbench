import { isRecord, parseWorkspaceView, type WorkspaceViewV1 } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, RequestNotDispatchedError, TransportResponseError, type DispatchContext, type WebTransport } from '@study/web-transport';
/** Exact existing NotebookResponse members. IDs and timestamps stay opaque. */
export interface NotebookSummary {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    created: string;
    updated: string;
    source_count: number;
    note_count: number;
}
export interface RecentItem {
    type: 'notebook' | 'source';
    id: string;
    title: string;
    last_viewed_at: string;
}
export interface NotebookApi {
    workspace(id: string, context: DispatchContext, signal?: AbortSignal): Promise<WorkspaceViewV1>;
    list(context: DispatchContext, signal?: AbortSignal): Promise<NotebookSummary[]>;
    create(input: {
        name: string;
        description?: string;
    }, context: DispatchContext): Promise<NotebookSummary>;
    recent(context: DispatchContext, signal?: AbortSignal): Promise<RecentItem[]>;
    recordOpen(id: string, context: DispatchContext, signal?: AbortSignal): Promise<void>;
}
function summary(value: unknown): NotebookSummary {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || typeof value.description !== 'string' || typeof value.archived !== 'boolean' || typeof value.created !== 'string' || typeof value.updated !== 'string' || !Number.isInteger(value.source_count) || Number(value.source_count) < 0 || !Number.isInteger(value.note_count) || Number(value.note_count) < 0)
        throw new Error('Invalid notebook response');
    return { id: value.id, name: value.name, description: value.description, archived: value.archived, created: value.created, updated: value.updated, source_count: value.source_count as number, note_count: value.note_count as number };
}
function recentItem(value: unknown): RecentItem {
    if (!isRecord(value) || (value.type !== 'notebook' && value.type !== 'source') || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || typeof value.last_viewed_at !== 'string')
        throw new Error('Invalid recent response');
    return { type: value.type, id: value.id, title: value.title, last_viewed_at: value.last_viewed_at };
}
function listOf<T>(value: unknown, parse: (value: unknown) => T): T[] { if (!Array.isArray(value))
    throw new Error('Invalid list response'); return value.map(parse); }
export function createNotebookApi(transport: WebTransport): NotebookApi {
    async function request(method: string, path: string, context: DispatchContext, signal?: AbortSignal, body?: string): Promise<unknown> {
        const captured = freezeDispatchContext(context);
        if (!canDispatch(captured, readTurnContext()))
            throw new RequestNotDispatchedError('superseded');
        const response = await transport.send({ method, path, context: captured, ...(signal ? { signal } : {}), ...(body !== undefined ? { body } : {}) });
        if (!canDispatch(captured, readTurnContext())) {
            void response.body?.cancel();
            throw new TransportResponseError('retired');
        }
        if (!response.ok)
            throw new Error(`Notebook request failed (${response.status})`);
        const value: unknown = await response.json();
        if (signal?.aborted || !canDispatch(captured, readTurnContext()))
            throw new TransportResponseError('retired');
        return value;
    }
    return Object.freeze({
        async workspace(id: string, context: DispatchContext, signal?: AbortSignal) {
            const value = parseWorkspaceView(await request('GET', `/personal/notebooks/${encodeURIComponent(id)}/workspace-view`, context, signal));
            if (value.notebook.id !== id)
                throw new Error('Workspace identity mismatch');
            return value;
        },
        async list(context: DispatchContext, signal?: AbortSignal) { return listOf(await request('GET', '/notebooks?order_by=updated%20desc', context, signal), summary); },
        async create(input: {
            name: string;
            description?: string;
        }, context: DispatchContext) {
            if (!input.name.trim())
                throw new RequestNotDispatchedError('configuration');
            return summary(await request('POST', '/notebooks', context, undefined, JSON.stringify({ name: input.name, ...(input.description !== undefined ? { description: input.description } : {}) })));
        },
        async recent(context: DispatchContext, signal?: AbortSignal) { return listOf(await request('GET', '/recently-viewed?limit=12', context, signal), recentItem); },
        async recordOpen(id: string, context: DispatchContext, signal?: AbortSignal) {
            // Existing GET records last_viewed_at. Never synthesize a browser document cache.
            await request('GET', `/notebooks/${encodeURIComponent(id)}`, context, signal);
        }
    });
}
