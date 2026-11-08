import { isRecord } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, RequestNotDispatchedError, TransportResponseError, type DispatchContext, type WebTransport } from '@study/web-transport';
export type SourceSort = 'type' | 'title' | 'created' | 'updated' | 'insights_count' | 'embedded';
export interface LibrarySource {
    id: string;
    title: string | null;
    topics: string[] | null;
    asset: {
        url: string | null;
        hasFile: boolean;
    } | null;
    embedded: boolean;
    embedded_chunks: number;
    insights_count?: number;
    created: string;
    updated: string;
    file_available: boolean | null;
    command_id: string | null;
    status: string | null;
    submissionUnknown: boolean;
    full_text?: string | null;
    notebooks?: string[] | null;
}
export interface SourceInsight {
    id: string;
    source_id: string;
    insight_type: string;
    content: string;
    created: string | null;
    updated: string | null;
}
export interface SourceStatus {
    status: string | null;
    command_id: string | null;
    submissionUnknown: boolean;
}
export interface TransformationOption {
    id: string;
    title: string;
    description: string;
    apply_default: boolean;
}
export interface CommandStatus {
    job_id: string;
    status: string;
}
export interface SourceInput {
    type: 'link' | 'upload' | 'text';
    title?: string;
    url?: string;
    content?: string;
    file?: File;
    notebooks: readonly string[];
    transformations: readonly string[];
    embed: boolean;
}
export class LibraryError extends Error {
    constructor(readonly kind: 'rejected' | 'unknown' | 'invalid' | 'missing', readonly status?: number, readonly resourceId?: string, readonly commandId?: string) { super('Library request was not confirmed'); }
}
const record = (v: unknown) => {
    if (!isRecord(v))
        throw new LibraryError('invalid');
    return v;
};
const str = (v: unknown) => {
    if (typeof v !== 'string')
        throw new LibraryError('invalid');
    return v;
};
const id = (v: unknown) => {
    const s = str(v);
    if (!s.trim() || /[\\/\u0000-\u001f]/.test(s))
        throw new LibraryError('invalid');
    return s;
};
const nullable = (v: unknown) => v == null ? null : str(v);
const array = (v: unknown) => {
    if (!Array.isArray(v))
        throw new LibraryError('invalid');
    return v as unknown[];
};
const strings = (v: unknown) => array(v).map(str);
const nonnegative = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        throw new LibraryError('invalid');
    return v;
};
const boolean = (v: unknown) => {
    if (typeof v !== 'boolean')
        throw new LibraryError('invalid');
    return v;
};
export function parseLibrarySource(v: unknown, detail = false): LibrarySource {
    const r = record(v), a = r.asset == null ? null : record(r.asset), info = r.processing_info == null ? null : record(r.processing_info);
    return { id: id(r.id), title: nullable(r.title), topics: r.topics == null ? null : strings(r.topics), asset: a ? { url: nullable(a.url), hasFile: typeof a.file_path === 'string' && !!a.file_path } : null,
        embedded: boolean(r.embedded), embedded_chunks: nonnegative(r.embedded_chunks), ...(r.insights_count !== undefined ? { insights_count: nonnegative(r.insights_count) } : {}), created: str(r.created), updated: str(r.updated),
        file_available: r.file_available == null ? null : boolean(r.file_available), command_id: nullable(r.command_id), status: nullable(r.status), submissionUnknown: info?.submission_unknown === true,
        ...(detail ? { full_text: nullable(r.full_text), notebooks: r.notebooks == null ? null : strings(r.notebooks) } : {}) };
}
export function parseInsight(v: unknown): SourceInsight { const r = record(v); return { id: id(r.id), source_id: id(r.source_id), insight_type: str(r.insight_type), content: str(r.content), created: nullable(r.created), updated: nullable(r.updated) }; }
export function createLibraryApi(transport: WebTransport) {
    async function response(method: string, path: string, c: DispatchContext, signal?: AbortSignal, body?: BodyInit, key?: string) {
        const context = freezeDispatchContext(c), generation = sessionCoordinator.current();
        const current = () => canDispatch(context, readTurnContext()) && generation === sessionCoordinator.current() && !signal?.aborted;
        if (!current())
            throw new RequestNotDispatchedError('superseded');
        const res = await transport.send({ method, path, context, ...(signal ? { signal } : {}), ...(body !== undefined ? { body } : {}), ...(key ? { operationKey: key } : {}) });
        if (!current()) {
            void res.body?.cancel();
            throw new TransportResponseError('retired');
        }
        if (!res.ok) {
            let value: unknown;
            try {
                value = await res.json();
            }
            catch {
                value = null;
            }
            if (!current())
                throw new TransportResponseError('retired');
            const d = isRecord(value) && isRecord(value.detail) ? value.detail : null;
            if (d?.code === 'COMMAND_SUBMISSION_UNKNOWN')
                throw new LibraryError('unknown', res.status, typeof d.resource_id === 'string' ? d.resource_id : undefined, typeof d.command_id === 'string' ? d.command_id : undefined);
            throw new LibraryError(res.status === 404 ? 'missing' : res.status >= 400 && res.status < 500 && res.status !== 408 ? 'rejected' : 'unknown', res.status);
        }
        return { res, current };
    }
    async function request(method: string, path: string, c: DispatchContext, signal?: AbortSignal, body?: BodyInit, key?: string) {
        const { res, current } = await response(method, path, c, signal, body, key);
        let value: unknown;
        try {
            value = await res.json();
        }
        catch {
            throw new LibraryError('invalid');
        }
        if (!current())
            throw new TransportResponseError('retired');
        return value;
    }
    const sourcePath = (s: string) => '/sources/' + encodeURIComponent(id(s));
    return {
        sources: {
            async list(params: {
                notebook_id?: string;
                limit?: number;
                offset?: number;
                sort_by?: SourceSort;
                sort_order?: 'asc' | 'desc';
            }, c: DispatchContext, signal?: AbortSignal) {
                const q = new URLSearchParams();
                Object.entries(params).forEach(([k, v]) => {
                    if (v !== undefined)
                        q.set(k, String(v));
                });
                return array(await request('GET', '/sources?' + q, c, signal)).map(v => parseLibrarySource(v));
            },
            async get(s: string, c: DispatchContext, signal?: AbortSignal) {
                const value = parseLibrarySource(await request('GET', sourcePath(s), c, signal), true);
                if (value.id !== s)
                    throw new LibraryError('invalid');
                return value;
            },
            async status(s: string, c: DispatchContext, signal?: AbortSignal): Promise<SourceStatus> { const r = record(await request('GET', sourcePath(s) + '/status', c, signal)), p = r.processing_info == null ? null : record(r.processing_info); return { status: nullable(r.status), command_id: nullable(r.command_id), submissionUnknown: p?.submission_unknown === true }; },
            async create(p: SourceInput, c: DispatchContext, key: string) {
                if (p.notebooks.length > 50 || p.transformations.length > 50 || p.type === 'upload' && !p.file || p.type === 'link' && !p.url?.trim() || p.type === 'text' && !p.content?.trim())
                    throw new RequestNotDispatchedError('configuration');
                const body = new FormData();
                body.append('type', p.type);
                body.append('notebooks', JSON.stringify(p.notebooks));
                body.append('transformations', JSON.stringify(p.transformations));
                if (p.title)
                    body.append('title', p.title);
                if (p.type === 'link' && p.url)
                    body.append('url', p.url);
                if (p.type === 'text' && p.content)
                    body.append('content', p.content);
                if (p.type === 'upload' && p.file)
                    body.append('file', p.file);
                body.append('embed', String(p.embed));
                body.append('delete_source', 'false');
                body.append('async_processing', 'true');
                return parseLibrarySource(await request('POST', '/sources', c, undefined, body, key), true);
            },
            async update(s: string, p: {
                title?: string;
                topics?: string[];
            }, c: DispatchContext, key: string) {
                const body = { ...(p.title !== undefined ? { title: p.title } : {}), ...(p.topics !== undefined ? { topics: p.topics } : {}) };
                const out = parseLibrarySource(await request('PUT', sourcePath(s), c, undefined, JSON.stringify(body), key), true);
                if (out.id !== s)
                    throw new LibraryError('invalid');
                return out;
            },
            async delete(s: string, c: DispatchContext, key: string) { await request('DELETE', sourcePath(s), c, undefined, undefined, key); },
            async retry(s: string, c: DispatchContext, key: string) {
                const out = parseLibrarySource(await request('POST', sourcePath(s) + '/retry', c, undefined, undefined, key), true);
                if (out.id !== s)
                    throw new LibraryError('invalid');
                return out;
            },
            async download(s: string, c: DispatchContext, signal?: AbortSignal) {
                const { res, current } = await response('GET', sourcePath(s) + '/download', c, signal);
                const blob = await res.blob();
                if (!current())
                    throw new TransportResponseError('retired');
                return { blob, disposition: res.headers.get('content-disposition') };
            },
            async available(s: string, c: DispatchContext, signal?: AbortSignal) { await response('HEAD', sourcePath(s) + '/download', c, signal); return true; }
        },
        associations: {
            async set(n: string, s: string, linked: boolean, c: DispatchContext, key: string) { await request(linked ? 'POST' : 'DELETE', `/notebooks/${encodeURIComponent(id(n))}/sources/${encodeURIComponent(id(s))}`, c, undefined, undefined, key); },
            async search(query: string, c: DispatchContext, signal?: AbortSignal) {
                const r = record(await request('POST', '/search', c, signal, JSON.stringify({ query, type: 'text', search_sources: true, search_notes: false, limit: 100, minimum_score: 0.01 })));
                const seen = new Set<string>();
                return array(r.results).map(v => { const row = record(v); return { id: str(row.parent_id), title: nullable(row.title) }; }).filter(row => {
                    if (seen.has(row.id))
                        return false;
                    seen.add(row.id);
                    return true;
                });
            }
        },
        insights: {
            async list(s: string, c: DispatchContext, signal?: AbortSignal) {
                const rows = array(await request('GET', sourcePath(s) + '/insights', c, signal)).map(parseInsight);
                if (rows.some(r => r.source_id !== s))
                    throw new LibraryError('invalid');
                return rows;
            },
            async get(i: string, c: DispatchContext, signal?: AbortSignal) {
                const row = parseInsight(await request('GET', '/insights/' + encodeURIComponent(id(i)), c, signal));
                if (row.id !== i)
                    throw new LibraryError('invalid');
                return row;
            },
            async create(s: string, t: string, c: DispatchContext, key: string) {
                const r = record(await request('POST', sourcePath(s) + '/insights', c, undefined, JSON.stringify({ transformation_id: t }), key));
                if (r.status !== 'pending' || r.source_id !== s || r.transformation_id !== t)
                    throw new LibraryError('invalid');
                return { commandId: nullable(r.command_id), sourceId: s, transformationId: t };
            },
            async delete(i: string, c: DispatchContext, key: string) { await request('DELETE', '/insights/' + encodeURIComponent(id(i)), c, undefined, undefined, key); }
        },
        async embed(s: string, c: DispatchContext, key: string) {
            const r = record(await request('POST', '/embed', c, undefined, JSON.stringify({ item_id: s, item_type: 'source', async_processing: false }), key));
            if (r.success !== true || r.item_id !== s || r.item_type !== 'source')
                throw new LibraryError('invalid');
            return { commandId: nullable(r.command_id) };
        },
        async command(commandId: string, c: DispatchContext, signal?: AbortSignal): Promise<CommandStatus> {
            const r = record(await request('GET', '/commands/jobs/' + encodeURIComponent(id(commandId)), c, signal));
            if (r.job_id !== commandId)
                throw new LibraryError('invalid');
            return { job_id: commandId, status: str(r.status) };
        },
        metadata: {
            async transformations(c: DispatchContext, signal?: AbortSignal) { return array(await request('GET', '/transformations', c, signal)).map(v => { const r = record(v); return { id: id(r.id), title: str(r.title), description: str(r.description), apply_default: boolean(r.apply_default) }; }); },
            async models(c: DispatchContext, signal?: AbortSignal) { return array(await request('GET', '/models', c, signal)).map(v => { const r = record(v); return { id: id(r.id), name: str(r.name), type: str(r.type) }; }); }
        }
    };
}
export type LibraryApi = ReturnType<typeof createLibraryApi>;
