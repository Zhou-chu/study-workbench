import { beforeEach, expect, it } from 'vitest';
import { createDraftRegistry, createNavigationController } from '../../app/drafts';
import { createConfigurationStore } from './configuration-store';
import { sourceContext } from '../../test/source-fixtures';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { createSettingsApi } from '../../data/settings-api';
import { credentialFixture, modelDefaults, contentSettings } from '../../test/configuration-fixtures';
import { json } from '../../test/notebook-fixtures';
import * as cfg from '../../data/configuration-contracts';
import { configurationMessages } from '../../i18n/configuration-messages';
import { languages } from '../../i18n';
beforeEach(sourceContext);
const setup = () => { const s = createConfigurationStore(() => { }), c = readTurnContext()!, g = sessionCoordinator.current(), id = s.open('models', c)!; return { s, c, g, id }; };
it('B9c token deeply owns original safe intent, not caller mutable arrays', () => {
    const { s, c, g, id } = setup(), models = [{ name: 'Original', provider: 'openai', model_type: 'language' as const }];
    const token = s.capture(id, { kind: 'register', id: 'credential:one', models }, c, g, 3)!;
    models[0]!.name = 'Changed';
    models.push({ name: 'Other', provider: 'openai', model_type: 'language' });
    expect(token.intent).toEqual({ kind: 'register', id: 'credential:one', models: [{ name: 'Original', provider: 'openai', model_type: 'language' }] });
    expect(Object.isFrozen(token.intent.kind === 'register' && token.intent.models[0])).toBe(true);
});
it('B9c current readiness revision generation and provider fence invalidate captures without A-B-A recovery', () => {
    const { s, c, g, id } = setup(), token = s.capture(id, { kind: 'auto-assign' }, c, g, 3)!;
    expect(s.canBegin(token, c, g + 1, 3)).toBe(false);
    expect(s.canBegin(token, c, g, 4)).toBe(false);
    s.touch(id);
    s.touch(id);
    expect(s.begin(token, c, g, 3)).toBe(false);
    const current = s.capture(id, { kind: 'auto-assign' }, c, g, 3)!;
    const rev = s.loading(id, 'models')!;
    s.publish(id, 'models', rev, []);
    expect(s.begin(current, c, g, 3)).toBe(false);
});
it('B9c pending and unknown original attempt survives retirement, selection, fresh blank intent and late callbacks', () => {
    const { s, c, g, id } = setup(), token = s.capture(id, { kind: 'model-delete', id: 'model:one' }, c, g, 3)!;
    expect(s.begin(token, c, g, 3)).toBe(true);
    expect(s.begin(token, c, g, 3)).toBe(false);
    s.retire(c.epoch);
    const old = s.get(id)!;
    expect(old.attempt?.phase).toBe('unknown');
    const next = { ...c, epoch: c.epoch + 1 };
    const fresh = s.fresh(id, next)!;
    expect(fresh).not.toBe(id);
    expect(s.get(fresh)?.attempt).toBeNull();
    expect(s.get(fresh)?.form).toBeNull();
    expect(s.settle(token, 'confirmed', next, g, {})).toBe(false);
    expect(s.get(id)).toBe(old);
    expect(s.select(id)).toBe(true);
    expect(s.open('models', next)).toBe(id);
});
it('B9c unknown same-scope barrier remains after metadata replacement, while authentic unsent permits a new explicit capture', () => {
    const { s, c, g, id } = setup(), token = s.capture(id, { kind: 'model-delete', id: 'model:one' }, c, g, 3)!;
    s.begin(token, c, g, 3);
    s.settle(token, 'not-sent', c, g);
    const next = s.capture(id, { kind: 'model-delete', id: 'model:one' }, c, g, 3)!;
    s.begin(next, c, g, 3);
    s.settle(next, 'unknown', c, g, undefined, 429);
    const old = s.get(id)!.attempt;
    const rev = s.loading(id, 'models')!;
    s.publish(id, 'models', rev, []);
    expect(s.capture(id, { kind: 'model-delete', id: 'model:one' }, c, g, 3)).toBeNull();
    expect(s.get(id)?.attempt).toBe(old);
});
it('B9c both navigation lookups recognize selected configuration resources and stale retained confirmation', () => {
    const registry = createDraftRegistry(), s = registry.configuration, c = readTurnContext()!, id = s.open('application', c)!;
    s.edit(id, 'docling_ocr', false);
    expect(registry.hasUnsaved()).toBe(true);
    const nav = createNavigationController(registry);
    nav.activateResource(id);
    const release = nav.holdResource(id);
    expect(nav.requestNavigation({ destination: '/advanced' })).toBe('confirm');
    s.edit(id, 'docling_ocr', true);
    expect(nav.confirm()).toBeNull();
    const token = s.capture(id, { kind: 'content', changes: { docling_ocr: true } }, c, sessionCoordinator.current(), 0)!;
    s.begin(token, c, sessionCoordinator.current(), 0);
    expect(nav.requestNavigation({ destination: '/advanced' })).toBe('retain');
    registry.retireContext(c.epoch);
    expect(s.get(id)?.attempt?.phase).toBe('unknown');
    release();
});
it('B9c safe projections preserve false zero absent null and future data without raw private fields', () => {
    const { endpoint: unused, ...absent } = credentialFixture;
    void unused;
    const cred = cfg.parseCredential({ ...absent, num_ctx: 0, has_api_key: false, decryption_error: 'synthetic-secret' });
    expect(cred.presence.endpoint).toBe('absent');
    expect(cred.presence.base_url).toBe('present');
    expect(cred.presence.endpoint_llm).toBe('null');
    expect(cred.num_ctx).toBe(0);
    expect(cred.has_api_key).toBe(false);
    expect(cred.decryption_problem).toBe(true);
    expect(JSON.stringify(cred)).not.toMatch(/synthetic-secret|synthetic-hidden|synthetic\/private/);
    expect(cfg.parseContent({ docling_ocr: false, default_embedding_option: null, auto_delete_files: 'future', youtube_preferred_languages: ['x'] })).toEqual({ docling_ocr: false, default_embedding_option: null, auto_delete_files: 'future' });
    expect(cfg.parseTest({ success: false, message: 'secret', details: 'secret' })).toEqual({ success: false, details_present: true });
    expect(cfg.parseMigration({ migrated: [], skipped: [], not_configured: [], errors: ['secret'] })).toEqual({ migrated: 0, skipped: 0, not_configured: 0, errors: 1 });
    for (const value of [{}, null, [], { ...modelDefaults, default_chat_model: 42 }])
        expect(() => cfg.parseDefaults(value)).toThrow();
    expect(() => cfg.parseCredentials([{}])).toThrow();
    expect(cfg.safeDocs('javascript:alert(1)')).toBeNull();
    expect(cfg.safeDocs('https://user:pass@invalid.test')).toBeNull();
});
it('B9c settings adapter preserves wire ownership, default-null semantics and exact credential/model paths', async () => {
    const calls: {
        method: string;
        path: string;
        body?: unknown;
    }[] = [], c = readTurnContext()!;
    const api = createSettingsApi({ send: async (r) => {
            calls.push(r);
            if (r.path === '/settings')
                return json({ ...contentSettings, docling_ocr: false });
            if (r.path === '/models/defaults')
                return json({ ...modelDefaults, default_tools_model: null });
            if (r.path.endsWith('/test'))
                return json({ success: false, message: 'secret', details: null });
            if (r.path.endsWith('/register-models'))
                return json({ created: 0, existing: 1 });
            if (r.method === 'DELETE')
                return json({ message: 'secret', deleted_models: 0 });
            return json(credentialFixture);
        } });
    expect(await api.saveContentSettings({ docling_ocr: false }, c, 's')).toHaveProperty('docling_ocr', false);
    expect(await api.saveModelDefault('default_tools_model', null, c, 'd')).toHaveProperty('default_tools_model', null);
    await expect(api.saveModelDefault('default_chat_model', null, c, 'bad')).rejects.toThrow();
    await api.saveCredential('credential:one', { name: 'new', num_ctx: 0, base_url: null }, c, 'c');
    await api.testCredential('credential:one', c, 't');
    await api.testModel('model:one', c, 'm');
    await api.deleteCredential('credential:one', 'credential:two', c, 'x');
    await api.deleteModel('model:one', c, 'z');
    expect(calls.map(r => [r.method, r.path])).toEqual([
        ['PUT', '/settings'], ['PUT', '/models/defaults'], ['PUT', '/credentials/credential%3Aone'],
        ['POST', '/credentials/credential%3Aone/test'], ['POST', '/models/model%3Aone/test'],
        ['DELETE', '/credentials/credential%3Aone?migrate_to=credential%3Atwo'], ['DELETE', '/models/model%3Aone']
    ]);
    expect(JSON.parse(calls[2]!.body as string)).toEqual({ name: 'new', num_ctx: 0, base_url: null });
    await expect(api.models(c)).rejects.toThrow();
    for (const id of ['bad/id', 'bad%2fid', 'bad?query', 'bad#fragment'])
        await expect(api.deleteModel(id, c, 'bad')).rejects.toThrow();
});
it('B9c all fourteen locales have explicit nonempty configuration text and matching keys', () => {
    expect(Object.keys(configurationMessages).sort()).toEqual(languages.map(l => l.code).sort());
    const reference = configurationMessages['en-US'];
    for (const [code, messages] of Object.entries(configurationMessages)) {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort());
        expect(Object.keys(messages.counts).sort()).toEqual(Object.keys(reference.counts).sort());
        for (const value of Object.values(messages).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)))
            expect(String(value).trim()).not.toBe('');
        if (code !== 'en-US')
            expect(messages.privateHint).not.toBe(reference.privateHint);
    }
});
