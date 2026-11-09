import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { transformationServer, transformationFixture as fixture } from '../../test/transformation-fixtures';
import { configuredModels } from '../../test/configuration-fixtures';
import { json } from '../../test/notebook-fixtures';
import { readTurnContext } from '@study/web-transport';
import type { TransformationToken } from './transformation-store';
const dialog = () => within(screen.getByRole('dialog'));
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
async function open() { const h = await renderLibrary('/transformations'); await screen.findByRole('heading', { name: fixture.title }); await waitFor(() => expect(h.workbench.drafts.configuration.getSnapshot()[0]?.sources.models?.phase).toBe('ready')); return h; }
async function playground() { const h = await open(); fireEvent.click(screen.getByRole('button', { name: 'Try ' + fixture.title })); fireEvent.change(screen.getByLabelText('Language model'), { target: { value: 'model:chat' } }); fireEvent.change(screen.getByLabelText('Input text'), { target: { value: 'Original private input' } }); return h; }
function run() { fireEvent.click(screen.getByRole('button', { name: 'Run transformation' })); fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' })); }
async function instructions() { const h = await open(); fireEvent.click(screen.getByRole('button', { name: 'Global transformation instructions' })); return h; }
function saveInstructions() { fireEvent.click(screen.getByRole('button', { name: 'Save global instructions' })); fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' })); }
it('keeps instructions edits during save and ignores an older default GET after the save baseline', async () => {
    let finish!: (r: Response) => void, late!: (r: Response) => void, gets = 0;
    transformationServer(r => r.url.endsWith('/default-prompt') ? (r.method === 'PUT' ? new Promise(yes => finish = yes) : ++gets === 2 ? new Promise(yes => late = yes) : undefined) : undefined);
    const h = await instructions(), input = screen.getByLabelText('Global transformation instructions');
    fireEvent.change(input, { target: { value: 'Submitted' } });
    saveInstructions();
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.change(input, { target: { value: 'Typed during save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transformations' }));
    await waitFor(() => expect(late).toBeDefined());
    await act(async () => finish(json({ transformation_instructions: 'Submitted' })));
    await act(async () => late(json({ transformation_instructions: 'Old server text' })));
    expect(input).toHaveValue('Typed during save');
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.instructions.baseline).toBe('Submitted');
    expect(screen.getByRole('button', { name: 'Save global instructions' })).toBeEnabled();
});
it('late initial default read cannot replace a typed local instruction draft', async () => {
    let done!: (r: Response) => void;
    transformationServer(r => r.url.endsWith('/default-prompt') ? new Promise(yes => done = yes) : undefined);
    const h = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Global transformation instructions' }));
    fireEvent.change(screen.getByLabelText('Global transformation instructions'), { target: { value: 'Local before read' } });
    await act(async () => done(json({ transformation_instructions: 'Server baseline' })));
    expect(screen.getByLabelText('Global transformation instructions')).toHaveValue('Local before read');
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.instructions.value).toBe('Local before read');
});
it.each([400, 404, 409, 422, 429, 500])('unknown instructions HTTP%s stays guarded after refresh and keeps the original request', async (code) => {
    const requests = transformationServer(r => r.method === 'PUT' ? json({ detail: 'never expose synthetic secret' }, code) : undefined);
    const h = await instructions();
    fireEvent.change(screen.getByLabelText('Global transformation instructions'), { target: { value: 'Unknown original' } });
    saveInstructions();
    await screen.findByText(/Do not resend/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transformations' }));
    await waitFor(() => expect(requests.filter(r => r.url.endsWith('/default-prompt') && r.method === 'GET').length).toBe(2));
    expect(screen.getByRole('button', { name: 'Save global instructions' })).toBeDisabled();
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.attempts[0]?.token.intent).toEqual({ kind: 'instructions', value: 'Unknown original' });
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('synthetic secret');
});
it('unknown create survives dismissal and normal navigation, with no equality-based settlement or replay', async () => {
    const requests = transformationServer(r => r.method === 'POST' ? json({ malformed: true }) : undefined);
    const h = await open();
    fireEvent.click(screen.getByRole('button', { name: 'New transformation' }));
    for (const [name, value] of [['Name', 'new'], ['Title', 'New'], ['Prompt', 'Private prompt']])
        fireEvent.change(dialog().getByLabelText(name!), { target: { value } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save transformation' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    await screen.findByText(/Do not resend/);
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    await act(async () => { void h.router.navigate('/settings'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Keep work and continue' }));
    await act(async () => { await h.router.navigate('/transformations'); });
    await screen.findByRole('button', { name: 'Resume editor' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transformations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume editor' }));
    expect(dialog().getByLabelText('Prompt')).toHaveValue('Private prompt');
    expect(dialog().getByRole('button', { name: 'Save transformation' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('edits during transformation save remain dirty and untouched fields are omitted from the exact PUT', async () => {
    let done!: (r: Response) => void;
    const requests = transformationServer(r => r.method === 'PUT' ? new Promise(yes => done = yes) : undefined);
    const h = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit ' + fixture.title }));
    await waitFor(() => expect(dialog().getByLabelText('Prompt')).toHaveValue(fixture.prompt));
    fireEvent.change(dialog().getByLabelText('Prompt'), { target: { value: 'Submitted prompt' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save transformation' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(done).toBeDefined());
    fireEvent.change(dialog().getByLabelText('Prompt'), { target: { value: 'Later prompt' } });
    await act(async () => done(json({ ...fixture, prompt: 'Submitted prompt' })));
    expect(dialog().getByLabelText('Prompt')).toHaveValue('Later prompt');
    expect(dialog().getByRole('button', { name: 'Save transformation' })).toBeEnabled();
    expect(await requests.find(r => r.method === 'PUT')!.clone().json()).toEqual({ prompt: 'Submitted prompt' });
    const e = h.workbench.drafts.transformations.getSnapshot()[0]!.editor!;
    expect(e.baseline?.prompt).toBe('Submitted prompt');
    expect(e.fields.prompt).toBe('Later prompt');
});
it('unknown delete retains exact target and cannot be settled by a missing refreshed list', async () => {
    let listed = true;
    const requests = transformationServer(r => r.method === 'DELETE' ? (listed = false, json({ bad: true })) : r.url.endsWith('/transformations') && r.method === 'GET' && !listed ? json([]) : undefined);
    const h = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete ' + fixture.title }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    await screen.findByText(/Do not resend/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transformations' }));
    await screen.findByText('No transformations yet');
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.attempts[0]).toMatchObject({ phase: 'unknown', token: { intent: { kind: 'delete', target: fixture.id } } });
    expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
});
it('pending execution retains original input after later edits and output is displayed under its original IDs', async () => {
    let done!: (r: Response) => void;
    const requests = transformationServer(r => r.url.endsWith('/execute') ? new Promise(yes => done = yes) : undefined);
    const h = await playground();
    run();
    await waitFor(() => expect(done).toBeDefined());
    fireEvent.change(screen.getByLabelText('Input text'), { target: { value: 'Later input' } });
    await act(async () => done(json({ output: 'Original response', transformation_id: fixture.id, model_id: null })));
    expect(await screen.findByText('Original response')).toBeVisible();
    expect(screen.getByLabelText('Input text')).toHaveValue('Later input');
    expect(screen.getByText('Configured/requested model ID: Unknown')).toBeVisible();
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.attempts[0]?.token.intent).toMatchObject({ input: { input_text: 'Original private input', model_id: 'model:chat' } });
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it.each(['mismatch', 'malformed', 'network', 'html'])('execute %s is unknown and refresh never recovers output or resends', async (kind) => {
    const requests = transformationServer(r => { if (!r.url.endsWith('/execute'))
        return undefined; if (kind === 'network')
        throw Error('synthetic network'); return kind === 'html' ? new Response('<html>Login</html>', { status: 200, headers: { 'content-type': 'text/html' } }) : json(kind === 'mismatch' ? { output: 'Wrong output', transformation_id: 'wrong', model_id: 'model:chat' } : { output: 'Missing identity' }); });
    const h = await playground();
    run();
    await screen.findByText(/Do not resend/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transformations' }));
    expect(screen.getByRole('button', { name: 'Run transformation' })).toBeDisabled();
    expect(screen.queryByText('Wrong output')).toBeNull();
    expect(screen.queryByText('Missing identity')).toBeNull();
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.attempts[0]?.phase).toBe('unknown');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/jobs'))).toBe(false);
});
it.each(['loading', 'error', 'equal', 'aba', 'provider', 'control'])('original execution capture is invalidated by %s, never rebound to current input', async (cause) => {
    const requests = transformationServer();
    const h = await playground();
    fireEvent.click(screen.getByRole('button', { name: 'Run transformation' }));
    const s = h.workbench.drafts.configuration, c = readTurnContext()!, owner = s.acquireModels(c)!;
    act(() => {
        if (cause === 'provider')
            h.workbench.controller.invalidateProviderAdmission();
        else if (cause === 'control') {
            const r = h.workbench.drafts.transformations.getSnapshot()[0]!;
            h.workbench.drafts.transformations.playground(r.id, { input: 'Changed' });
        }
        else {
            const rev = owner.loading(c)!;
            if (cause === 'error')
                owner.publish(rev, null, c);
            else if (cause !== 'loading') {
                owner.publish(rev, cause === 'aba' ? [] : configuredModels, c);
                if (cause === 'aba') {
                    const next = owner.loading(c)!;
                    owner.publish(next, configuredModels, c);
                }
            }
        }
    });
    expect(dialog().getByRole('button', { name: 'Confirm action' })).toBeDisabled();
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('model refresh loading and error preserve selected IDs but are not ready, and local text does not alter metadata revision', async () => {
    let reads = 0, done!: (r: Response) => void;
    transformationServer(r => r.url.endsWith('/models') && ++reads === 2 ? new Promise(yes => done = yes) : undefined);
    const h = await playground(), s = h.workbench.drafts.configuration, before = s.getSnapshot()[0]!.metadataRevision;
    fireEvent.change(screen.getByLabelText('Input text'), { target: { value: 'Changed text' } });
    expect(s.getSnapshot()[0]!.metadataRevision).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }));
    await waitFor(() => expect(done).toBeDefined());
    expect(screen.getByLabelText('Language model')).toHaveValue('model:chat');
    expect(screen.getByRole('button', { name: 'Run transformation' })).toBeDisabled();
    await act(async () => done(json({}, 500)));
    expect(screen.getByLabelText('Language model')).toHaveValue('model:chat');
    expect(screen.getByRole('button', { name: 'Run transformation' })).toBeDisabled();
    expect(s.getSnapshot()[0]?.data.models?.some(v => v.id === 'model:chat')).toBe(true);
});
it('retirement freezes original pending work, explicit successor is blank and late response cannot attach', async () => {
    let done!: (r: Response) => void;
    const requests = transformationServer(r => r.url.endsWith('/execute') ? new Promise(yes => done = yes) : undefined);
    const h = await playground();
    run();
    await waitFor(() => expect(done).toBeDefined());
    const original = h.workbench.drafts.transformations.getSnapshot()[0]!;
    await act(async () => { h.workbench.controller.retirePrivacyContext(); await h.workbench.controller.check(); });
    expect(await screen.findByText(/Original record is frozen/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New blank record' }));
    await screen.findByRole('heading', { name: fixture.title });
    tab('Playground');
    expect(screen.getByLabelText('Input text')).toHaveValue('');
    expect(screen.getByLabelText('Transformation')).toHaveValue('');
    expect(screen.getByLabelText('Language model')).toHaveValue('');
    await act(async () => done(json({ output: 'Old answer', transformation_id: fixture.id, model_id: 'model:chat' })));
    expect(screen.queryByText('Old answer')).toBeNull();
    fireEvent.change(screen.getByLabelText('Transformation records'), { target: { value: original.id } });
    expect(screen.getByLabelText('Input text')).toHaveValue('Original private input');
    expect(screen.getByLabelText('Input text')).toBeDisabled();
    expect(h.workbench.drafts.transformations.get(original.id)?.attempts[0]?.phase).toBe('unknown');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('playground replacement asks before changing a dirty explicit choice and keeps input/model', async () => {
    const second = { ...fixture, id: 'transformation:second', title: 'Second transformation' };
    const requests = transformationServer(r => r.method === 'GET' && r.url.endsWith('/transformations') ? json([fixture, second]) : undefined);
    await playground();
    tab('Transformations');
    fireEvent.click(screen.getByRole('button', { name: 'Try Second transformation' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    tab('Playground');
    expect(screen.getByLabelText('Transformation')).toHaveValue(fixture.id);
    tab('Transformations');
    fireEvent.click(screen.getByRole('button', { name: 'Try Second transformation' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    expect(screen.getByLabelText('Transformation')).toHaveValue(second.id);
    expect(screen.getByLabelText('Input text')).toHaveValue('Original private input');
    expect(screen.getByLabelText('Language model')).toHaveValue('model:chat');
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
it('confirmed CRUD invalidates only original-scope transformation metadata and does not alter source selection', async () => {
    transformationServer();
    const h = await open(), invalidate = vi.spyOn(h.queries, 'invalidateQueries');
    const original = h.workbench.drafts.sources.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: 'Delete ' + fixture.title }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate.mock.calls[0]?.[0]).toMatchObject({ queryKey: ['library', 'transformations', expect.any(String)], exact: true });
    expect(h.workbench.drafts.sources.getSnapshot()).toBe(original);
    invalidate.mockRestore();
});
it('prompts/input/output stay out of query keys, mutation variables, URLs, storage and console; unsafe output is inert', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error'), storage = vi.spyOn(Storage.prototype, 'setItem');
    const output = 'private-output-sentinel <img src="https://tracking.invalid/pixel" onerror="alert(1)">', requests = transformationServer(r => r.url.endsWith('/execute') ? json({ output, transformation_id: fixture.id, model_id: 'model:chat' }) : undefined);
    const h = await playground();
    fireEvent.change(screen.getByLabelText('Input text'), { target: { value: 'private-input-sentinel' } });
    run();
    await screen.findByText(/private-output-sentinel/);
    expect(document.querySelector('img[src*="tracking.invalid"]')).toBeNull();
    const exposed = JSON.stringify([h.queries.getQueryCache().getAll().map(q => [q.queryKey, q.state.data]), h.queries.getMutationCache().getAll(), h.router.state, requests.map(r => r.url), log.mock.calls, warn.mock.calls, error.mock.calls, storage.mock.calls]);
    expect(exposed).not.toMatch(/private-input-sentinel|private-output-sentinel|Synthetic prompt/);
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    storage.mockRestore();
});
it('closing editor restores opener focus and explicit discard only removes a safe editor draft', async () => {
    const requests = transformationServer();
    const h = await open();
    fireEvent.click(screen.getByRole('button', { name: 'New transformation' }));
    fireEvent.change(dialog().getByLabelText('Prompt'), { target: { value: 'Safe draft' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Discard editor draft' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm action' }));
    expect(h.workbench.drafts.transformations.getSnapshot()[0]?.editor).toBeNull();
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
it('stale final admission refuses a stored original token even if the visible controls later return A-B-A', async () => {
    const requests = transformationServer();
    const h = await playground(), s = h.workbench.drafts.transformations, r = s.getSnapshot()[0]!, cfg = h.workbench.drafts.configuration.getSnapshot()[0]!;
    let original: TransformationToken | null = null;
    act(() => { original = s.capture(r.id, { kind: 'execute', input: { transformation_id: fixture.id, model_id: 'model:chat', input_text: r.playground.input }, title: fixture.title }, readTurnContext(), 0, 0, { ownerId: cfg.id, metadataRevision: cfg.metadataRevision, sourceRevision: cfg.sources.models!.revision, model: cfg.data.models![0]! }); s.playground(r.id, { input: 'B' }); s.playground(r.id, { input: r.playground.input }); });
    expect(original).not.toBeNull();
    expect(s.begin(original!, readTurnContext(), 0, 0, original!.models)).toBe(false);
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('captures unchanged editor model binding and expires a prompt-only update when its metadata is refreshed', async () => {
    const requests=transformationServer();
    const h=await open();
    fireEvent.click(screen.getByRole('button',{name:'Edit '+fixture.title}));
    await waitFor(()=>expect(dialog().getByLabelText('Prompt')).toHaveValue(fixture.prompt));
    fireEvent.change(dialog().getByLabelText('Prompt'),{target:{value:'Changed prompt'}});
    fireEvent.click(dialog().getByRole('button',{name:'Save transformation'}));
    expect(dialog().getByRole('button',{name:'Confirm action'})).toBeEnabled();
    const owner=h.workbench.drafts.configuration.acquireModels(readTurnContext()!)!;
    let revision:number|null=null;
    act(()=>{revision=owner.loading(readTurnContext());});
    expect(dialog().getByRole('button',{name:'Confirm action'})).toBeDisabled();
    act(()=>owner.publish(revision!,configuredModels,readTurnContext()));
    expect(dialog().getByRole('button',{name:'Confirm action'})).toBeDisabled();
    expect(requests.filter(r=>r.method==='PUT')).toHaveLength(0);
});

it.each([false, true])('confirmed deletion makes the retained editor non-actionable without losing text; dirty=%s', async dirty => {
    let deleted = false;
    const requests = transformationServer(request => {
        if (request.method === 'DELETE') {
            deleted = true;
            return json({message: 'Transformation deleted successfully'});
        }
        if (deleted && request.method === 'GET' && request.url.endsWith('/transformations')) return json([]);
        return undefined;
    });
    const h = await open();
    fireEvent.click(screen.getByRole('button', {name: 'Edit ' + fixture.title}));
    await waitFor(() => expect(dialog().getByLabelText('Prompt')).toHaveValue(fixture.prompt));
    if (dirty) fireEvent.change(dialog().getByLabelText('Prompt'), {target: {value: 'Retained local prompt'}});
    const before = h.workbench.drafts.transformations.getSnapshot()[0]!.editor!;
    fireEvent.click(dialog().getByRole('button', {name: 'Cancel'}));
    fireEvent.click(screen.getByRole('button', {name: 'Delete ' + fixture.title}));
    fireEvent.click(dialog().getByRole('button', {name: 'Confirm action'}));
    await screen.findByText('No transformations yet');
    fireEvent.click(screen.getByRole('button', {name: 'Resume editor'}));
    expect(dialog().getByLabelText('Prompt')).toHaveValue(dirty ? 'Retained local prompt' : fixture.prompt);
    expect(dialog().getByRole('button', {name: 'Save transformation'})).toBeDisabled();
    expect(dialog().getByRole('status')).toHaveTextContent('This transformation was deleted.');
    expect(dialog().getByLabelText('Prompt')).toBeDisabled();
    const after = h.workbench.drafts.transformations.getSnapshot()[0]!;
    expect(after.editor?.target).toBe(fixture.id);
    expect(after.editor?.fields).toEqual(before.fields);
    expect(after.editor?.baseline).toEqual(before.baseline);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]).toMatchObject({phase: 'confirmed', token: {intent: {kind: 'delete', target: fixture.id}}});
    fireEvent.click(dialog().getByRole('button', {name: 'Save transformation'}));
    expect(requests.filter(request => request.method === 'PUT')).toHaveLength(0);
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
});
