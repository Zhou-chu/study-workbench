import { canDispatch, freezeDispatchContext, type DispatchContext } from '@study/domain';
import { defaultKeys, contentKeys, type ContentSettings, type ContentKey, type DefaultKey, type Registration, type Sources, type SourceName, type Provider, type Credential, type PrivateField, type Discovery } from '../../data/configuration-contracts';
export type CredentialForm = Readonly<{
    identity: string;
    credentialRevision: number;
    provider: Provider;
    credential: Credential | null;
    name: string;
    modalities: readonly string[];
    project: string;
    location: string;
    api_version: string;
    num_ctx: string;
    modes: Readonly<Partial<Record<PrivateField, 'keep' | 'set' | 'clear'>>>;
}>;
export type DiscoverySelection = Readonly<{
    value: Discovery;
    credentialRevision: number;
    type: string;
    search: string;
    selected: readonly string[];
    custom: boolean;
}>;
export type ConfigurationKind = 'application' | 'models';
export type ConfigurationIntent = Readonly<{
    kind: 'content';
    changes: ContentSettings;
}> | Readonly<{
    kind: 'defaults';
    field: DefaultKey;
    value: string | null;
    previousValue?: string | null;
}> | Readonly<{
    kind: 'credential-create';
    provider: string;
    fields: readonly string[];
    presence?: Readonly<Record<string, 'set' | 'clear'>>;
}> | Readonly<{
    kind: 'credential-edit';
    id: string;
    provider: string;
    fields: readonly string[];
    presence?: Readonly<Record<string, 'set' | 'clear'>>;
}> | Readonly<{
    kind: 'credential-test' | 'discover';
    id: string;
    provider: string;
}> | Readonly<{
    kind: 'register';
    id: string;
    models: readonly Registration[];
}> | Readonly<{
    kind: 'credential-delete';
    id: string;
    migrateTo: string | null;
    provider?: string;
    modelCount?: number;
    linkedModelIds?: readonly string[];
    defaultSlots?: readonly DefaultKey[];
}> | Readonly<{
    kind: 'model-delete' | 'model-test';
    id: string;
    defaultSlots?: readonly DefaultKey[];
}> | Readonly<{
    kind: 'migrate-env' | 'auto-assign';
}>;
export type ConfigurationToken = Readonly<{
    id: string;
    ownerId: string;
    context: DispatchContext;
    generation: number;
    providerRevision: number;
    controlRevision: number;
    metadataRevision: number;
    intent: ConfigurationIntent;
    fieldRevisions: Readonly<Partial<Record<ContentKey, number>>>;
}>;
export type ConfigurationAttempt = Readonly<{
    token: ConfigurationToken;
    phase: 'pending' | 'confirmed' | 'unknown' | 'not-sent';
    httpStatus?: number;
    result?: Readonly<Record<string, unknown>>;
}>;
export type SourceState = Readonly<{
    phase: 'loading' | 'ready' | 'error';
    revision: number;
}>;
export type ConfigurationDraft = Readonly<{
    id: string;
    kind: ConfigurationKind;
    context: DispatchContext;
    retired: boolean;
    dirty: boolean;
    status: 'editing' | 'pending' | 'unknown' | 'succeeded';
    revision: number;
    metadataRevision: number;
    data: Readonly<Partial<Sources>>;
    sources: Readonly<Partial<Record<SourceName, SourceState>>>;
    fields: ContentSettings;
    fieldRevisions: Readonly<Partial<Record<ContentKey, number>>>;
    form: CredentialForm | null;
    discovery: DiscoverySelection | null;
    attempt: ConfigurationAttempt | null;
    history: readonly ConfigurationAttempt[];
}>;
function freezeIntent(intent: ConfigurationIntent, row: ConfigurationDraft): ConfigurationIntent {
    if (intent.kind === 'defaults')
        return Object.freeze({ ...intent, previousValue: row.data.defaults?.[intent.field] ?? null });
    if (intent.kind === 'credential-delete') {
        const credential = row.data.credentials?.find(c => c.id === intent.id);
        const links = (row.data.models ?? []).filter(model => model.credential === intent.id).map(model => model.id);
        return Object.freeze({ ...intent, ...(credential ? {provider: credential.provider, modelCount: credential.model_count} : {}), linkedModelIds: Object.freeze(links), defaultSlots: Object.freeze(defaultKeys.filter(key => links.includes(row.data.defaults?.[key] ?? ''))) });
    }
    if (intent.kind === 'model-delete')
        return Object.freeze({ ...intent, defaultSlots: Object.freeze(defaultKeys.filter(key => row.data.defaults?.[key] === intent.id)) });
    if (intent.kind === 'content')
        return Object.freeze({ ...intent, changes: Object.freeze({ ...intent.changes }) });
    if (intent.kind === 'register')
        return Object.freeze({ ...intent, models: Object.freeze(intent.models.map(model => Object.freeze({ ...model }))) });
    if (intent.kind === 'credential-create' || intent.kind === 'credential-edit')
        return Object.freeze({ ...intent, fields: Object.freeze([...intent.fields]), presence: Object.freeze({ ...intent.presence }) });
    return Object.freeze({ ...intent });
}
export function createConfigurationStore(notify: () => void) {
    const rows = new Map<string, ConfigurationDraft>();
    const selected = new Map<ConfigurationKind, string>();
    let snapshot: readonly ConfigurationDraft[] = Object.freeze([]);
    const put = (row: ConfigurationDraft) => {
        rows.set(row.id, Object.freeze(row));
        snapshot = Object.freeze([...rows.values()]);
        notify();
    };
    const create = (kind: ConfigurationKind, context: DispatchContext) => {
        const id = 'configuration:' + crypto.randomUUID();
        selected.set(kind, id);
        put({ id, kind, context: freezeDispatchContext(context), retired: false, dirty: false, status: 'editing', revision: 0, metadataRevision: 0, data: {}, sources: {}, fields: {}, fieldRevisions: {}, form: null, discovery: null, attempt: null, history: [] });
        return id;
    };
    const usable = (row: ConfigurationDraft | undefined, current: DispatchContext | null): row is ConfigurationDraft => !!row && !row.retired && canDispatch(row.context, current);
    const blocked = (row: ConfigurationDraft) => [...rows.values()].some(r => r.kind === row.kind && r.context.epoch === row.context.epoch && r.attempt && ['pending', 'unknown'].includes(r.attempt.phase));
    const dirty = (fields: ContentSettings, baseline: ContentSettings | undefined) => contentKeys.some(k => Object.hasOwn(fields, k) && fields[k] !== baseline?.[k]);
    return {
        get: (id: string) => rows.get(id), getSnapshot: () => snapshot,
        open(kind: ConfigurationKind, context: DispatchContext) { return selected.get(kind) ?? (context.ready ? create(kind, context) : null); },
        select(id: string) { const row = rows.get(id); if (!row)
            return false; selected.set(row.kind, id); return true; },
        fresh(id: string, current: DispatchContext) {
            const row = rows.get(id);
            if (!row?.retired || !current.ready)
                return null;
            const live = [...rows.values()].find(r => r.kind === row.kind && usable(r, current));
            if (live) {
                selected.set(row.kind, live.id);
                return live.id;
            }
            return create(row.kind, current);
        },
        invalidate(id: string) { const r = rows.get(id); if (r && !r.retired)
            put({ ...r, metadataRevision: r.metadataRevision + 1 }); },
        setForm(id: string, form: CredentialForm | null) { const r = rows.get(id); if (r && !r.retired)
            put({ ...r, form, dirty: !!form, revision: r.revision + 1 }); },
        setDiscovery(id: string, discovery: DiscoverySelection) { const r = rows.get(id); if (r && !r.retired)
            put({ ...r, discovery, revision: r.revision + 1, metadataRevision: r.metadataRevision + 1 }); },
        touch(id: string) { const r = rows.get(id); if (r && !r.retired)
            put({ ...r, revision: r.revision + 1 }); },
        edit(id: string, key: ContentKey, value: string | boolean) {
            const r = rows.get(id);
            if (!r || r.retired)
                return;
            const fields = Object.freeze({ ...r.fields, [key]: value });
            put({ ...r, fields, fieldRevisions: Object.freeze({ ...r.fieldRevisions, [key]: (r.fieldRevisions[key] ?? 0) + 1 }), revision: r.revision + 1, dirty: dirty(fields, r.data.content) });
        },
        loading(id: string, name: SourceName) {
            const r = rows.get(id);
            if (!r || r.retired)
                return null;
            const revision = (r.sources[name]?.revision ?? 0) + 1;
            put({ ...r, metadataRevision: r.metadataRevision + 1, sources: Object.freeze({ ...r.sources, [name]: { phase: 'loading', revision } }) });
            return revision;
        },
        publish<K extends SourceName>(id: string, name: K, revision: number, value: Sources[K] | null) {
            const r = rows.get(id);
            if (!r || r.retired || r.sources[name]?.revision !== revision)
                return;
            const data = value === null ? r.data : Object.freeze({ ...r.data, [name]: value });
            put({ ...r, data, metadataRevision: r.metadataRevision + 1, sources: Object.freeze({ ...r.sources, [name]: { phase: value === null ? 'error' : 'ready', revision } }), dirty: !!r.form || dirty(r.fields, data.content) });
        },
        capture(id: string, intent: ConfigurationIntent, current: DispatchContext | null, generation: number, providerRevision: number): ConfigurationToken | null {
            const r = rows.get(id);
            if (!usable(r, current) || blocked(r))
                return null;
            return Object.freeze({ id: crypto.randomUUID(), ownerId: id, context: r.context, generation, providerRevision, controlRevision: r.revision, metadataRevision: r.metadataRevision, intent: freezeIntent(intent, r), fieldRevisions: r.fieldRevisions });
        },
        canBegin(token: ConfigurationToken, current: DispatchContext | null, generation: number, providerRevision: number) {
            const r = rows.get(token.ownerId);
            return usable(r, current) && !blocked(r) && r.revision === token.controlRevision && r.metadataRevision === token.metadataRevision && generation === token.generation && providerRevision === token.providerRevision;
        },
        begin(token: ConfigurationToken, current: DispatchContext | null, generation: number, providerRevision: number) {
            if (!this.canBegin(token, current, generation, providerRevision))
                return false;
            const r = rows.get(token.ownerId)!;
            put({ ...r, metadataRevision: r.metadataRevision + 1, attempt: Object.freeze({ token, phase: 'pending' }), status: 'pending', history: Object.freeze([...r.history, ...(r.attempt ? [r.attempt] : [])]) });
            return true;
        },
        settle(token: ConfigurationToken, phase: ConfigurationAttempt['phase'], current: DispatchContext | null, generation: number, result?: Readonly<Record<string, unknown>>, httpStatus?: number) {
            const r = rows.get(token.ownerId);
            if (!r || r.attempt?.token !== token || r.attempt.phase !== 'pending')
                return false;
            const actual = usable(r, current) && generation === token.generation ? phase : 'unknown';
            let data = r.data, fields = r.fields;
            if (actual === 'confirmed' && token.intent.kind === 'content' && result) {
                const baseline = result as ContentSettings;
                data = Object.freeze({ ...data, content: baseline });
                const next = { ...fields };
                for (const k of contentKeys)
                    if ((r.fieldRevisions[k] ?? 0) === (token.fieldRevisions[k] ?? 0))
                        delete next[k];
                fields = Object.freeze(next);
            }
            put({ ...r, data, fields, metadataRevision: r.metadataRevision + 1, dirty: !!r.form || dirty(fields, data.content), status: actual === 'unknown' ? 'unknown' : actual === 'confirmed' ? 'succeeded' : 'editing', attempt: Object.freeze({ token, phase: actual, ...(result ? { result } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}) }) });
            return actual === 'confirmed';
        },
        retire(epoch: number) {
            for (const r of rows.values())
                if (r.context.epoch === epoch) {
                    const attempt = r.attempt?.phase === 'pending' ? Object.freeze({ ...r.attempt, phase: 'unknown' as const }) : r.attempt;
                    put({ ...r, retired: true, attempt, status: attempt?.phase === 'unknown' ? 'unknown' : r.status });
                }
        },
        hasUnsaved: () => [...rows.values()].some(r => r.dirty || ['pending', 'unknown'].includes(r.status)),
        locked: (id: string) => { const r = rows.get(id); return !r || r.retired || blocked(r); }
    };
}
