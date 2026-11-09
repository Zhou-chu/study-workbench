import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
import { configurationServer, credentialFixture, configuredModels, modelDefaults, contentSettings } from '../../test/configuration-fixtures';
import { readTurnContext } from '@study/web-transport';
const dialog = () => within(screen.getByRole('dialog'));
const accept = () => fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
async function modelPage() { const h = await renderLibrary('/settings/models'); await waitFor(() => expect(screen.getByRole('button', { name: 'Edit First configuration' })).toBeEnabled()); return h; }
async function discover() { fireEvent.click(screen.getByRole('button', { name: 'Discover Models First configuration' })); accept(); await screen.findByRole('button', { name: 'Register selected' }); }
it('B9c unknown registry providers stay visible but cannot create credentials', async () => {
    configurationServer(r => new URL(r.url).pathname === '/api/providers' ? json([{ name: 'future-provider', display_name: 'Future provider', modalities: ['language'], docs_url: null, env_configured: true }]) : undefined);
    await renderLibrary('/settings/models');
    expect(await screen.findByRole('heading', { name: 'Future provider' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Add Configuration: Future provider/ })).toBeDisabled();
});
it('B9c clears invalid private submission and never stores private input in resources or caches', async () => {
    const requests = configurationServer();
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit First configuration' }));
    const secret = 'synthetic-private-sentinel';
    const key = dialog().getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(key, { target: { value: secret } });
    fireEvent.click(dialog().getByRole('button', { name: 'Show API key' }));
    expect(key.type).toBe('text');
    fireEvent.change(dialog().getByLabelText('Base URL'), { target: { value: 'set' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(key.value).toBe(''));
    expect(key.type).toBe('password');
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain(secret);
    expect(JSON.stringify(h.queries.getQueryCache().getAll().map(q => q.state.data))).not.toContain(secret);
    expect(JSON.stringify(h.queries.getMutationCache().getAll())).not.toContain(secret);
    expect(JSON.stringify(h.router.state)).not.toContain(secret);
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
it.each(['cancel', 'retire', 'unmount'] as const)('B9c clears private key on %s without persisting it', async (exit) => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    const local = vi.spyOn(Storage.prototype, 'setItem');
    configurationServer();
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit First configuration' }));
    const input = dialog().getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'synthetic-exit-secret' } });
    if (exit === 'cancel')
        fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    else if (exit === 'retire')
        act(() => h.workbench.drafts.retireContext(readTurnContext()!.epoch));
    else
        h.unmount();
    expect(input.value).toBe('');
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain('synthetic-exit-secret');
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls, ...warn.mock.calls, ...local.mock.calls])).not.toContain('synthetic-exit-secret');
    log.mockRestore();
    error.mockRestore();
    warn.mockRestore();
    local.mockRestore();
});
it('B9c partial environment migration displays all safe categories and never a success label', async () => {
    const requests = configurationServer(r => r.url.endsWith('/migrate-from-env') ? json({ migrated: ['openai'], skipped: [], not_configured: ['x'], errors: ['synthetic-environment-secret'] }) : undefined);
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Migrate to Database' }));
    accept();
    expect(await screen.findByText('Errors')).toBeVisible();
    expect(screen.queryByText('Success')).toBeNull();
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain('synthetic-environment-secret');
    expect(requests.filter(r => r.url.endsWith('/migrate-from-env'))).toHaveLength(1);
});
it('B9c auto-assignment presents assigned skipped and missing required slots without optional writes', async () => {
    const requests = configurationServer(r => r.url.endsWith('/models/auto-assign') ? json({ assigned: { default_chat_model: 'model:chat' }, skipped: ['default_embedding_model'], missing: [] }) : undefined);
    await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-assign Defaults' }));
    accept();
    expect(await screen.findByText('Assigned')).toBeVisible();
    expect(screen.getByText('Missing')).toBeVisible();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(0);
});
it('B9c discovery explicitly chooses registration type and searches/toggles absent-type names with deduplication', async () => {
    let payload: unknown;
    configurationServer(async (r) => {
        if (r.url.endsWith('/discover'))
            return json({ credential_id: 'credential:one', provider: 'openai', discovered: [
                    { name: 'Alpha', provider: 'openai', model_type: 'language' },
                    { name: 'alpha', provider: 'openai', model_type: null },
                    { name: 'Embed', provider: 'openai', model_type: 'embedding' },
                    { name: 'Future', provider: 'openai', model_type: 'future' }
                ] });
        if (r.url.endsWith('/register-models')) {
            payload = await r.json();
            return json({ created: 1, existing: 0 });
        }
        return undefined;
    });
    await modelPage();
    await discover();
    expect(screen.getByLabelText('Embed')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Search...'), { target: { value: 'Alpha' } });
    expect(screen.queryByLabelText('Embed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle filtered selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Register selected' }));
    await waitFor(() => expect(payload).toEqual({ models: [{ name: 'Alpha', provider: 'openai', model_type: 'language' }] }));
    expect(await screen.findByText('Created')).toBeVisible();
});
it('B9c custom registration requires explicit type and explicit custom choice', async () => {
    let payload: unknown;
    configurationServer(async (r) => {
        if (r.url.endsWith('/discover'))
            return json({ credential_id: 'credential:one', provider: 'openai', discovered: [] });
        if (r.url.endsWith('/register-models')) {
            payload = await r.json();
            return json({ created: 0, existing: 1 });
        }
        return undefined;
    });
    await modelPage();
    await discover();
    expect(screen.getByText(/unverified/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Model Type'), { target: { value: 'embedding' } });
    fireEvent.change(screen.getByLabelText('Search...'), { target: { value: 'Custom synthetic' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Custom synthetic/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Register selected' }));
    await waitFor(() => expect(payload).toEqual({ models: [{ name: 'Custom synthetic', provider: 'openai', model_type: 'embedding' }] }));
});
it.each([
    ['Chat Model', 'default_chat_model', 'language'],
    ['Embedding Model', 'default_embedding_model', 'embedding'],
    ['Text-to-Speech Model', 'default_text_to_speech_model', 'text_to_speech'],
    ['Speech-to-Text Model', 'default_speech_to_text_model', 'speech_to_text'],
    ['Transformation Model', 'default_transformation_model', 'language'],
    ['Tools Model', 'default_tools_model', 'language'],
    ['Large Context Model', 'large_context_model', 'language']
])('B9c assigns %s using exact one-field defaults PUT', async (label, field, type) => {
    let payload: unknown;
    configurationServer(async (r) => {
        if (new URL(r.url).pathname === '/api/models')
            return json([...configuredModels, { ...configuredModels[0], id: 'model:new', name: 'New model', type }]);
        if (r.method === 'PUT' && r.url.endsWith('/models/defaults')) {
            payload = await r.json();
            return json({ ...modelDefaults, [field]: 'model:new' });
        }
        return undefined;
    });
    await modelPage();
    fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value: 'model:new' } });
    accept();
    await waitFor(() => expect(payload).toEqual({ [field]: 'model:new' }));
});
it('B9c clears only optional defaults with null and cancellation sends nothing', async () => {
    let payload: unknown;
    configurationServer(async (r) => {
        if (r.method === 'GET' && r.url.endsWith('/models/defaults'))
            return json({ ...modelDefaults, default_tools_model: 'model:chat' });
        if (r.method === 'PUT') {
            payload = await r.json();
            return json({ ...modelDefaults, default_tools_model: null });
        }
        return undefined;
    });
    await modelPage();
    expect(within(screen.getByLabelText('Chat Model')).getByRole('option', { name: /select/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Embedding Model'), { target: { value: 'model:next' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(payload).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Tools Model'), { target: { value: '' } });
    accept();
    await waitFor(() => expect(payload).toEqual({ default_tools_model: null }));
});
it('B9c zero-link delete is distinct from cascading deletion and exact same-provider migration', async () => {
    let deleting = false;
    const requests = configurationServer(r => {
        if (new URL(r.url).pathname === '/api/credentials')
            return json([{ ...credentialFixture, model_count: 0 }, { ...credentialFixture, id: 'credential:two', name: 'Second configuration', model_count: 0 }]);
        if (new URL(r.url).pathname === '/api/models')
            return json([]);
        if (r.method === 'DELETE') {
            deleting = true;
            return json({ message: 'Deleted', deleted_models: 0 });
        }
        return undefined;
    });
    await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete First configuration' }));
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Delete' })).toBeEnabled());
    expect(dialog().getByText(/Other clients/i)).toBeVisible();
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(deleting).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete First configuration' }));
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Delete' })).toBeEnabled());
    fireEvent.click(dialog().getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleting).toBe(true));
    expect(requests.filter(r => r.method === 'DELETE')[0]!.url).not.toContain('migrate_to');
});
it('B9c linked deletion offers cascade or exact same-provider migration and never delete_models', async () => {
    const requests = configurationServer(r => r.method === 'DELETE' ? json({ message: 'Deleted', deleted_models: 0 }) : undefined);
    await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete First configuration' }));
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Delete with models' })).toBeEnabled());
    fireEvent.change(dialog().getByLabelText('Migrate models to'), { target: { value: 'credential:two' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Migrate and delete' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(new URL(requests.find(r => r.method === 'DELETE')!.url).searchParams.get('migrate_to')).toBe('credential:two');
    expect(requests.find(r => r.method === 'DELETE')!.url).not.toContain('delete_models');
});
it('B9c explicit model test failure is safe and model delete uses list metadata without a detail GET', async () => {
    const requests = configurationServer(r => {
        if (r.url.endsWith('/test'))
            return json({ success: false, message: 'synthetic-provider-secret', details: 'synthetic-detail-secret' });
        if (r.method === 'DELETE')
            return json({ message: 'Deleted' });
        return undefined;
    });
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Test Model Chat fixture' }));
    accept();
    expect(await screen.findByText('Connection test failed')).toBeVisible();
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toMatch(/synthetic-(provider|detail)-secret/);
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chat fixture' }));
    accept();
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(requests.some(r => r.method === 'GET' && /models\/model/.test(r.url))).toBe(false);
});
it('B9c blocked-then-cancelled navigation invalidates a successful late Advanced ticket without losing the save', async () => {
    let resolve!: (r: Response) => void;
    const requests = configurationServer(r => r.method === 'PUT' ? new Promise<Response>(yes => resolve = yes) : undefined);
    const h = await modelPage();
    fireEvent.change(screen.getByLabelText('Embedding Model'), { target: { value: 'model:next' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm and open Advanced' }));
    await waitFor(() => expect(resolve).toBeDefined());
    await act(async () => h.router.navigate('/settings'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await act(async () => resolve(json({ ...modelDefaults, default_embedding_model: 'model:next' })));
    expect(h.router.state.location.pathname).toBe('/settings/models');
    expect(h.workbench.drafts.configuration.getSnapshot()[0]?.attempt?.phase).toBe('confirmed');
    fireEvent.click(screen.getByRole('link', { name: 'Open Advanced' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/advanced'));
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/embeddings/'))).toBe(false);
});
it('B9c captures all seven content fields, false values and no unrelated language setting', async () => {
    let payload: unknown;
    configurationServer(async (r) => { if (r.method === 'PUT') {
        payload = await r.json();
        return json({ ...contentSettings, ...payload as object });
    } return undefined; });
    await renderLibrary('/settings');
    fireEvent.change(await screen.findByLabelText('Document Processing Engine'), { target: { value: 'simple' } });
    fireEvent.change(screen.getByLabelText('URL Processing Engine'), { target: { value: 'simple' } });
    fireEvent.change(screen.getByLabelText('Default Embedding Option'), { target: { value: 'never' } });
    fireEvent.change(screen.getByLabelText('Auto Delete Files'), { target: { value: 'yes' } });
    for (const label of ['Enable OCR', 'Extract formulas', 'Describe images and charts'])
        fireEvent.click(screen.getByLabelText(new RegExp('^' + label)));
    fireEvent.click(screen.getByText('Help me choose'));
    expect(screen.getByText('Help me choose')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save content settings' }));
    await waitFor(() => expect(Object.keys(payload as object)).toHaveLength(7));
    expect(payload).not.toHaveProperty('youtube_language');
});
it('B9c stale credential editor and stale discovery cannot dispatch after metadata A-B-A refresh', async () => {
    const requests = configurationServer(r => r.url.endsWith('/discover') ? json({ credential_id: 'credential:one', provider: 'openai', discovered: [{ name: 'Alpha', provider: 'openai' }] }) : undefined);
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit First configuration' }));
    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'A changed name' } });
    const store = h.workbench.drafts.configuration, row = store.getSnapshot()[0]!;
    act(() => { const revision = store.loading(row.id, 'credentials')!; store.publish(row.id, 'credentials', revision, row.data.credentials!); });
    expect(dialog().getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    await discover();
    fireEvent.click(screen.getByLabelText('Alpha'));
    const current = store.get(row.id)!;
    act(() => { const revision = store.loading(row.id, 'credentials')!; store.publish(row.id, 'credentials', revision, current.data.credentials!); });
    fireEvent.click(screen.getByRole('button', { name: 'Register selected' }));
    expect(requests.some(r => r.url.endsWith('/register-models'))).toBe(false);
});
it('B9c create sends only explicit private body and no provider call, with a synchronous duplicate latch', async () => {
    let resolve!: (r: Response) => void;
    const requests = configurationServer(r => r.method === 'POST' && new URL(r.url).pathname === '/api/credentials' ? new Promise<Response>(yes => resolve = yes) : undefined);
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Configuration: OpenAI' }));
    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Synthetic new' } });
    fireEvent.change(dialog().getByLabelText('API Key'), { target: { value: 'synthetic-new-key' } });
    const submit = dialog().getByRole('button', { name: 'Save configuration' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(resolve).toBeDefined());
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(await requests.find(r => r.method === 'POST')!.clone().json()).toEqual({ name: 'Synthetic new', provider: 'openai', modalities: ['language', 'embedding'], api_key: 'synthetic-new-key' });
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain('synthetic-new-key');
    expect(JSON.stringify(h.queries.getMutationCache().getAll())).not.toContain('synthetic-new-key');
    await act(async () => resolve(json({ ...credentialFixture, id: 'credential:new' })));
    expect(screen.queryByRole('dialog')).toBeNull();
});
it.each([400, 404, 409, 422, 429])('B9c %s after a credential test preserves original safe unknown intent and does not replay', async (status) => {
    const requests = configurationServer(r => r.url.endsWith('/test') ? new Response(JSON.stringify({ detail: 'synthetic-secret-error' }), { status, headers: { 'content-type': 'application/json' } }) : undefined);
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection First configuration' }));
    accept();
    expect(await screen.findByText(/Do not resend/)).toBeVisible();
    expect(screen.getByText('Error: ' + status)).toBeVisible();
    const old = h.workbench.drafts.configuration.getSnapshot()[0]!.attempt!;
    expect(old.token.intent).toEqual({ kind: 'credential-test', id: 'credential:one', provider: 'openai' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit First configuration' })).toBeDisabled());
    expect(requests.filter(r => r.url.endsWith('/test'))).toHaveLength(1);
    expect(h.workbench.drafts.configuration.getSnapshot()[0]!.attempt).toBe(old);
});
it('B9c list failure cannot stand in for zero links and provider/decryption status never grants capability', async () => {
    configurationServer(r => {
        if (new URL(r.url).pathname === '/api/models')
            return json({ incomplete: true });
        if (new URL(r.url).pathname === '/api/credentials')
            return json([{ ...credentialFixture, decryption_error: 'synthetic-decryption-secret' }]);
        return undefined;
    });
    const h = await renderLibrary('/settings/models');
    expect(await screen.findByText('Decryption Error')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete First configuration' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test Connection First configuration' })).toBeDisabled();
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain('synthetic-decryption-secret');
});
it('B9c configuration revision A-B-A invalidates delete confirmation after complete same-valued metadata', async () => {
    const requests = configurationServer();
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete First configuration' }));
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Delete with models' })).toBeEnabled());
    const store = h.workbench.drafts.configuration, row = store.getSnapshot()[0]!;
    act(() => { const rev = store.loading(row.id, 'models')!; store.publish(row.id, 'models', rev, row.data.models!); });
    expect(dialog().getByRole('button', { name: 'Delete with models' })).toBeDisabled();
    fireEvent.click(dialog().getByRole('button', { name: 'Delete with models' }));
    expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
});
it('B9c present private URL can be cleared and Ollama zero is an explicit reset rather than absence', async () => {
    let payload: unknown;
    configurationServer(async (r) => {
        if (new URL(r.url).pathname === '/api/providers')
            return json([{ name: 'ollama', display_name: 'Ollama', modalities: ['language'], docs_url: 'https://ollama.com/', env_configured: false }]);
        if (new URL(r.url).pathname === '/api/credentials')
            return json([{ ...credentialFixture, provider: 'ollama', num_ctx: 8192 }]);
        if (r.method === 'PUT') {
            payload = await r.json();
            return json({ ...credentialFixture, provider: 'ollama', num_ctx: null, base_url: null });
        }
        return undefined;
    });
    await modelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit First configuration' }));
    fireEvent.change(dialog().getByLabelText('Base URL'), { target: { value: 'clear' } });
    fireEvent.change(dialog().getByLabelText('Context Window (num_ctx)'), { target: { value: '0' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(payload).toEqual({ base_url: null, num_ctx: 0 }));
});
it('B9c registry docs are safe external links and missing encryption disables create without hiding metadata', async () => {
    const requests = configurationServer(r => r.url.endsWith('/credentials/status') ? json({ configured: { openai: true }, source: { openai: 'environment' }, encryption_configured: false }) : undefined);
    await renderLibrary('/settings/models');
    expect(await screen.findByText('First configuration')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Configuration: OpenAI' })).toBeDisabled();
    expect(screen.getAllByText('Encryption key not configured').length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: 'View docs' });
    expect(links.some(link => link.getAttribute('href') === 'https://platform.openai.com/')).toBe(true);
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
it.each(['metadata', 'control', 'retire', 'mismatch', 'unmount'] as const)('B9c late default result never redirects after %s invalidation', async (reason) => {
    let resolve!: (r: Response) => void;
    const requests = configurationServer(r => r.method === 'PUT' ? new Promise<Response>(yes => resolve = yes) : undefined);
    const h = await modelPage();
    fireEvent.change(screen.getByLabelText('Embedding Model'), { target: { value: 'model:next' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm and open Advanced' }));
    await waitFor(() => expect(resolve).toBeDefined());
    const store = h.workbench.drafts.configuration, row = store.getSnapshot()[0]!;
    act(() => {
        if (reason === 'metadata')
            store.invalidate(row.id);
        if (reason === 'control')
            store.touch(row.id);
        if (reason === 'retire')
            h.workbench.drafts.retireContext(row.context.epoch);
    });
    if (reason === 'unmount')
        h.unmount();
    await act(async () => resolve(json({ ...modelDefaults, default_embedding_model: reason === 'mismatch' ? 'model:embed' : 'model:next' })));
    expect(h.router.state.location.pathname).toBe('/settings/models');
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/embeddings/'))).toBe(false);
});

it('B9c provider confirmation names the exact credential and provider before any request',async()=>{
 const requests=configurationServer();await modelPage();
 fireEvent.click(screen.getByRole('button',{name:'Test Connection First configuration'}));
 expect(dialog().getByText('First configuration · openai · credential:one')).toBeVisible();
 expect(requests.some(r=>r.url.endsWith('/test'))).toBe(false);
 fireEvent.click(dialog().getByRole('button',{name:'Cancel'}));
});

it('B9c retired private form releases the dialog and a late callback cannot clear a new form',async()=>{
 let resolve!:(r:Response)=>void;
 const requests=configurationServer(r=>r.method==='PUT'?new Promise<Response>(yes=>resolve=yes):undefined);
 const h=await modelPage();
 fireEvent.click(screen.getByRole('button',{name:'Edit First configuration'}));
 fireEvent.change(dialog().getByLabelText('API Key'),{target:{value:'synthetic-old-private'}});
 fireEvent.click(dialog().getByRole('button',{name:'Save configuration'}));
 await waitFor(()=>expect(resolve).toBeDefined());
 const original=h.workbench.drafts.configuration.getSnapshot()[0]!.id;
 await act(async()=>{h.workbench.controller.retirePrivacyContext();await h.workbench.controller.check();});
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'New blank record'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Edit First configuration'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Edit First configuration'}));
 const input=dialog().getByLabelText('API Key') as HTMLInputElement;
 fireEvent.change(input,{target:{value:'synthetic-new-private'}});
 await act(async()=>resolve(json(credentialFixture)));
 expect(input.value).toBe('synthetic-new-private');
 expect(h.workbench.drafts.configuration.get(original)?.attempt?.phase).toBe('unknown');
 expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toMatch(/synthetic-(old|new)-private/);
 expect(requests.filter(r=>r.method==='PUT')).toHaveLength(1);
});

it.each(['create', 'edit'] as const)('B9c fix1 retains a private key through reveal and metadata edits for %s', async mode => {
    let resolve!: (response: Response) => void;
    const requests = configurationServer(r => {
        if (['POST', 'PUT'].includes(r.method) && new URL(r.url).pathname.startsWith('/api/credentials'))
            return new Promise<Response>(yes => { resolve = yes; });
        return undefined;
    });
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', {name: mode === 'create' ? 'Add Configuration: OpenAI' : 'Edit First configuration'}));
    const key = dialog().getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(key, {target: {value: 'synthetic-rerender-key'}});
    fireEvent.click(dialog().getByRole('button', {name: 'Show API key'}));
    expect(key).toHaveValue('synthetic-rerender-key');
    expect(key.type).toBe('text');
    fireEvent.click(dialog().getByRole('button', {name: 'Hide API key'}));
    expect(key).toHaveValue('synthetic-rerender-key');
    expect(key.type).toBe('password');
    fireEvent.change(dialog().getByLabelText('Name'), {target: {value: 'Synthetic retained name'}});
    fireEvent.click(dialog().getByRole('checkbox', {name: 'Language'}));
    fireEvent.click(dialog().getByRole('checkbox', {name: 'Language'}));
    expect(key).toHaveValue('synthetic-rerender-key');
    fireEvent.click(dialog().getByRole('button', {name: 'Save configuration'}));
    await waitFor(() => expect(resolve).toBeDefined());
    expect(key).toHaveValue('synthetic-rerender-key');
    const write = requests.find(r => ['POST', 'PUT'].includes(r.method))!;
    expect(await write.clone().json()).toEqual({
        name: 'Synthetic retained name',
        api_key: 'synthetic-rerender-key',
        ...(mode === 'create' ? {provider: 'openai', modalities: ['embedding', 'language']} : {modalities: ['embedding', 'language']})
    });
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain('synthetic-rerender-key');
    expect(JSON.stringify(h.queries.getQueryCache().getAll().map(q => q.state.data))).not.toContain('synthetic-rerender-key');
    expect(JSON.stringify(h.queries.getMutationCache().getAll())).not.toContain('synthetic-rerender-key');
    expect(JSON.stringify(h.router.state)).not.toContain('synthetic-rerender-key');
    await act(async () => resolve(json({...credentialFixture, id: mode === 'create' ? 'credential:new' : credentialFixture.id})));
    await waitFor(() => expect(key.value).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['azure', 'vertex'] as const)('B9c fix1 keeps multiple %s private replacements while only a replaced field clears', async provider => {
    let resolve!: (response: Response) => void;
    const requests = configurationServer(r => {
        const path = new URL(r.url).pathname;
        if (path === '/api/providers') return json([{name: provider, display_name: provider, modalities: ['language', 'embedding'], docs_url: null, env_configured: false}]);
        if (path === '/api/credentials') return json([{...credentialFixture, provider}]);
        if (r.method === 'PUT') return new Promise<Response>(yes => { resolve = yes; });
        return undefined;
    });
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', {name: 'Edit First configuration'}));
    const key = dialog().getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(key, {target: {value: 'synthetic-multiple-key'}});
    fireEvent.change(dialog().getByLabelText('Base URL'), {target: {value: 'set'}});
    const oldBase = dialog().getByLabelText('Set replacement: Base URL') as HTMLInputElement;
    fireEvent.change(oldBase, {target: {value: 'https://synthetic.invalid/?private=synthetic-base'}});
    const secondLabel = provider === 'azure' ? 'Endpoint' : 'Service Account JSON Path';
    fireEvent.change(dialog().getByLabelText(secondLabel), {target: {value: 'set'}});
    const second = dialog().getByLabelText('Set replacement: ' + secondLabel) as HTMLInputElement;
    const secondValue = provider === 'azure' ? 'https://synthetic.invalid/?private=synthetic-endpoint' : '/synthetic/private-path';
    fireEvent.change(second, {target: {value: secondValue}});
    let third: HTMLInputElement | null = null;
    if (provider === 'azure') {
        fireEvent.change(dialog().getByLabelText('Endpoint · Language'), {target: {value: 'set'}});
        third = dialog().getByLabelText('Set replacement: Endpoint · Language') as HTMLInputElement;
        fireEvent.change(third, {target: {value: 'https://synthetic.invalid/?private=synthetic-llm'}});
        fireEvent.change(dialog().getByLabelText('API version'), {target: {value: '2026-01'}});
    } else {
        fireEvent.change(dialog().getByLabelText('GCP Project ID'), {target: {value: 'synthetic-project'}});
        fireEvent.change(dialog().getByLabelText('Region'), {target: {value: 'synthetic-region'}});
    }
    expect(key).toHaveValue('synthetic-multiple-key');
    expect(oldBase).toHaveValue('https://synthetic.invalid/?private=synthetic-base');
    expect(second).toHaveValue(secondValue);
    if (third) expect(third).toHaveValue('https://synthetic.invalid/?private=synthetic-llm');
    fireEvent.change(dialog().getByLabelText('Base URL'), {target: {value: 'keep'}});
    expect(oldBase.value).toBe('');
    expect(key).toHaveValue('synthetic-multiple-key');
    expect(second).toHaveValue(secondValue);
    fireEvent.change(dialog().getByLabelText('Base URL'), {target: {value: 'set'}});
    const replacementBase = dialog().getByLabelText('Set replacement: Base URL') as HTMLInputElement;
    expect(replacementBase.value).toBe('');
    fireEvent.change(replacementBase, {target: {value: 'https://synthetic.invalid/?private=synthetic-final-base'}});
    fireEvent.click(dialog().getByRole('button', {name: 'Save configuration'}));
    await waitFor(() => expect(resolve).toBeDefined());
    expect(await requests.find(r => r.method === 'PUT')!.clone().json()).toEqual({
        api_key: 'synthetic-multiple-key', base_url: 'https://synthetic.invalid/?private=synthetic-final-base',
        ...(provider === 'azure' ? {endpoint: secondValue, endpoint_llm: 'https://synthetic.invalid/?private=synthetic-llm', api_version: '2026-01'} : {credentials_path: secondValue, project: 'synthetic-project', location: 'synthetic-region'})
    });
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toMatch(/synthetic-multiple-key|synthetic-final-base|synthetic-endpoint|synthetic-llm|private-path/);
    await act(async () => resolve(json({...credentialFixture, provider})));
    await waitFor(() => expect(key.value).toBe(''));
    expect(replacementBase.value).toBe('');
    expect(second.value).toBe('');
    if (third) expect(third.value).toBe('');
});

it.each(['cancel', 'retire', 'unmount'] as const)('B9c fix1 clears mounted private URL and path inputs on real %s', async exit => {
    configurationServer(r => {
        const path = new URL(r.url).pathname;
        if (path === '/api/providers') return json([{name: 'vertex', display_name: 'Vertex', modalities: ['language'], docs_url: null, env_configured: false}]);
        if (path === '/api/credentials') return json([{...credentialFixture, provider: 'vertex'}]);
        return undefined;
    });
    const h = await modelPage();
    fireEvent.click(screen.getByRole('button', {name: 'Edit First configuration'}));
    fireEvent.change(dialog().getByLabelText('Base URL'), {target: {value: 'set'}});
    fireEvent.change(dialog().getByLabelText('Service Account JSON Path'), {target: {value: 'set'}});
    const inputs = ['API Key', 'Set replacement: Base URL', 'Set replacement: Service Account JSON Path'].map(label => dialog().getByLabelText(label) as HTMLInputElement);
    const values = ['synthetic-exit-key', 'https://synthetic.invalid/?key=synthetic-exit-url', '/synthetic/exit-path'];
    inputs.forEach((input, index) => fireEvent.change(input, {target: {value: values[index]}}));
    inputs.forEach((input, index) => expect(input).toHaveValue(values[index]));
    if (exit === 'cancel') fireEvent.click(dialog().getByRole('button', {name: 'Cancel'}));
    else if (exit === 'retire') act(() => h.workbench.drafts.retireContext(readTurnContext()!.epoch));
    else h.unmount();
    inputs.forEach(input => expect(input.value).toBe(''));
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toMatch(/synthetic-exit-key|synthetic-exit-url|synthetic\/exit-path/);
});

it.each(['http', 'malformed'] as const)('B9c fix1 explicit Refresh recovers a %s provider registry failure without provider actions', async failure => {
    let providerReads = 0;
    const requests = configurationServer(r => {
        if (new URL(r.url).pathname === '/api/providers') {
            providerReads++;
            if (providerReads === 1) return failure === 'http' ? json({detail: 'Synthetic registry failure'}, 422) : json({invalid: true});
            return json([{name: 'openai', display_name: 'OpenAI', modalities: ['language', 'embedding'], docs_url: null, env_configured: true}]);
        }
        return undefined;
    });
    const h = await renderLibrary('/settings/models');
    const store = h.workbench.drafts.configuration;
    await waitFor(() => expect(store.getSnapshot().find(row => row.kind === 'models')?.sources.providers?.phase).toBe('error'));
    const original = store.getSnapshot().find(row => row.kind === 'models')!;
    expect(screen.getByRole('button', {name: 'Auto-assign Defaults'})).toBeDisabled();
    await act(async () => h.router.navigate('/settings'));
    await act(async () => h.router.navigate('/settings/models'));
    expect(providerReads).toBe(1);
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Edit First configuration'})).toBeEnabled());
    expect(providerReads).toBe(2);
    expect(store.get(original.id)?.sources.providers).toEqual({phase: 'ready', revision: 2});
    expect(store.get(original.id)!.metadataRevision).toBeGreaterThan(original.metadataRevision);
    expect(store.getSnapshot().filter(row => row.kind === 'models')).toHaveLength(1);
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
