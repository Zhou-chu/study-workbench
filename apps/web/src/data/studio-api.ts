import { isRecord, type CreateWorkbenchNoteInput, type UpdateWorkbenchNoteInput, type WorkbenchNote, type EvidenceCitation, type ScopeSnapshot, type NoteScopeSnapshot, type NoteView, type SourceSnapshotResult, type SnapshotOrigin, type ArtifactView } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, RequestNotDispatchedError, TransportResponseError, type DispatchContext, type WebTransport } from '@study/web-transport';
export class StudioError extends Error {
    constructor(readonly kind: 'conflict' | 'rejected' | 'invalid' | 'limit', readonly status?: number) { super('Studio request was not confirmed'); }
}
const invalid = (): never => { throw new StudioError('invalid'); };
const rec = (v: unknown): Record<string, unknown> => isRecord(v) && !v.projection_status ? v : invalid();
const text = (v: unknown): string => typeof v === 'string' ? v : invalid();
const id = (v: unknown): string => typeof v === 'string' && !!v.trim() && v.length <= 2048 ? v : invalid();
const resourceId = (v: unknown): string => /^[a-zA-Z0-9_:-]+$/.test(id(v)) ? v as string : invalid();
const num = (v: unknown, minimum = 0): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= minimum ? v : invalid();
const strings = (v: unknown): string[] => Array.isArray(v) ? v.map(id) : invalid();
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : invalid();
const nullable = (v: unknown): string | null => v === null ? null : text(v);
const keys = (r: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(r).some(k => !allowed.includes(k)))
        invalid();
};
export function parseScope(value: unknown): ScopeSnapshot {
    const r = rec(value);
    keys(r, ['engine', 'selection_origin', 'source_version_ids', 'remote_source_ids', 'remote_notebook_id', 'scope_hash']);
    const result: ScopeSnapshot = { source_version_ids: strings(r.source_version_ids) };
    if (r.engine !== undefined) {
        if (!['independent', 'notebooklm'].includes(String(r.engine)))
            invalid();
        result.engine = r.engine as string;
    }
    if (r.selection_origin !== undefined) {
        if (!['local', 'remote'].includes(String(r.selection_origin)))
            invalid();
        result.selection_origin = r.selection_origin as 'local' | 'remote';
    }
    if (r.remote_source_ids !== undefined)
        result.remote_source_ids = strings(r.remote_source_ids);
    if (r.remote_notebook_id !== undefined)
        result.remote_notebook_id = nullable(r.remote_notebook_id);
    if (r.scope_hash !== undefined)
        result.scope_hash = text(r.scope_hash);
    return result;
}
function provenance(value: unknown, depth = 0): EvidenceCitation['provenance'] {
    if (depth > 4)
        invalid();
    const r = rec(value);
    if (r.kind === 'web') {
        keys(r, ['kind', 'source_url', 'retrieved_at', 'provider', 'search_result_title', 'search_result_snippet', 'historical_url_omitted']);
        if (r.provider !== 'firecrawl')
            invalid();
        nullable(r.source_url);
        text(r.retrieved_at);
        for (const k of ['search_result_title', 'search_result_snippet'])
            if (r[k] !== undefined)
                nullable(r[k]);
        if (r.historical_url_omitted !== undefined && typeof r.historical_url_omitted !== 'boolean')
            invalid();
        return structuredClone(r) as unknown as EvidenceCitation['provenance'];
    }
    if (r.kind !== 'derived' || !['note', 'turn'].includes(String(r.origin_kind)) || !['ai', 'human', 'unknown'].includes(String(r.authorship)))
        invalid();
    keys(r, ['kind', 'origin_kind', 'origin_id', 'note_revision', 'origin_title', 'captured_at', 'content_sha256', 'authorship', 'scope_snapshot', 'citations']);
    id(r.origin_id);
    text(r.origin_title);
    text(r.captured_at);
    if (!/^[a-f0-9]{64}$/i.test(text(r.content_sha256)))
        invalid();
    if (r.note_revision != null)
        num(r.note_revision, 1);
    parseScope(r.scope_snapshot);
    list(r.citations).forEach(c => parseCitation(c, depth + 1));
    return structuredClone(r) as unknown as EvidenceCitation['provenance'];
}
export function parseCitation(value: unknown, depth = 0): EvidenceCitation {
    const r = rec(value);
    keys(r, ['citation_id', 'independent_support', 'provenance', 'kind', 'source_version_id', 'evidence_id', 'source_title', 'locator', 'quote', 'reference_validity', 'remote_reference']);
    id(r.citation_id);
    if (!['local_evidence', 'remote_text_snapshot', 'remote_unmapped', 'derived_snapshot'].includes(String(r.kind)))
        invalid();
    nullable(r.source_version_id);
    nullable(r.evidence_id);
    nullable(r.source_title);
    text(r.quote);
    text(r.reference_validity);
    if (r.independent_support != null && typeof r.independent_support !== 'boolean')
        invalid();
    if (r.locator != null) {
        const l = rec(r.locator);
        keys(l, ['page_index', 'page_label', 'block_id', 'start_offset', 'end_offset', 'bbox']);
        for (const k of ['page_index', 'start_offset', 'end_offset'])
            if (l[k] != null)
                num(l[k]);
        for (const k of ['page_label', 'block_id'])
            if (l[k] != null)
                text(l[k]);
        if (l.bbox != null && !list(l.bbox).every(v => typeof v === 'number' && Number.isFinite(v)))
            invalid();
    }
    if (r.provenance !== undefined)
        provenance(r.provenance, depth);
    if (r.remote_reference != null)
        rec(r.remote_reference);
    return structuredClone(r) as unknown as EvidenceCitation;
}
export function parseNoteScope(value: unknown): NoteScopeSnapshot { const r = rec(value); return Object.keys(r).length === 0 ? {} : parseScope(r); }
export function parseWorkbenchNote(value: unknown): WorkbenchNote { const r = rec(value); return { id: id(r.id), revision: num(r.revision, 1), ...(r.title === undefined ? {} : { title: nullable(r.title) }), ...(r.content === undefined ? {} : { content: nullable(r.content) }), ...(r.citations === undefined ? {} : { citations: list(r.citations).map(v => parseCitation(v)) }), ...(r.scope_snapshot === undefined ? {} : { scope_snapshot: parseNoteScope(r.scope_snapshot) }) }; }
export type ClassicNote = WorkbenchNote & {
    note_type: string | null;
};
function classic(value: unknown): ClassicNote { const r = rec(value); return { id: id(r.id), revision: num(r.revision, 1), title: nullable(r.title), content: nullable(r.content), note_type: nullable(r.note_type) }; }
export function noteForEditor(value: NoteView): {
    note: WorkbenchNote;
    draft: CreateWorkbenchNoteInput;
    mode: 'personal' | 'classic';
    noteType?: string | null;
} | null {
    try {
        const r = rec(value);
        if (r.provenance !== undefined || r.note_type !== undefined && r.note_type !== null && !['human', 'ai'].includes(String(r.note_type)))
            return null;
        const personal = r.note_id !== undefined || r.citations !== undefined || r.scope_snapshot !== undefined;
        const n = parseWorkbenchNote(value);
        if (personal && (typeof n.title !== 'string' || typeof n.content !== 'string'))
            return null;
        if (personal && (!Array.isArray(n.citations) || !n.scope_snapshot))
            return null;
        return { note: n, draft: { title: n.title ?? '', content: n.content ?? '', citations: n.citations ?? [], ...(n.scope_snapshot ? { scope_snapshot: n.scope_snapshot } : {}) }, mode: personal ? 'personal' : 'classic', ...(!personal ? { noteType: typeof r.note_type === 'string' ? r.note_type : null } : {}) };
    }
    catch {
        return null;
    }
}
export type StudioJobKind = 'portable_export' | 'audio' | 'download';
export type JobBinding = Readonly<{
    notebookId: string;
    operation: StudioJobKind;
    idempotencyKey: string;
    jobId?: string;
}>;
export type StudioJob = Readonly<{
    jobId: string;
    notebookId: string;
    operation: StudioJobKind;
    idempotencyKey: string;
    state: string;
    submissionState: 'not_submitted' | 'confirmed' | 'unknown';
    remoteMayContinue: boolean;
    exportId?: string;
    artifact?: ArtifactView;
    downloaded?: boolean;
}>;
export function parseStudioJob(value: unknown, binding: JobBinding): StudioJob {
    const r = rec(value);
    if (r.notebook_id !== binding.notebookId || r.operation !== binding.operation || r.idempotency_key !== binding.idempotencyKey || (binding.jobId && r.job_id !== binding.jobId) || r.restored_history === true || r.replay_allowed === false)
        invalid();
    const state = id(r.state), submissionState = r.submission_state;
    if (!['not_submitted', 'confirmed', 'unknown'].includes(String(submissionState)))
        invalid();
    const out: StudioJob = { jobId: id(r.job_id), notebookId: binding.notebookId, operation: binding.operation, idempotencyKey: binding.idempotencyKey, state, submissionState: submissionState as StudioJob['submissionState'], remoteMayContinue: r.remote_may_continue === true };
    if (state === 'succeeded') {
        if (submissionState !== 'confirmed' && !(binding.operation === 'download' && submissionState === 'not_submitted'))
            invalid();
        const result = rec(r.result);
        if (binding.operation === 'portable_export') {
            const exportId = resourceId(result.export_id);
            if (result.download_url !== `/api/personal/exports/${exportId}/download`)
                invalid();
            return { ...out, exportId };
        }
        if (typeof result.downloaded !== 'boolean')
            invalid();
        const a = rec(result.artifact);
        if (result.downloaded) {
            const artifact = parseLocalArtifact(a, binding.notebookId);
            return { ...out, downloaded: true, artifact };
        }
        return { ...out, downloaded: false, artifact: parseRemoteArtifact(a) };
    }
    return out;
}
export function parseRemoteArtifact(v: unknown): ArtifactView { const r = rec(v); return { id: id(r.id), title: text(r.title), kind: text(r.kind), status: text(r.status), remote_source_ids: strings(r.remote_source_ids) }; }
export function parseLocalArtifact(v: unknown, notebookId: string): ArtifactView & {
    artifact_id: string;
    notebook_id: string;
    mime_type: string;
    byte_size: number;
    sha256: string;
} {
    const r = rec(v);
    if (r.notebook_id !== notebookId)
        invalid();
    const sha256 = text(r.sha256);
    if (!/^[a-f0-9]{64}$/i.test(sha256))
        invalid();
    return { artifact_id: resourceId(r.artifact_id), notebook_id: notebookId, mime_type: text(r.mime_type), byte_size: num(r.byte_size), sha256, ...(typeof r.title === 'string' ? { title: r.title } : {}), ...(typeof r.kind === 'string' ? { kind: r.kind } : {}) };
}
export interface PortableImport {
    notebook_id: string;
    id_map: Record<string, string>;
    entity_counts: Record<string, number>;
    missing: unknown[];
    warnings: unknown[];
}
export function parsePortableImport(v: unknown, originalNotebookId: string): PortableImport {
    const r = rec(v);
    const notebook_id = id(r.notebook_id);
    if (notebook_id === originalNotebookId)
        invalid();
    const id_map = Object.fromEntries(Object.entries(rec(r.id_map)).map(([old, fresh]) => {
        const next = id(fresh);
        if (next === old)
            invalid();
        return [old, next];
    }));
    const entity_counts = Object.fromEntries(Object.entries(rec(r.entity_counts)).map(([k, v]) => [k, num(v)]));
    return { notebook_id, id_map, entity_counts, missing: structuredClone(list(r.missing)), warnings: structuredClone(list(r.warnings)) };
}
export interface AudioRequest {
    remote_notebook_id: string;
    remote_source_ids: string[];
    source_version_ids?: string[];
    language?: string;
    idempotency_key: string;
}
export const MAX_STUDIO_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export function createStudioApi(transport: WebTransport) {
    const path = (n: string, s: string) => `/personal/notebooks/${encodeURIComponent(n)}/${s}`;
    async function response(method: string, path: string, context: DispatchContext, body?: BodyInit) {
        const c = freezeDispatchContext(context), g = sessionCoordinator.current();
        if (!canDispatch(c, readTurnContext()))
            throw new RequestNotDispatchedError('superseded');
        const r = await transport.send({ method, path, context: c, ...(body === undefined ? {} : { body }) });
        const current = () => canDispatch(c, readTurnContext()) && g === sessionCoordinator.current();
        if (!current()) {
            void r.body?.cancel();
            throw new TransportResponseError('retired');
        }
        return { r, current };
    }
    async function request(method: string, path: string, context: DispatchContext, body?: BodyInit, status?: number) {
        const { r, current } = await response(method, path, context, body);
        const data: unknown = await r.json();
        if (!current())
            throw new TransportResponseError('retired');
        if (!r.ok) {
            const detail = isRecord(data) && isRecord(data.detail) ? data.detail : null;
            if ((r.status === 409 && detail?.code === 'NOTE_REVISION_CONFLICT') || (r.status === 428 && detail?.code === 'NOTE_REVISION_REQUIRED'))
                throw new StudioError('conflict', r.status);
            if ([400, 403, 404, 413, 415, 422].includes(r.status))
                throw new StudioError('rejected', r.status);
            throw new StudioError('invalid', r.status);
        }
        if (status !== undefined && r.status !== status)
            invalid();
        return data;
    }
    async function bytes(path: string, context: DispatchContext, mime: string, size?: number, sha?: string) {
        if (size !== undefined && size > MAX_STUDIO_DOWNLOAD_BYTES)
            throw new StudioError('limit');
        const { r, current } = await response('GET', path, context);
        if (!r.ok) {
            void r.body?.cancel();
            throw new StudioError('invalid');
        }
        const length = r.headers.get('content-length');
        if (r.headers.get('content-type')?.split(';')[0]?.trim() !== mime || length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_STUDIO_DOWNLOAD_BYTES) || !r.body) {
            void r.body?.cancel();
            throw new StudioError('limit');
        }
        const reader = r.body.getReader(), chunks: Uint8Array[] = [];
        let total = 0;
        try {
            while (true) {
                const next = await reader.read();
                if (!current())
                    throw new TransportResponseError('retired');
                if (next.done)
                    break;
                total += next.value.length;
                if (total > MAX_STUDIO_DOWNLOAD_BYTES || size !== undefined && total > size)
                    throw new StudioError('limit');
                chunks.push(next.value);
            }
            if (!total || size !== undefined && total !== size)
                invalid();
            const data = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.length;
            }
            if (sha) {
                const hash = await crypto.subtle.digest('SHA-256', data);
                if (!current())
                    throw new TransportResponseError('retired');
                if (Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') !== sha.toLowerCase())
                    invalid();
            }
            if (!current())
                throw new TransportResponseError('retired');
            return new Blob([data], { type: mime });
        }
        catch (e) {
            await reader.cancel().catch(() => { });
            throw e;
        }
        finally {
            reader.releaseLock();
        }
    }
    return Object.freeze({
        async createNote(n: string, p: CreateWorkbenchNoteInput, c: DispatchContext) {
            const r = rec(await request('POST', path(n, 'notes'), c, JSON.stringify(p)));
            if (r.notebook_id !== n)
                invalid();
            return parseWorkbenchNote(r);
        },
        async updateNote(n: string, noteId: string, p: UpdateWorkbenchNoteInput, c: DispatchContext) {
            const r = rec(await request('PATCH', path(n, `notes/${encodeURIComponent(noteId)}`), c, JSON.stringify(p)));
            if (r.notebook_id !== n || r.id !== noteId)
                invalid();
            return parseWorkbenchNote(r);
        },
        async listClassic(n: string, c: DispatchContext) { return list(await request('GET', `/notes?notebook_id=${encodeURIComponent(n)}`, c)).map(classic); },
        async readClassic(noteId: string, c: DispatchContext) { return classic(await request('GET', `/notes/${encodeURIComponent(noteId)}`, c)); },
        async createClassic(n: string, p: {
            title: string;
            content: string;
            note_type: string;
        }, c: DispatchContext) { return classic(await request('POST', '/notes', c, JSON.stringify({ ...p, notebook_id: n }))); },
        async updateClassic(noteId: string, p: {
            title?: string;
            content?: string;
            expected_revision: number;
        }, c: DispatchContext) {
            const result = classic(await request('PUT', `/notes/${encodeURIComponent(noteId)}`, c, JSON.stringify(p)));
            if (result.id !== noteId)
                invalid();
            return result;
        },
        async deleteClassic(noteId: string, c: DispatchContext) {
            const r = rec(await request('DELETE', `/notes/${encodeURIComponent(noteId)}`, c));
            if (r.message !== 'Note deleted successfully')
                invalid();
        },
        async promote(input: {
            notebookId: string;
            origin: SnapshotOrigin;
            idempotencyKey: string;
        }, c: DispatchContext): Promise<SourceSnapshotResult> {
            const o = input.origin;
            const p = { ...(o.kind === 'note' ? { origin_kind: 'note', note_id: o.id, expected_revision: o.revision } : { origin_kind: 'turn', turn_id: o.id }), idempotency_key: input.idempotencyKey };
            const r = rec(await request('POST', path(input.notebookId, 'source-snapshots'), c, JSON.stringify(p)));
            if (r.status !== 'ready' || r.embedding_status !== 'not_requested' || typeof r.existing !== 'boolean')
                invalid();
            const pr = provenance(r.provenance);
            if (!pr || pr.kind !== 'derived' || pr.origin_kind !== o.kind || pr.origin_id !== o.id || (o.kind === 'note' && pr.note_revision !== o.revision))
                invalid();
            return { source_id: id(r.source_id), source_version_id: id(r.source_version_id), job_id: id(r.job_id), status: 'ready', embedding_status: 'not_requested', existing: r.existing as boolean, provenance: pr as SourceSnapshotResult['provenance'] };
        },
        async exportPortable(n: string, key: string, c: DispatchContext) { return parseStudioJob(await request('POST', path(n, 'exports'), c, JSON.stringify({ idempotency_key: key }), 202), { notebookId: n, operation: 'portable_export', idempotencyKey: key }); },
        async importPortable(file: File, n: string, c: DispatchContext) { const body = new FormData(); body.append('file', file); return parsePortableImport(await request('POST', '/personal/imports/portable', c, body, 201), n); },
        async job(binding: JobBinding & {
            jobId: string;
        }, c: DispatchContext) { return parseStudioJob(await request('GET', `/personal/jobs/${encodeURIComponent(binding.jobId)}`, c), binding); },
        async cancel(binding: JobBinding & {
            jobId: string;
        }, c: DispatchContext) { return parseStudioJob(await request('POST', `/personal/jobs/${encodeURIComponent(binding.jobId)}/cancel`, c), binding); },
        async audio(n: string, p: AudioRequest, c: DispatchContext) { return parseStudioJob(await request('POST', path(n, 'artifacts/audio'), c, JSON.stringify(p)), { notebookId: n, operation: 'audio', idempotencyKey: p.idempotency_key }); },
        async remoteArtifacts(remoteNotebookId: string, c: DispatchContext) { return list(await request('GET', `/personal/notebooklm/notebooks/${encodeURIComponent(remoteNotebookId)}/artifacts`, c)).map(parseRemoteArtifact); },
        async downloadRemote(n: string, remoteNotebookId: string, remoteArtifactId: string, key: string, c: DispatchContext) { return parseStudioJob(await request('POST', `/personal/notebooklm/artifacts/${encodeURIComponent(remoteArtifactId)}/download`, c, JSON.stringify({ notebook_id: n, remote_notebook_id: remoteNotebookId, idempotency_key: key })), { notebookId: n, operation: 'download', idempotencyKey: key }); },
        async capabilities(c: DispatchContext) { const r = rec(await request('GET', '/personal/notebooklm/capabilities', c)); return list(r.operations).map(v => { const o = rec(v); return { name: id(o.name), support: id(o.support) }; }); },
        downloadExport(exportId: string, c: DispatchContext) { return bytes(`/personal/exports/${encodeURIComponent(resourceId(exportId))}/download`, c, 'application/zip'); },
        downloadArtifact(value: ArtifactView, n: string, c: DispatchContext) { const a = parseLocalArtifact(value, n); return bytes(`/personal/artifacts/${encodeURIComponent(a.artifact_id)}/download`, c, a.mime_type, a.byte_size, a.sha256); }
    });
}
export type StudioApi = ReturnType<typeof createStudioApi>;
