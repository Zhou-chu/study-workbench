import { isRecord } from '@study/contracts';
export const contentKeys = [
    'default_content_processing_engine_doc', 'default_content_processing_engine_url',
    'default_embedding_option', 'auto_delete_files', 'docling_ocr',
    'docling_formulas', 'docling_vision'
] as const;
export type ContentKey = typeof contentKeys[number];
export type ContentSettings = Readonly<Partial<Record<ContentKey, string | boolean | null>>>;
export const contentChoices = {
    default_content_processing_engine_doc: ['auto', 'docling', 'simple'],
    default_content_processing_engine_url: ['auto', 'firecrawl', 'jina', 'crawl4ai', 'simple'],
    default_embedding_option: ['ask', 'always', 'never'],
    auto_delete_files: ['yes', 'no']
} as const;
export const supportedProviders = ['openai', 'anthropic', 'google', 'groq', 'mistral', 'deepseek', 'xai', 'openrouter', 'dashscope', 'minimax', 'novita', 'siliconflow', 'zai', 'ppq', 'cohere', 'voyage', 'elevenlabs', 'deepgram', 'ollama', 'omlx', 'azure', 'vertex', 'openai_compatible', 'anthropic_compatible'] as const;
export const modelTypes = ['language', 'embedding', 'text_to_speech', 'speech_to_text'] as const;
export type ModelType = typeof modelTypes[number];
export const defaultTypes = {
    default_chat_model: 'language', default_embedding_model: 'embedding',
    default_text_to_speech_model: 'text_to_speech', default_speech_to_text_model: 'speech_to_text',
    default_transformation_model: 'language', default_tools_model: 'language', large_context_model: 'language'
} as const;
export type DefaultKey = keyof typeof defaultTypes;
export type Defaults = Readonly<Record<DefaultKey, string | null>>;
export const defaultKeys = Object.keys(defaultTypes) as DefaultKey[];
export const requiredDefaults: readonly DefaultKey[] = ['default_chat_model', 'default_embedding_model'];
export const privateFields = ['base_url', 'endpoint', 'endpoint_llm', 'endpoint_embedding', 'endpoint_stt', 'endpoint_tts', 'credentials_path'] as const;
export type PrivateField = typeof privateFields[number];
export type Presence = 'absent' | 'null' | 'present';
export type Provider = Readonly<{
    name: string;
    display_name: string;
    modalities: readonly string[];
    docs_url: string | null;
    env_configured: boolean;
}>;
export type Credential = Readonly<{
    id: string;
    name: string;
    provider: string;
    modalities: readonly string[];
    presence: Readonly<Record<PrivateField, Presence>>;
    project: string | null;
    location: string | null;
    api_version: string | null;
    num_ctx: number | null;
    has_api_key: boolean;
    model_count: number;
    decryption_problem: boolean;
    created: string;
    updated: string;
}>;
export type Model = Readonly<{
    id: string;
    name: string;
    provider: string;
    type: string;
    credential: string | null;
    created: string;
    updated: string;
}>;
export type Discovery = Readonly<{
    credential_id: string;
    provider: string;
    discovered: readonly Readonly<{
        name: string;
        provider: string;
        model_type?: string | null;
    }>[];
}>;
export type Registration = Readonly<{
    name: string;
    provider: string;
    model_type: ModelType;
}>;
export type SafeTest = Readonly<{
    success: boolean;
    details_present: boolean;
}>;
export type WebStatus = Readonly<{
    state: string;
    configured: boolean;
    access_mode: string | null;
    trial: boolean;
}>;
export type Capabilities = Readonly<{
    docling_available: boolean;
    crawl4ai_available: boolean;
    crawl4ai_remote_configured: boolean;
}>;
export type Sources = {
    content: ContentSettings;
    capabilities: Capabilities;
    web: WebStatus;
    providers: readonly Provider[];
    credentials: readonly Credential[];
    models: readonly Model[];
    defaults: Defaults;
};
export type SourceName = keyof Sources;
export type CredentialWrite = {
    name?: string;
    provider?: string;
    modalities?: readonly string[];
    api_key?: string;
    base_url?: string | null;
    endpoint?: string | null;
    endpoint_llm?: string | null;
    endpoint_embedding?: string | null;
    endpoint_stt?: string | null;
    endpoint_tts?: string | null;
    credentials_path?: string | null;
    api_version?: string | null;
    project?: string | null;
    location?: string | null;
    num_ctx?: number | null;
};
const record = (value: unknown) => { if (!isRecord(value))
    throw Error('Invalid configuration response'); return value; };
const text = (value: unknown): string => { if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u001f]/.test(value))
    throw Error('Invalid configuration text'); return value; };
const nullable = (value: unknown) => value === null ? null : text(value);
const bool = (value: unknown): boolean => { if (typeof value !== 'boolean')
    throw Error('Invalid configuration flag'); return value; };
const count = (value: unknown): number => { if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw Error('Invalid configuration count'); return value as number; };
const array = (value: unknown): unknown[] => { if (!Array.isArray(value))
    throw Error('Invalid configuration list'); return value; };
export const identity = (value: unknown): string => { const s = text(value); if (!s.trim() || /[\\/\s?#%]/.test(s))
    throw Error('Invalid configuration identity'); return s; };
export function safeDocs(value: unknown): string | null {
    if (value === null)
        return null;
    const raw = text(value);
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname ? url.href : null;
    }
    catch {
        return null;
    }
}
export function validContent(key: ContentKey, value: unknown): boolean {
    return key in contentChoices
        ? (contentChoices[key as keyof typeof contentChoices] as readonly unknown[]).includes(value)
        : typeof value === 'boolean';
}
export function parseContent(value: unknown): ContentSettings {
    const r = record(value), result: Partial<Record<ContentKey, string | boolean | null>> = {};
    for (const key of contentKeys) {
        if (!Object.hasOwn(r, key))
            continue;
        const v = r[key];
        if (v !== null && (key.startsWith('docling_') ? typeof v !== 'boolean' : typeof v !== 'string'))
            throw Error('Invalid content setting');
        result[key] = v as string | boolean | null;
    }
    return Object.freeze(result);
}
export function parseCapabilities(value: unknown): Capabilities {
    const r = record(value);
    return Object.freeze({ docling_available: bool(r.docling_available), crawl4ai_available: bool(r.crawl4ai_available), crawl4ai_remote_configured: bool(r.crawl4ai_remote_configured) });
}
export function parseWebSearch(value: unknown): WebStatus {
    const r = record(value);
    if (r.provider !== 'firecrawl' || r.externally_verified !== false || r.automatic_paid_fallback !== false)
        throw Error('Unknown web-search contract');
    count(r.max_results);
    if (r.trial_limits !== null) {
        const trial = record(r.trial_limits);
        if (trial.scope !== 'server_ip' || trial.period !== 'daily' || trial.numeric_caps_published !== false)
            throw Error('Unknown trial');
    }
    return Object.freeze({ state: text(r.state), configured: bool(r.configured), access_mode: nullable(r.access_mode), trial: r.trial_limits !== null });
}
export function parseProviders(value: unknown): readonly Provider[] {
    return Object.freeze(array(value).map(v => {
        const r = record(v);
        return Object.freeze({ name: identity(r.name), display_name: text(r.display_name), modalities: Object.freeze(array(r.modalities).map(text)), docs_url: safeDocs(r.docs_url), env_configured: bool(r.env_configured) });
    }));
}
export function parseCredential(value: unknown): Credential {
    const r = record(value);
    const presence = Object.fromEntries(privateFields.map(key => [key, !Object.hasOwn(r, key) ? 'absent' : r[key] === null ? 'null' : (text(r[key]), 'present')])) as Record<PrivateField, Presence>;
    if (r.decryption_error !== null && r.decryption_error !== undefined)
        text(r.decryption_error);
    return Object.freeze({
        id: identity(r.id), name: text(r.name), provider: identity(r.provider), modalities: Object.freeze(array(r.modalities).map(text)),
        presence: Object.freeze(presence), project: nullable(r.project), location: nullable(r.location), api_version: nullable(r.api_version),
        num_ctx: r.num_ctx === null ? null : count(r.num_ctx), has_api_key: bool(r.has_api_key), model_count: count(r.model_count),
        decryption_problem: r.decryption_error !== null && r.decryption_error !== undefined, created: text(r.created), updated: text(r.updated)
    });
}
export const parseCredentials = (value: unknown) => Object.freeze(array(value).map(parseCredential));
export function parseModels(value: unknown): readonly Model[] {
    return Object.freeze(array(value).map(v => {
        const r = record(v);
        return Object.freeze({ id: identity(r.id), name: text(r.name), provider: identity(r.provider), type: text(r.type), credential: r.credential === null ? null : identity(r.credential), created: text(r.created), updated: text(r.updated) });
    }));
}
export function parseDefaults(value: unknown): Defaults {
    const r = record(value);
    return Object.freeze(Object.fromEntries(defaultKeys.map(key => [key, r[key] === null ? null : identity(r[key])])) as Record<DefaultKey, string | null>);
}
export function parseDiscovery(value: unknown, id: string, provider: string): Discovery {
    const r = record(value);
    if (r.credential_id !== id || r.provider !== provider)
        throw Error('Mismatched discovery');
    const seen = new Set<string>();
    const discovered = array(r.discovered).map(v => {
        const m = record(v);
        const name = text(m.name);
        if (!name.trim() || m.provider !== provider)
            throw Error('Mismatched model provider');
        return Object.freeze({ name, provider, ...(Object.hasOwn(m, 'model_type') ? { model_type: nullable(m.model_type) } : {}) });
    }).filter(m => { if (seen.has(m.name))
        return false; seen.add(m.name); return true; });
    return Object.freeze({ credential_id: id, provider, discovered: Object.freeze(discovered) });
}
export function parseTest(value: unknown): SafeTest {
    const r = record(value);
    text(r.message);
    if (r.details !== null && r.details !== undefined)
        text(r.details);
    return Object.freeze({ success: bool(r.success), details_present: typeof r.details === 'string' && !!r.details });
}
export function parseRegistration(value: unknown) {
    const r = record(value);
    return Object.freeze({ created: count(r.created), existing: count(r.existing) });
}
export function parseDeletion(value: unknown, credential: boolean) {
    const r = record(value);
    text(r.message);
    return Object.freeze(credential ? { deleted_models: count(r.deleted_models) } : {});
}
export function parseMigration(value: unknown) {
    const r = record(value);
    return Object.freeze({ migrated: array(r.migrated).length, skipped: array(r.skipped).length, not_configured: array(r.not_configured).length, errors: array(r.errors).length });
}
export function parseAutoAssign(value: unknown) {
    const r = record(value), assigned = record(r.assigned);
    const valid = (v: unknown) => { const key = text(v); if (!requiredDefaults.includes(key as DefaultKey))
        throw Error('Unexpected default'); return key; };
    return Object.freeze({ assigned: Object.freeze(Object.fromEntries(Object.entries(assigned).map(([k, v]) => [valid(k), identity(v)]))), skipped: Object.freeze(array(r.skipped).map(valid)), missing: Object.freeze(array(r.missing).map(valid)) });
}
