import { isRecord, parseSourceVersionView, type SourceVersionView, type EvidenceCitationView } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, TransportResponseError, type DispatchContext, type WebTransport } from '@study/web-transport';
export interface ReaderRequest {
    notebookId: string;
    source_version_id: string;
    evidence_id: string | null;
    extraction_id: string | null;
}
export interface ReaderLocator {
    page_index?: number;
    page_label?: string;
    block_id?: string;
    start_offset?: number;
    end_offset?: number;
}
export interface ReaderBlock {
    block_id: string;
    page_index: number | null;
    text: string;
}
export interface ReaderEvidence {
    provenance?: SourceVersionView['provenance'];
    independent_support?: EvidenceCitationView['independent_support'];
    evidence_id: string;
    source_version_id: string;
    extraction_id: string;
    quote: string;
    locator: ReaderLocator;
    reference_validity: string | null;
}
export interface ReaderExtraction {
    extraction_id: string;
    source_version_id: string;
    status: string;
    page_count: number | null;
    text: string;
    blocks: ReaderBlock[];
    verification_origin: string | null;
}
export interface ReaderDetail {
    retainedMarkdown: boolean | null;
    version: SourceVersionView & {
        source_version_id: string;
        notebook_id: string;
    };
    extraction: ReaderExtraction | null;
    evidence: ReaderEvidence[];
}
export class EvidenceReadError extends Error {
    constructor(readonly reason: 'unavailable' | 'missing' | 'invalid' | 'interrupted') { super('Evidence read unavailable'); }
}
const invalid = (): never => { throw new EvidenceReadError('invalid'); };
const record = (v: unknown): Record<string, unknown> => isRecord(v) ? v : invalid();
const string = (v: unknown): string => typeof v === 'string' ? v : invalid();
const id = (v: unknown): string => typeof v === 'string' && !!v.trim() && v.length <= 2048 ? v : invalid();
const integer = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
export function parseReaderLocator(value: unknown): ReaderLocator { const r = record(value), out: ReaderLocator = {}; for (const key of ['page_index', 'start_offset', 'end_offset'] as const)
    if (r[key] != null)
        out[key] = integer(r[key]); for (const key of ['page_label', 'block_id'] as const)
    if (r[key] != null)
        out[key] = string(r[key]); return out; }
/** F29 client projection only: this does not sanitize the legacy endpoint's wire. */
export function parseReaderDetail(value: unknown, expected: ReaderRequest): ReaderDetail {
    const r = record(value), version = parseSourceVersionView(r.version);
    if (record(r.version).projection_status != null || version.source_version_id !== expected.source_version_id || version.notebook_id !== expected.notebookId)
        return invalid();
    let extraction: ReaderExtraction | null = null;
    if (r.extraction != null) {
        const e = record(r.extraction);
        if (e.source_version_id !== expected.source_version_id || expected.extraction_id && e.extraction_id !== expected.extraction_id || !Array.isArray(e.blocks))
            return invalid();
        const blocks = e.blocks.map(v => { const b = record(v); return { block_id: id(b.block_id), page_index: b.page_index == null ? null : integer(b.page_index), text: string(b.text) }; });
        if (new Set(blocks.map(b => b.block_id)).size !== blocks.length)
            return invalid();
        extraction = { extraction_id: id(e.extraction_id), source_version_id: id(e.source_version_id), status: string(e.status), page_count: e.page_count == null ? null : integer(e.page_count), text: e.text == null ? '' : string(e.text), blocks, verification_origin: typeof e.verification_origin === 'string' ? e.verification_origin : null };
        if (extraction.page_count !== null && blocks.some(b => b.page_index !== null && b.page_index >= extraction!.page_count!))
            return invalid();
    }
    if (expected.extraction_id && !extraction)
        throw new EvidenceReadError('unavailable');
    if (!Array.isArray(r.evidence))
        return invalid();
    const evidence = r.evidence.map(v => { const e = record(v); if (!extraction || e.source_version_id !== expected.source_version_id || e.extraction_id !== extraction.extraction_id)
        return invalid(); return { ...(e.provenance === undefined ? {} : {provenance: parseSourceVersionView({provenance:e.provenance}).provenance}), ...(e.independent_support === undefined ? {} : {independent_support: typeof e.independent_support === 'boolean' || e.independent_support === null ? e.independent_support : {projection_status:'invalid' as const}}), evidence_id: id(e.evidence_id), source_version_id: id(e.source_version_id), extraction_id: id(e.extraction_id), quote: string(e.quote), locator: parseReaderLocator(e.locator), reference_validity: typeof e.reference_validity === 'string' ? e.reference_validity : null }; });
    if (new Set(evidence.map(e => e.evidence_id)).size !== evidence.length)
        return invalid();
    if (expected.evidence_id && !evidence.some(e => e.evidence_id === expected.evidence_id))
        throw new EvidenceReadError('unavailable');
    // F52 presence-only projection after every requested identity has been checked.
    // The raw path is deliberately neither retained nor exposed.
    const rawVersion = record(r.version), origin = rawVersion.origin, mime = rawVersion.mime_type;
    let retainedMarkdown: boolean | null = null;
    if (typeof origin === 'string' && ['upload', 'pasted_text', 'remote_text_snapshot', 'derived_snapshot', 'web_snapshot'].includes(origin) &&
        typeof mime === 'string' && ['text/plain', 'text/markdown', 'application/pdf'].includes(mime)) {
        if (origin !== 'web_snapshot' || mime !== 'text/markdown') retainedMarkdown = false;
        else if (rawVersion.file_path === null || rawVersion.file_path === '') retainedMarkdown = false;
        else if (typeof rawVersion.file_path === 'string' && rawVersion.file_path.trim().length > 0 &&
            !/[\x00-\x1f\x7f]/.test(rawVersion.file_path)) retainedMarkdown = true;
    }
    return { retainedMarkdown, version: { ...version, source_version_id: expected.source_version_id, notebook_id: expected.notebookId }, extraction, evidence };
}
export const MAX_ORIGINAL_BYTES = 64 * 1024 * 1024;
const MAX_DETAIL_BYTES = 16 * 1024 * 1024;
export function createEvidenceApi(transport: WebTransport) {
    function fence(context: DispatchContext, generation: number, signal?: AbortSignal) { if (signal?.aborted || !canDispatch(context, readTurnContext()) || generation !== sessionCoordinator.current())
        throw new TransportResponseError('retired'); }
    async function response(path: string, context: DispatchContext, generation: number, signal?: AbortSignal) { fence(context, generation, signal); const r = await transport.send({ method: 'GET', path, context, ...(signal ? { signal } : {}) }); try {
        fence(context, generation, signal);
    }
    catch (e) {
        void r.body?.cancel();
        throw e;
    } if (!r.ok) {
        void r.body?.cancel();
        throw new EvidenceReadError(r.status === 404 ? 'unavailable' : 'interrupted');
    } return r; }
    async function readBounded(r: Response, limit: number, context: DispatchContext, generation: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
        const header = r.headers.get('content-length');
        if (header !== null && (!/^\d+$/.test(header) || Number(header) > limit)) {
            void r.body?.cancel();
            throw new EvidenceReadError('invalid');
        }
        if (!r.body)
            throw new EvidenceReadError('interrupted');
        const reader = r.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        const abort = () => { void reader.cancel(); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            while (true) {
                fence(context, generation, signal);
                const next = await reader.read();
                fence(context, generation, signal);
                if (next.done)
                    break;
                size += next.value.byteLength;
                if (size > limit)
                    throw new EvidenceReadError('invalid');
                chunks.push(next.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) {
                bytes.set(part, offset);
                offset += part.length;
            }
            return bytes;
        }
        catch (error) {
            await reader.cancel().catch(() => { });
            if (error instanceof TransportResponseError || error instanceof EvidenceReadError)
                throw error;
            throw new EvidenceReadError('interrupted');
        }
        finally {
            signal?.removeEventListener('abort', abort);
            reader.releaseLock();
        }
    }
    return Object.freeze({
        async detail(input: ReaderRequest, context: DispatchContext, generation: number, signal?: AbortSignal): Promise<ReaderDetail> { const c = freezeDispatchContext(context), q = new URLSearchParams(); if (input.evidence_id)
            q.set('evidence_id', input.evidence_id); if (input.extraction_id)
            q.set('extraction_id', input.extraction_id); const r = await response(`/personal/source-versions/${encodeURIComponent(input.source_version_id)}${q.size ? '?' + q.toString() : ''}`, c, generation, signal); const bytes = await readBounded(r, MAX_DETAIL_BYTES, c, generation, signal); let value: unknown; try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        }
        catch {
            throw new EvidenceReadError('invalid');
        } fence(c, generation, signal); return parseReaderDetail(value, input); },
        async download(version: SourceVersionView, context: DispatchContext, generation: number, signal?: AbortSignal): Promise<Blob> { const c = freezeDispatchContext(context), versionId = id(version.source_version_id), size = integer(version.byte_size), mime = string(version.mime_type), sha = string(version.sha256); if (size > MAX_ORIGINAL_BYTES || !['application/pdf', 'text/plain', 'text/markdown'].includes(mime) || !/^([a-f0-9]{64})$/i.test(sha))
            throw new EvidenceReadError('invalid'); let r: Response; try {
            r = await response(`/personal/source-versions/${encodeURIComponent(versionId)}/download`, c, generation, signal);
        }
        catch (e) {
            if (e instanceof EvidenceReadError && e.reason === 'unavailable')
                throw new EvidenceReadError('missing');
            throw e;
        } if (r.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== mime) {
            void r.body?.cancel();
            throw new EvidenceReadError('invalid');
        } const bytes = await readBounded(r, size, c, generation, signal); if (bytes.length !== size)
            throw new EvidenceReadError('interrupted'); if (mime === 'application/pdf' && new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
            throw new EvidenceReadError('invalid'); if (mime !== 'application/pdf') {
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            }
            catch {
                throw new EvidenceReadError('invalid');
            }
        } const hash = await crypto.subtle.digest('SHA-256', bytes); fence(c, generation, signal); if (Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') !== sha.toLowerCase())
            throw new EvidenceReadError('invalid'); return new Blob([bytes], { type: mime }); }
    });
}
export type EvidenceApi = ReturnType<typeof createEvidenceApi>;
