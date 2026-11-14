import { isRecord } from '@study/contracts';
import { captureEmbeddingDisclosure } from '@study/domain';

const bad = (): never => { throw new Error('Invalid semantic evidence'); };
export const object = (v: unknown): Record<string, unknown> => isRecord(v) ? v : bad();
export const text = (v: unknown, maximum = 512): string =>
    typeof v === 'string' && v.length > 0 && v.length <= maximum && !/[\x00-\x1f\x7f]/.test(v) ? v : bad();
export const identity = (v: unknown): string => {
    const s = text(v);
    return /[/\\%?#]/.test(s) || !s.trim() ? bad() : s;
};
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : bad();
const digest = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : bad();
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : bad();
const string = (v: unknown): string => typeof v === 'string' ? v : bad();
const flag = (v: unknown): boolean => typeof v === 'boolean' ? v : bad();
const flags = (r: Record<string, unknown>) => {
    if (r.retry_safe !== false || r.remote_cancel_confirmed !== false || r.restored_history !== undefined && r.restored_history !== false || r.replay_allowed !== undefined && typeof r.replay_allowed !== 'boolean' || r.projection_status != null) bad();
};
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const equalSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every(v => b.includes(v));
export function versions(value: readonly string[]): readonly string[] {
    if (value.length < 1 || value.length > 20 || new Set(value).size !== value.length) return bad();
    return Object.freeze(value.map(identity));
}
export type SemanticProfile = Readonly<{
    profile_id: string; model_id: string; provider: string; model_name: string; revision: string;
    endpoint: string; credential_binding_id: string; dimension: number; document_prefix: string;
    query_prefix: string; preprocessing_revision: string; max_input_bytes: number; cosine_min_score: number;
    destination_descriptor_version: string; destination_kind: string; fingerprint: string; endpoint_fingerprint: string;
}>;
export function parseProfile(value: unknown): SemanticProfile {
    const r = object(value), endpoint = text(r.endpoint, 2048);
    const u = new URL(endpoint);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return bad();
    const dimension = integer(r.dimension, 4096), max_input_bytes = integer(r.max_input_bytes);
    if (!dimension || !max_input_bytes || r.preprocessing_revision !== 'evidence-identity-v1' ||
        typeof r.cosine_min_score !== 'number' || !Number.isFinite(r.cosine_min_score) || Math.abs(r.cosine_min_score) > 1) return bad();
    return Object.freeze({
        profile_id: text(r.profile_id), model_id: text(r.model_id), provider: text(r.provider),
        model_name: text(r.model_name), revision: text(r.revision), endpoint,
        credential_binding_id: text(r.credential_binding_id), dimension, document_prefix: string(r.document_prefix),
        query_prefix: string(r.query_prefix), preprocessing_revision: r.preprocessing_revision,
        max_input_bytes, cosine_min_score: r.cosine_min_score,
        destination_descriptor_version: text(r.destination_descriptor_version), destination_kind: text(r.destination_kind),
        fingerprint: digest(r.fingerprint), endpoint_fingerprint: digest(r.endpoint_fingerprint),
    });
}
export function disclosure(profile: SemanticProfile) {
    const kind = profile.destination_kind;
    if (kind !== 'on_device' && kind !== 'remote' && kind !== 'unknown') return null;
    return captureEmbeddingDisclosure({ ...profile, destination_kind: kind });
}
export type Scope = Readonly<{ notebook_id: string; entries: readonly Readonly<{
    version_id: string; extraction_id: string; manifest_hash: string; scope_epoch: number;
}>[] }>;
export function parseScope(value: unknown, notebook: string, selected: readonly string[]): Scope {
    const r = object(value);
    if (r.notebook_id !== notebook) return bad();
    const entries = list(r.entries).map(v => {
        const e = object(v);
        return Object.freeze({ version_id: identity(e.version_id), extraction_id: identity(e.extraction_id),
            manifest_hash: digest(e.manifest_hash), scope_epoch: integer(e.scope_epoch) });
    });
    if (!equalSet(entries.map(e => e.version_id), versions(selected))) return bad();
    return Object.freeze({ notebook_id: notebook, entries: Object.freeze(entries) });
}
export type SemanticStatus = Readonly<{ notebook_id: string; snapshot: Scope; enabled: boolean;
    profiles: readonly Readonly<{ profile: SemanticProfile; state: string; recognized: boolean }>[]; jobs: readonly ChildStatus[] }>;
export type Preview = Readonly<{ snapshot: Scope; profile: SemanticProfile; preview_hash: string;
    evidence_count: number; input_bytes: number; warnings: readonly string[] }>;
export function parseStatus(value: unknown, notebook: string, selected: readonly string[]): SemanticStatus {
    const r = object(value); flags(r);
    if (r.notebook_id !== notebook) return bad();
    const profiles = list(r.profiles).map(v => {
        const p = object(v), state = text(object(p.index).state);
        return Object.freeze({ profile: parseProfile(p.profile), state, recognized: ['ready', 'stale', 'not_indexed'].includes(state) });
    });
    if (new Set(profiles.map(p => p.profile.profile_id)).size !== profiles.length) return bad();
    return Object.freeze({ notebook_id: notebook, snapshot: parseScope(r.snapshot, notebook, selected), enabled: flag(r.enabled),
        profiles: Object.freeze(profiles), jobs: Object.freeze(list(r.jobs).map(parseChild)) });
}
export function parsePreview(value: unknown, notebook: string, selected: readonly string[], profile: SemanticProfile): Preview {
    const r = object(value), current = parseProfile(r.profile);
    if (!same(current, profile)) return bad();
    return Object.freeze({ snapshot: parseScope(r.snapshot, notebook, selected), profile: current,
        preview_hash: digest(r.preview_hash), evidence_count: integer(r.evidence_count, 5000),
        input_bytes: integer(r.input_bytes), warnings: Object.freeze(list(r.warnings).map(v => text(v, 2048))) });
}
export const states = ['queued', 'running', 'succeeded', 'failed', 'submission_unknown', 'cancelled_local'] as const;
export type JobState = typeof states[number];
const state = (v: unknown): JobState => states.includes(v as JobState) ? v as JobState : bad();
export type ChildStatus = Readonly<{ job_id: string; source_version_id: string | null; state: JobState;
    stage: string; completed_evidence: number; total_evidence: number; errorCode: string | null;
    retry_safe: false; remote_cancel_confirmed: false }>;
export function parseChild(value: unknown): ChildStatus {
    const r = object(value); flags(r);
    const completed_evidence = integer(r.completed_evidence), total_evidence = integer(r.total_evidence);
    if (completed_evidence > total_evidence || r.replay_allowed === false) return bad();
    const code = r.error === null ? null : object(r.error).code;
    return Object.freeze({ job_id: identity(r.job_id), source_version_id: r.source_version_id === null ? null : identity(r.source_version_id),
        state: state(r.state), stage: text(r.stage), completed_evidence, total_evidence,
        errorCode: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(code) ? code : null,
        retry_safe: false, remote_cancel_confirmed: false });
}
export type IndexRequest = Readonly<{ source_version_ids: readonly string[]; profile_id: string; preview_hash: string;
    acknowledge_external_processing: boolean; idempotency_key: string; retry_of_job_id: string | null;
    acknowledge_duplicate_embedding_cost: boolean }>;
export type IndexReceipt = Readonly<{ group_id: string; notebook_id: string; profile_id: string; profile_fingerprint: string;
    preview_hash: string; job_ids: readonly string[]; jobs: readonly ChildStatus[]; state: JobState;
    retry_safe: false; remote_cancel_confirmed: false }>;
export function parseReceipt(value: unknown, preview: Preview, original?: IndexReceipt): IndexReceipt {
    const r = object(value); flags(r);
    if (r.notebook_id !== preview.snapshot.notebook_id || r.profile_id !== preview.profile.profile_id ||
        r.profile_fingerprint !== preview.profile.fingerprint || r.preview_hash !== preview.preview_hash) return bad();
    const job_ids = list(r.job_ids).map(identity), jobs = list(r.jobs).map(parseChild), group_id = identity(r.group_id);
    if (job_ids.includes(group_id) || !equalSet(job_ids, jobs.map(j => j.job_id)) ||
        !equalSet(jobs.map(j => j.source_version_id ?? ''), preview.snapshot.entries.map(e => e.version_id)) ||
        jobs.reduce((n, j) => n + j.total_evidence, 0) !== preview.evidence_count) return bad();
    if (original && (original.group_id !== group_id || !equalSet(original.job_ids, job_ids) ||
        jobs.some(j => {
            const owned = original.jobs.find(o => o.job_id === j.job_id);
            return !owned || owned.source_version_id !== j.source_version_id || owned.total_evidence !== j.total_evidence;
        }))) return bad();
    const lifecycle = state(r.state);
    if (lifecycle === 'succeeded' && jobs.some(j => j.state !== 'succeeded' || j.completed_evidence !== j.total_evidence)) return bad();
    return Object.freeze({ group_id, notebook_id: preview.snapshot.notebook_id, profile_id: preview.profile.profile_id,
        profile_fingerprint: preview.profile.fingerprint, preview_hash: preview.preview_hash,
        job_ids: Object.freeze(job_ids), jobs: Object.freeze(jobs), state: lifecycle, retry_safe: false, remote_cancel_confirmed: false });
}

/** The producer's digest uses sorted keys, UTF-8 and Python JSON's default spaces. */
export async function producerHash(value: unknown): Promise<string> {
    const encode = (v: unknown): string => Array.isArray(v) ? '[' + v.map(encode).join(', ') + ']' :
        isRecord(v) ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ': ' + encode(v[k])).join(', ') + '}' : JSON.stringify(v);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encode(value)));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
export type IndexOwned = Readonly<{ preview: Preview; request: IndexRequest; receipt: IndexReceipt }>;
export async function parseIndexJob(value: unknown, owned: IndexOwned, jobId: string): Promise<IndexReceipt | ChildStatus> {
    const r = object(value), { preview, request, receipt } = owned;
    flags(r);
    if (r.job_id !== jobId || r.notebook_id !== preview.snapshot.notebook_id || r.restored_history === true || r.projection_status != null ||
        r.request_hash !== await producerHash({ notebook_id: preview.snapshot.notebook_id, ...request })) return bad();
    if (jobId === receipt.group_id) {
        if (r.operation !== 'index_evidence_group' || r.group_id !== jobId || r.replay_allowed !== false ||
            !equalSet(list(r.version_ids).map(identity), request.source_version_ids) ||
            !equalSet(list(r.job_ids).map(identity), receipt.job_ids)) return bad();
        // Only this already acknowledged live original group has the false-flag exception.
        parseReceipt(r.receipt, preview, receipt);
        return parseReceipt({ ...object(r.receipt), state: r.state, jobs: r.jobs,
            retry_safe: r.retry_safe, remote_cancel_confirmed: r.remote_cancel_confirmed }, preview, receipt);
    }
    const original = receipt.jobs.find(j => j.job_id === jobId), entry = preview.snapshot.entries.find(e => e.version_id === original?.source_version_id);
    if (!original || !entry || r.operation !== 'index_evidence' || r.group_id !== receipt.group_id || r.replay_allowed === false ||
        r.source_version_id !== entry.version_id || r.extraction_id !== entry.extraction_id ||
        r.profile_id !== request.profile_id || r.profile_fingerprint !== preview.profile.fingerprint ||
        r.disclosed_profile_fingerprint !== preview.profile.fingerprint ||
        r.destination_descriptor_version !== preview.profile.destination_descriptor_version ||
        r.preview_hash !== request.preview_hash || r.idempotency_key !== request.idempotency_key ||
        !same(parseScope(r.scope_snapshot, preview.snapshot.notebook_id, request.source_version_ids), preview.snapshot) ||
        !same(parseScope(r.version_snapshot, preview.snapshot.notebook_id, [entry.version_id]).entries[0], entry)) return bad();
    const rawRequest = object(r.request_snapshot);
    if (!same(Object.keys(rawRequest).sort(), Object.keys(request).sort()) ||
        Object.keys(request).some(k => !same(rawRequest[k], request[k as keyof IndexRequest]))) return bad();
    // Stored profile intentionally omits computed fingerprints.
    const p = object(r.profile);
    for (const [key, v] of Object.entries(preview.profile))
        if (!['fingerprint', 'endpoint_fingerprint'].includes(key) && !same(p[key], v)) return bad();
    if (!['not_submitted', 'confirmed', 'unknown'].includes(String(r.submission_state))) return bad();
    const child = parseChild({ ...r, error: r.error ?? null });
    if (child.state === 'succeeded' && (r.submission_state !== 'confirmed' || child.completed_evidence !== child.total_evidence ||
        object(r.result).state !== 'ready' || object(r.result).attempt_id !== jobId)) return bad();
    if (child.total_evidence !== original.total_evidence) return bad();
    return child;
}
export type MaintenanceRequest = Readonly<{ notebookId: string; versionId: string; extractionId: string | null;
    operation: 'reparse' | 'revalidate'; idempotency_key: string }>;
export type MaintenanceJob = Readonly<{ job_id: string; state: JobState; fresh_extraction_id: string;
    request_hash: string; result: Readonly<{ checked_count: number; verified_count: number; unverified_count: number }> |
        Readonly<{ extraction_id: string; evidence_count: number; status: string }> | null }>;
export async function parseMaintenance(value: unknown, original: MaintenanceRequest, jobId?: string): Promise<MaintenanceJob> {
    const r = object(value), hash = await producerHash({ operation: original.operation, extraction_id: original.extractionId });
    if (r.notebook_id !== original.notebookId || r.source_version_id !== original.versionId ||
        r.operation !== original.operation || r.extraction_id !== original.extractionId ||
        r.idempotency_key !== original.idempotency_key || r.request_hash !== hash ||
        r.restored_history !== undefined && r.restored_history !== false || r.replay_allowed !== undefined && r.replay_allowed !== true || r.projection_status != null ||
        r.remote_may_continue !== false || jobId && r.job_id !== jobId) return bad();
    const fresh_extraction_id = identity(r.fresh_extraction_id), lifecycle = state(r.state);
    let result: MaintenanceJob['result'] = null;
    if (lifecycle === 'succeeded') {
        const x = object(r.result);
        if (x.source_version_id !== original.versionId) return bad();
        if (original.operation === 'revalidate') {
            if (x.extraction_id !== original.extractionId || x.fresh_extraction_id !== fresh_extraction_id) return bad();
            const checked_count = integer(x.checked_count), verified_count = integer(x.verified_count), unverified_count = integer(x.unverified_count);
            if (verified_count + unverified_count !== checked_count) return bad();
            result = Object.freeze({ checked_count, verified_count, unverified_count });
        } else {
            if (x.extraction_id !== fresh_extraction_id) return bad();
            result = Object.freeze({ extraction_id: fresh_extraction_id, status: text(x.status), evidence_count: integer(x.evidence_count) });
        }
    }
    return Object.freeze({ job_id: identity(r.job_id), state: lifecycle, fresh_extraction_id, request_hash: hash, result });
}
export function indexBody(input: IndexRequest): IndexRequest {
    if (input.retry_of_job_id === null ? input.acknowledge_duplicate_embedding_cost !== false :
        input.source_version_ids.length !== 1 || input.acknowledge_duplicate_embedding_cost !== true) return bad();
    if (!text(input.profile_id) || !digest(input.preview_hash) || !text(input.idempotency_key, 200)) return bad();
    return Object.freeze({ source_version_ids: versions(input.source_version_ids), profile_id: input.profile_id,
        preview_hash: input.preview_hash, acknowledge_external_processing: flag(input.acknowledge_external_processing),
        idempotency_key: input.idempotency_key, retry_of_job_id: input.retry_of_job_id === null ? null : identity(input.retry_of_job_id),
        acknowledge_duplicate_embedding_cost: flag(input.acknowledge_duplicate_embedding_cost) });
}
