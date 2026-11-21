import { libraryServer } from './library-harness';
import { json } from './notebook-fixtures';
export const contentSettings = {
    default_content_processing_engine_doc: 'auto', default_content_processing_engine_url: 'auto',
    default_embedding_option: 'ask', auto_delete_files: 'no', docling_ocr: true,
    docling_formulas: false, docling_vision: false, youtube_preferred_languages: ['zh']
};
export const configuredModels = [
    { id: 'model:chat', name: 'Chat fixture', provider: 'openai', type: 'language', credential: 'credential:one', created: '2026-11-09', updated: '2026-11-09' },
    { id: 'model:embed', name: 'Embedding fixture', provider: 'openai', type: 'embedding', credential: 'credential:one', created: '2026-11-09', updated: '2026-11-09' },
    { id: 'model:next', name: 'Next embedding', provider: 'openai', type: 'embedding', credential: 'credential:two', created: '2026-11-09', updated: '2026-11-09' }
];
export const modelDefaults = {
    default_chat_model: 'model:chat', default_embedding_model: 'model:embed',
    default_transformation_model: null, default_tools_model: null, large_context_model: null,
    default_text_to_speech_model: null, default_speech_to_text_model: null
};
export const credentialFixture = {
    id: 'credential:one', name: 'First configuration', provider: 'openai', modalities: ['language', 'embedding'],
    base_url: 'https://private.invalid/?key=synthetic-hidden', endpoint: null, api_version: null,
    endpoint_llm: null, endpoint_embedding: null, endpoint_stt: null, endpoint_tts: null,
    project: null, location: null, credentials_path: '/synthetic/private', num_ctx: null,
    has_api_key: true, created: '2026-11-09', updated: '2026-11-09', model_count: 2, decryption_error: null
};
export function configurationServer(handler?: (r: Request) => Response | undefined | Promise<Response | undefined>) {
    return libraryServer(async (r) => {
        const custom = await handler?.(r);
        if (custom)
            return custom;
        const p = new URL(r.url).pathname;
        if (p === '/api/credentials/status')
            return json({ configured: { openai: true }, source: { openai: 'database' }, encryption_configured: true });
        if (p === '/api/credentials/env-status')
            return json({ openai: true });
        if (p === '/api/settings')
            return json(contentSettings);
        if (p === '/api/capabilities')
            return json({ docling_available: true, crawl4ai_available: false, crawl4ai_remote_configured: false });
        if (p === '/api/personal/web-search/status')
            return json({ state: 'ready', provider: 'firecrawl', configured: true, access_mode: 'keyless_trial', trial_limits: { scope: 'server_ip', period: 'daily', numeric_caps_published: false }, automatic_paid_fallback: false, reason: null, settings_url: '/settings#web-search', max_results: 10, externally_verified: false });
        if (p === '/api/providers')
            return json([{ name: 'openai', display_name: 'OpenAI', modalities: ['language', 'embedding'], docs_url: 'https://platform.openai.com/', env_configured: true }]);
        if (p === '/api/credentials')
            return json([credentialFixture, { ...credentialFixture, id: 'credential:two', name: 'Second configuration', model_count: 1 }]);
        if (p === '/api/models')
            return json(configuredModels);
        if (p === '/api/models/defaults')
            return json(modelDefaults);
        if (p === '/api/config')
            return json({ version: 'fixture', latestVersion: null, hasUpdate: false });
        return undefined;
    });
}
