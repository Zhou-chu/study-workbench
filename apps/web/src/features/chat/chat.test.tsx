import { useState } from 'react';
import { readTurnContext, RequestNotDispatchedError } from '@study/web-transport';
import { captureEmbeddingDisclosure } from '@study/domain';
import * as turnApi from '../../data/turn-api';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConversationPanel } from './ConversationPanel';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { sourceWorkspace } from '../../test/source-fixtures';
import { json } from '../../test/notebook-fixtures';
import { createDraftRegistry } from '../../app/drafts';
import type { WorkspaceViewV1 } from '@study/contracts';
async function setup(post: (r: Request) => Response | Promise<Response> = () => json({}), workspace = sourceWorkspace()) {
    const requests = sourceServer(r => {
        const p = new URL(r.url).pathname;
        if (p.endsWith('/models/defaults'))
            return json({ default_chat_model: 'synthetic-model' });
        if (p.endsWith('/turns'))
            return r.method === 'POST' ? post(r) : json([]);
        return json({});
    });
    const view = await renderSourceFeature(<ConversationPanel notebookId="n" workspace={workspace}/>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled());
    if ('engine' in workspace.selection! && workspace.selection.engine === 'independent')
        await screen.findByText(/A model is selected/);
    return { ...view, requests, submits: () => requests.filter(r => r.method === 'POST' && new URL(r.url).pathname.endsWith('/turns')) };
}
it('does not send while composing Chinese text, on 229, repeated Enter, or Shift+Enter', async () => {
    const r = await setup();
    const box = screen.getByRole('textbox', { name: 'Question' });
    fireEvent.change(box, { target: { value: '中文问题' } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(box, { key: 'Enter', repeat: true });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(r.submits()).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(r.submits()).toHaveLength(1));
});
it('synchronously latches double clicks and preserves a newer question revision after accepted receipt', async () => {
    let resolve!: (r: Response) => void;
    const r = await setup(() => new Promise(y => { resolve = y; }));
    const box = screen.getByRole('textbox', { name: 'Question' });
    fireEvent.change(box, { target: { value: 'first' } });
    const send = screen.getByRole('button', { name: 'Ask selected sources' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(r.submits()).toHaveLength(1));
    fireEvent.change(box, { target: { value: 'newer' } });
    await act(async () => resolve(json({ job_id: 'parent', turn_id: 'turn', state: 'queued' })));
    expect(box).toHaveValue('newer');
});
it('clears only the exact captured revision on a genuinely accepted receipt', () => {
    const d = createDraftRegistry(), id = { epoch: 2, notebookId: 'n', editorSession: 'q' };
    d.update(id, { question: 'first' });
    const revision = d.get(id)!.questionRevision!;
    d.update(id, { question: 'second' });
    d.clearQuestion(id, revision);
    expect(d.get(id)?.question).toBe('second');
    d.clearQuestion(id, d.get(id)!.questionRevision!);
    expect(d.get(id)?.question).toBe('');
});
it('retains uncertain text and exposes only read-only original recovery, never replay', async () => {
    const r = await setup(() => json({ detail: 'WORKER_UNAVAILABLE', dispatch_receipt: { dispatch_ack: 'unknown', job_id: 'parent', turn_id: 'turn', retry_safe: false } }, 400));
    const box = screen.getByRole('textbox', { name: 'Question' });
    fireEvent.change(box, { target: { value: 'uncertain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await screen.findByRole('button', { name: 'Check original request (read only)' });
    expect(box).toHaveValue('uncertain');
    expect(screen.queryByRole('button', { name: 'Retry original request (sends POST)' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check original request (read only)' }));
    await waitFor(() => expect(r.requests.filter(q => new URL(q.url).pathname.endsWith('/workspace-view'))).toHaveLength(1));
    expect(r.submits()).toHaveLength(1);
    expect(r.requests.some(q => /\/jobs\//.test(q.url))).toBe(false);
});
it('Google unavailability does not switch engine or automatically verify provider', async () => {
    const w = sourceWorkspace();
    w.selection = { engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['remote'] };
    w.link = { remote_notebook_id: 'remote-notebook' };
    const r = await setup(undefined, w);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'test' } });
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled();
    expect(r.requests.some(q => q.url.includes('/connections/notebooklm'))).toBe(false);
    expect(r.submits()).toHaveLength(0);
});
it('history answers never become source IDs, and reused citations retain their originating turn', async () => {
    const w: WorkspaceViewV1 = sourceWorkspace();
    w.turns = [{ turn_id: 'first', message: 'Old question', answer: 'Old answer', status: 'succeeded', citations: [{ citation_id: 'c1', quote: 'Quote', reference_validity: 'unverified' }] }, { turn_id: 'second', message: 'Another question', answer: 'Second answer', status: 'succeeded', citations: [{ citation_id: 'c1', quote: 'Quote', reference_validity: 'unverified' }] }];
    const callback = vi.fn();
    const requests = sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    await renderSourceFeature(<ConversationPanel notebookId="n" workspace={w} onCitation={callback}/>);
    await screen.findByText(/A model is selected/);
    const citations = screen.getAllByRole('button', { name: /c1/ });
    fireEvent.click(citations[1]!);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ citation_id: 'c1' }), expect.objectContaining({ turnId: 'second', focusKey: expect.any(String) }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Next question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    const body = await requests.find(r => r.method === 'POST')!.json();
    expect(body.source_version_ids).toEqual(['v-old']);
    expect(body.message).toBe('Next question');
    expect(body).not.toHaveProperty('history');
});
it('invalid or unacknowledged hybrid never silently sends lexical, and cannot generate outlines', async () => {
    const requests = sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    await renderSourceFeature(<ConversationPanel notebookId="n" workspace={sourceWorkspace()} retrieval={{ options: { retrieval_mode: 'hybrid' }, available: true, isCurrent: () => true }}/>);
    await screen.findByText(/A model is selected/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Hybrid question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    expect(screen.getByRole('button', { name: 'Create study outline' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('uncertain selection disables submission and keeps the source-scope draft visible', async () => {
    const x = await setup();
    const c = x.workbench.controller.getSnapshot();
    expect(c.ready).toBe(true);
    const context = (await import('@study/web-transport')).readTurnContext()!;
    const generation = (await import('@study/web-transport')).sessionCoordinator.current();
    act(() => { x.workbench.drafts.sources.capture('n', { kind: 'selection', selection: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v-new'], remote_source_ids: [] } }, context, generation); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'No stale scope' } });
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled();
    expect(screen.queryByText('v-new')).not.toBeInTheDocument();
    expect(JSON.stringify(x.workbench.drafts.sources.getSnapshot())).toContain('v-new');
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('No stale scope');
    expect(x.submits()).toHaveLength(0);
});
it('keeps one accepted observer and the newer draft while conversation is unmounted and restored', async () => {
    let resolve!: (r: Response) => void;
    function Toggle() { const [show, setShow] = useState(true); return <><button onClick={() => setShow(!show)}>Toggle conversation</button>{show && <ConversationPanel notebookId="n" workspace={sourceWorkspace()}/>}</>; }
    const requests = sourceServer(r => {
        const p = new URL(r.url).pathname;
        if (p.endsWith('/models/defaults'))
            return json({ default_chat_model: 'm' });
        if (p.endsWith('/turns'))
            return r.method === 'POST' ? new Promise(y => { resolve = y; }) : json([]);
        if (p.endsWith('/events'))
            return new Promise(() => { });
        return json({});
    });
    await renderSourceFeature(<Toggle />);
    await screen.findByText(/A model is selected/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'newer draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await act(async () => resolve(json({ job_id: 'j', turn_id: 't', state: 'queued' })));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await screen.findByText(/A model is selected/);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('newer draft');
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled();
    expect(requests.filter(r => new URL(r.url).pathname.endsWith('/events'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop local waiting' }));
    expect(requests.some(r => r.url.endsWith('/cancel'))).toBe(false);
});
it.each(['provider-response','disconnect-intent'] as const)('invalidates verified Google admission after %s without changing selected engine', async cause => {
    const w = sourceWorkspace();
    w.selection = { engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['remote'] };
    w.link = { remote_notebook_id: 'rn', connection_id: 'connection' };
    let invalid = false;
    const requests = sourceServer(r => {
        const p = new URL(r.url).pathname;
        if (p.endsWith('/models/defaults'))
            return json({ default_chat_model: 'm' });
        if (p.endsWith('/turns'))
            return json([]);
        if (p.endsWith('/connections/notebooklm'))
            return json({ state: 'connected' });
        if (p.endsWith('/notebooklm/capabilities'))
            return invalid ? json({ error: { code: 'NEEDS_REAUTH' } }, 409) : json({ operations: [{ name: 'ask', support: 'available' }] });
        return json({});
    });
    const view = await renderSourceFeature(<ConversationPanel notebookId="n" workspace={w}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' }));
    await screen.findByText('Google login verified');
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Question' } });
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeEnabled();
    invalid = true;
    await act(async () => { if(cause==='disconnect-intent')view.workbench.controller.invalidateProviderAdmission();else await view.workbench.controller.transport.send({ method: 'GET', path: '/personal/notebooklm/capabilities', context: readTurnContext()! }); });
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled();
    expect(screen.getByLabelText('Current question scope')).toHaveTextContent('NotebookLM personal connection');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('renders only the canonical confirmed answer after final SSE and releases the next question', async () => {
    let dto: Record<string, unknown> = {};
    const turn = () => ({ turn_id: 't', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: dto.message, idempotency_key: dto.idempotency_key, status: 'succeeded', answer: 'Canonical answer', scope_snapshot: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v-old'], remote_source_ids: [], remote_notebook_id: null }, citations: [], retrieval_request: { retrieval_mode: 'lexical' } });
    const requests = sourceServer(async (r) => {
        const p = new URL(r.url).pathname;
        if (p.endsWith('/models/defaults'))
            return json({ default_chat_model: 'm' });
        if (p.endsWith('/turns')) {
            if (r.method === 'POST') {
                dto = await r.json();
                return json({ job_id: 'j', turn_id: 't', state: 'queued' });
            }
            return json(Object.keys(dto).length ? [turn()] : []);
        }
        if (p.endsWith('/events'))
            return new Response('event: final\ndata: {"turn_id":"t","status":"succeeded","answer":"Unverified SSE answer"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
        return json({});
    }, () => json({ ...sourceWorkspace(), jobs: [{ operation: 'chat', job_id: 'j', turn_id: 't', notebook_id: 'n', chat_session_id: 'v1_n', idempotency_key: dto.idempotency_key, state: 'succeeded', submission_state: 'confirmed', request_snapshot: dto, result: turn() }] }));
    await renderSourceFeature(<ConversationPanel notebookId="n" workspace={sourceWorkspace()}/>);
    await screen.findByText(/A model is selected/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await screen.findByText('Canonical answer');
    expect(screen.queryByText('Unverified SSE answer')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Next' } });
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeEnabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/jobs/'))).toBe(false);
});
it('renders safe Markdown formatting without executing HTML, loading remote images or script links', async () => {
    const w = sourceWorkspace();
    w.turns = [{ turn_id: 't', status: 'succeeded', message: 'Formatting', answer: '## Heading\n\n**Strong text**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$x^2$\n\n<script>alert(1)</script>\n\n![External](https://example.invalid/tracker.png)\n\n[Unsafe](javascript:alert(1))' }];
    sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    const v = await renderSourceFeature(<ConversationPanel notebookId="n" workspace={w}/>);
    await screen.findByRole('heading', { name: 'Heading' });
    expect(v.container.querySelector('strong')).not.toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(v.container.querySelector('.katex')).not.toBeNull();
    expect(v.container.querySelector('script')).toBeNull();
    expect(v.container.querySelector('img')).toBeNull();
    expect(v.container.querySelector('a[href^="javascript:"]')).toBeNull();
});
it('never treats derived independent_support metadata as corroboration and renders unknown coverage safely', async () => {
    const w = sourceWorkspace();
    w.turns = [{ turn_id: 'derived', status: 'succeeded', message: 'Derived question', answer: 'Derived answer', coverage: { selected_source_count: { projection_status: 'unknown' }, retrieved_source_count: 1, evidence_count: 1 }, citations: [{ citation_id: 'c', kind: 'derived_snapshot', independent_support: true, quote: 'Derived quote', reference_validity: 'verified' }] }];
    sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    await renderSourceFeature(<ConversationPanel notebookId="n" workspace={w}/>);
    expect(screen.getByText('A saved snapshot, not independent evidence. Its original references are retained.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('[object Object]');
});
it('keeps coverage risks visible while technical statistics remain expandable', async () => {
    const w = sourceWorkspace();
    w.turns = [{ turn_id: 'coverage', status: 'succeeded', message: 'Coverage question', answer: 'Answer', warnings: ['BOUNDED_OVERVIEW:4', 'CONTEXT_BUDGET:2048'], retrieval: { retrieval_method: 'lexical_fallback', fallback_reason: 'profile unavailable', indexed_version_count: 1, selected_version_count: 3, warnings: [] } }];
    sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    await renderSourceFeature(<ConversationPanel notebookId="n" workspace={w}/>);
    expect(screen.getByText('Bounded outline: based on selected evidence excerpts, not an exhaustive outline of all selected material.')).toBeVisible();
    expect(screen.getByText('Context limit: some retrieved evidence could not be included.')).toBeVisible();
    expect(screen.getByText('Semantic coverage: 1 / 3 selected versions')).not.toBeVisible();
    fireEvent.click(screen.getByText('Technical details'));
    expect(screen.getByText('Semantic coverage: 1 / 3 selected versions')).toBeVisible();
});
it('submits an explicit outline and retains its completed B7 handoff until a consumer is connected', async () => {
    let dto: Record<string, unknown> = {};
    const onOutline = vi.fn();
    function Consumer() { const [connected, setConnected] = useState(false); return <><button onClick={() => setConnected(!connected)}>Toggle outline consumer</button><ConversationPanel notebookId="n" workspace={sourceWorkspace()} onOutlineReady={connected ? onOutline : undefined}/></>; }
    const turn = () => ({ turn_id: 'outline', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: dto.message, idempotency_key: dto.idempotency_key, status: 'succeeded', answer: 'Outline result', scope_snapshot: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v-old'], remote_source_ids: [], remote_notebook_id: null }, citations: [], retrieval_request: { retrieval_mode: 'lexical' } });
    const requests = sourceServer(async (r) => { const p = new URL(r.url).pathname; if (p.endsWith('/models/defaults'))
        return json({ default_chat_model: 'm' }); if (p.endsWith('/turns')) {
        if (r.method === 'POST') {
            dto = await r.json();
            return json({ job_id: 'j', turn_id: 'outline', state: 'succeeded' });
        }
        return json(Object.keys(dto).length ? [turn()] : []);
    } return json({}); }, () => json({ ...sourceWorkspace(), jobs: [{ operation: 'chat', job_id: 'j', turn_id: 'outline', notebook_id: 'n', chat_session_id: 'v1_n', idempotency_key: dto.idempotency_key, state: 'succeeded', submission_state: 'confirmed', request_snapshot: dto, result: turn() }] }));
    await renderSourceFeature(<Consumer />);
    await screen.findByText(/A model is selected/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Keep question draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create study outline' }));
    await screen.findByText('Outline result');
    expect(dto.task).toBe('outline');
    expect(dto.source_version_ids).toEqual(['v-old']);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Keep question draft');
    expect(onOutline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle outline consumer' }));
    await waitFor(() => expect(onOutline).toHaveBeenCalledTimes(1));
    expect(onOutline).toHaveBeenCalledWith(expect.objectContaining({ turn_id: 'outline' }), expect.objectContaining({ notebookId: 'n', sessionId: 'v1_n', turnId: 'outline', operationId: dto.idempotency_key, owner: expect.objectContaining({ questionRevision: 1 }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle outline consumer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle outline consumer' }));
    expect(onOutline).toHaveBeenCalledTimes(1);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/notes'))).toBe(false);
});

it('does not claim a parent task is known when the POST receipt is missing',async()=>{
 await setup();fireEvent.change(screen.getByRole('textbox',{name:'Question'}),{target:{value:'Missing receipt'}});fireEvent.click(screen.getByRole('button',{name:'Ask selected sources'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Check original request (read only)'})).toBeEnabled());expect(screen.queryByText(/A parent task is known/)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Retry original request (sends POST)'})).not.toBeInTheDocument();
});


it.each(['unmapped', 'remote', 'local'] as const)('replaces a persisted running Google row in place with the original strictly confirmed completion after remount (%s mapping)', async mapping => {
    let dto: Record<string, unknown> = {}, finished = false, events!: ReadableStreamDefaultController<Uint8Array>;
    const w = sourceWorkspace(), local = mapping === 'local';
    const originalScope = { selection_origin: local ? 'local' : 'remote', source_version_ids: local ? ['v-old'] : [], remote_source_ids: local ? [] : ['remote'], remote_notebook_id: 'rn' };
    w.selection = { engine: 'notebooklm', ...originalScope };
    w.link = { remote_notebook_id: 'rn', connection_id: 'connection' };
    const turn = () => ({ turn_id: 'google-turn', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'notebooklm', message: String(dto.message), status: finished ? 'succeeded' : 'running', answer: finished ? 'Verified Google answer' : null, scope_snapshot: finished ? { ...originalScope, engine: 'notebooklm', ...(mapping === 'unmapped' ? {} : { source_version_ids: ['v-old'], remote_source_ids: ['remote'] }), mappings: mapping === 'unmapped' ? [] : [{ source_link_id: 'sl', source_version_id: 'v-old', remote_source_id: 'remote', mapping_method: 'upload_hash', last_checked_at: null }], scope_hash: 'resolved-scope' } : originalScope, citations: [], evidence_ids: [], created_at: '2026-11-08T10:00:00Z' });
    function Consumer() { const [shown, setShown] = useState(true); return <><button onClick={() => setShown(!shown)}>Toggle panel</button>{shown && <ConversationPanel notebookId="n" workspace={{ ...w, turns: Object.keys(dto).length ? [turn(), { turn_id: 'after', message: 'Following message', answer: 'Following answer', status: 'succeeded' }] : [] }}/>}</>; }
    const requests = sourceServer(async r => {
        const path = new URL(r.url).pathname;
        if (path.endsWith('/models/defaults')) return json({ default_chat_model: 'm' });
        if (path.endsWith('/connections/notebooklm')) return json({ state: 'connected' });
        if (path.endsWith('/notebooklm/capabilities')) return json({ operations: [{ name: 'ask', support: 'available' }] });
        if (path.endsWith('/turns')) {
            if (r.method === 'POST') { dto = await r.json(); return json({ job_id: 'j', turn_id: 'google-turn', state: 'running' }); }
            return json(Object.keys(dto).length ? [turn()] : []);
        }
        if (path.endsWith('/events')) return new Response(new ReadableStream({ start(c) { events = c; } }), { headers: { 'content-type': 'text/event-stream' } });
        return json({});
    }, () => json({ ...w, jobs: [{ operation: 'chat', job_id: 'j', turn_id: 'google-turn', notebook_id: 'n', chat_session_id: 'v1_n', idempotency_key: dto.idempotency_key, state: 'succeeded', submission_state: 'confirmed', request_snapshot: dto, result: turn() }] }));
    await renderSourceFeature(<Consumer />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' }));
    await screen.findByText('Google login verified');
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Original Google question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await waitFor(() => expect(events).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Toggle panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle panel' }));
    await screen.findByText('Following answer');
    await waitFor(() => expect(requests.filter(r => r.method === 'GET' && new URL(r.url).pathname.endsWith('/turns'))).toHaveLength(2));
    await act(async () => { finished = true; events.enqueue(new TextEncoder().encode('event: final\ndata: {"turn_id":"google-turn","status":"succeeded"}\n\n')); });
    await screen.findByText('Verified Google answer');
    expect(screen.queryByRole('button', { name: 'Check original request (read only)' })).not.toBeInTheDocument();
    expect([...document.querySelectorAll('.chat-message .chat-question')].map(n => n.textContent)).toEqual(['Original Google question', 'Following message']);
    expect(dto.source_version_ids).toEqual(originalScope.source_version_ids);
    expect(dto.remote_source_ids).toEqual(originalScope.remote_source_ids);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.filter(r => new URL(r.url).pathname.endsWith('/events'))).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/jobs/'))).toBe(false);
});

it('shows refreshed completed workspace history instead of an older canonical running row while preserving conflicts and unknown rows', async () => {
    const identity = { turn_id: 'shared', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: 'Same question', idempotency_key: 'key', scope_snapshot: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v-old'], remote_source_ids: [], remote_notebook_id: null }, citations: [] };
    const running = { ...identity, status: 'running', answer: null };
    function Consumer() { const [done, setDone] = useState(false); return <><button onClick={() => setDone(true)}>Refresh workspace</button><ConversationPanel notebookId="n" workspace={{ ...sourceWorkspace(), turns: [done ? { ...identity, status: 'succeeded', answer: 'Refreshed answer' } : running, { ...identity, message: 'Conflicting question', answer: 'Conflicting answer', status: 'succeeded' }, { ...identity, projection_status: 'unknown', answer: 'Unknown historical answer' }] }}/></>; }
    sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([running]));
    await renderSourceFeature(<Consumer />);
    await screen.findByText(/A model is selected/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await screen.findByText('Refreshed answer');
    expect(screen.getByText('Conflicting answer')).toBeInTheDocument();
    expect(screen.getByText('Unknown historical answer')).toBeInTheDocument();
    expect(screen.getAllByText('Same question')).toHaveLength(2);
});

function neverDispatchTurns() {
    const create = turnApi.createTurnApi;
    const attempts: string[] = [];
    vi.spyOn(turnApi, 'createTurnApi').mockImplementation(transport => create({ send: async request => {
        if (request.method === 'POST' && request.path.endsWith('/turns')) { attempts.push(String(request.body)); throw new RequestNotDispatchedError('duplicate'); }
        return transport.send(request);
    } }));
    return attempts;
}
it.each(['lexical', 'different-profile'] as const)('does not revive stale original hybrid disclosure with fresh %s settings', async next => {
    const attempts = neverDispatchTurns();
    const disclosure = captureEmbeddingDisclosure({ profile_id: 'p1', fingerprint: 'fp1', destination_descriptor_version: 'd1', provider: 'fixture', model_id: 'm', model_name: 'Original', revision: 'r1', destination_kind: 'remote', endpoint: 'https://example.invalid/embed' })!;
    let originalCurrent = true;
    function Consumer() {
        const [changed, setChanged] = useState(false);
        const original = { options: { retrieval_mode: 'hybrid' as const, embedding_profile_id: 'p1', disclosed_profile_fingerprint: 'fp1', destination_descriptor_version: 'd1', acknowledge_query_processing: true }, disclosure, available: true, isCurrent: () => originalCurrent };
        const fresh = next === 'lexical' ? { options: { retrieval_mode: 'lexical' as const }, available: true, isCurrent: () => true } : { ...original, options: { ...original.options, embedding_profile_id: 'p2' }, disclosure: captureEmbeddingDisclosure({ profile_id: 'p2', fingerprint: 'fp1', destination_descriptor_version: 'd1', provider: 'fixture', model_id: 'm2', model_name: 'Fresh', revision: 'r2', destination_kind: 'remote', endpoint: 'https://example.invalid/embed' })!, isCurrent: () => true };
        return <><button onClick={() => { originalCurrent = false; setChanged(true); }}>Change retrieval</button><ConversationPanel notebookId="n" workspace={sourceWorkspace()} retrieval={changed ? fresh : original}/></>;
    }
    sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    const view = await renderSourceFeature(<Consumer />);
    await screen.findByText(/A model is selected/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Original hybrid question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    const retry = await screen.findByRole('button', { name: 'Retry original request (sends POST)' });
    expect(retry).toBeEnabled();
    const original = view.workbench.drafts.turns.getSnapshot('n').operation!.capture;
    fireEvent.click(screen.getByRole('button', { name: 'Change retrieval' }));
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(attempts).toHaveLength(1);
    expect(view.workbench.drafts.turns.getSnapshot('n').operation!.capture).toBe(original);
    expect(JSON.parse(attempts[0]!)).toMatchObject({ retrieval_mode: 'hybrid', embedding_profile_id: 'p1' });
    expect(screen.getByRole('button', { name: 'Check original request (read only)' })).toBeEnabled();
});

it.each([false, true])('does not substitute fresh Google availability for retired original model evidence on retry (remount: %s)', async remount => {
    const attempts = neverDispatchTurns();
    let configured = true;
    function Consumer() { const [google, setGoogle] = useState(false), [shown, setShown] = useState(true); const w = sourceWorkspace(); if (google) { w.selection = { engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['remote'] }; w.link = { remote_notebook_id: 'rn', connection_id: 'c' }; } return <><button onClick={() => setGoogle(true)}>Select Google</button><button onClick={() => setShown(!shown)}>Toggle model panel</button>{shown && <ConversationPanel notebookId="n" workspace={w}/>}</>; }
    sourceServer(r => { const p = new URL(r.url).pathname; if (p.endsWith('/models/defaults')) return json({ default_chat_model: configured ? 'm' : null }); if (p.endsWith('/connections/notebooklm')) return json({ state: 'connected' }); if (p.endsWith('/notebooklm/capabilities')) return json({ operations: [{ name: 'ask', support: 'available' }] }); return json([]); });
    await renderSourceFeature(<Consumer />);
    await screen.findByText(/A model is selected/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Local question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await screen.findByRole('button', { name: 'Retry original request (sends POST)' });
    configured = false;
    if (remount) { fireEvent.click(screen.getByRole('button', { name: 'Toggle model panel' })); fireEvent.click(screen.getByRole('button', { name: 'Toggle model panel' })); }
    else fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Reading your sources does not need a model/);
    fireEvent.click(screen.getByRole('button', { name: 'Select Google' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' }));
    await screen.findByText('Google login verified');
    const currentRetry = screen.getByRole('button', { name: 'Retry original request (sends POST)' });
    expect(currentRetry).toBeDisabled();
    fireEvent.click(currentRetry);
    expect(attempts).toHaveLength(1);
});

it.each(['same-owner','replace','A-B-A'] as const)('fences original Google retry after %s while unrelated local model availability remains irrelevant', async change => {
    const attempts = neverDispatchTurns();
    function Consumer() {
        const [local, setLocal] = useState(false), w = sourceWorkspace();
        w.link = { remote_notebook_id: 'rn', connection_id: 'c' };
        if (!local) w.selection = { engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['remote'] };
        return <><button onClick={() => setLocal(!local)}>Select independent</button><ConversationPanel notebookId="n" workspace={w}/></>;
    }
    sourceServer(r => { const p = new URL(r.url).pathname; if (p.endsWith('/models/defaults')) return json({ default_chat_model: null }); if (p.endsWith('/connections/notebooklm')) return json({ state: 'connected' }); if (p.endsWith('/notebooklm/capabilities')) return json({ operations: [{ name: 'ask', support: 'available' }] }); return json([]); });
    await renderSourceFeature(<Consumer />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' }));
    await screen.findByText('Google login verified');
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Original Google question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask selected sources' }));
    await screen.findByRole('button', { name: 'Retry original request (sends POST)' });
    if(change!=='same-owner')fireEvent.click(screen.getByRole('button', { name: 'Select independent' }));
    if(change==='A-B-A')fireEvent.click(screen.getByRole('button', { name: 'Select independent' }));
    expect(screen.getByRole('button', { name: 'Ask selected sources' })).toBeDisabled();
    const retry = screen.getByRole('button', { name: 'Retry original request (sends POST)' });
    if(change==='same-owner'){
        expect(retry).toBeEnabled();fireEvent.click(retry);
        await waitFor(() => expect(attempts).toHaveLength(2));expect(attempts[1]).toBe(attempts[0]);
    }else{expect(retry).toBeDisabled();fireEvent.click(retry);expect(attempts).toHaveLength(1);}
    expect(JSON.parse(attempts[0]!)).toMatchObject({ engine: 'notebooklm', remote_source_ids: ['remote'] });
    expect(screen.getByRole('button',{name:'Check original request (read only)'})).toBeEnabled();
});

it.each(['selection','unmount'] as const)('keeps original lexical default admission invalid after %s A-B-A without losing original recovery',async kind=>{
 const attempts=neverDispatchTurns();
 function Consumer(){const [b,setB]=useState(false),[show,setShow]=useState(true);const w=sourceWorkspace();if(b)w.selection={...w.selection,engine:'independent',selection_origin:'local',source_version_ids:['v-new'],remote_source_ids:[]};return <><button onClick={()=>setB(!b)}>Change selection</button><button onClick={()=>setShow(!show)}>Mount owner</button>{show&&<ConversationPanel notebookId="n" workspace={w}/>}</>}
 sourceServer(r=>new URL(r.url).pathname.endsWith('/models/defaults')?json({default_chat_model:'m'}):json([]));
 const h=await renderSourceFeature(<Consumer/>);await screen.findByText(/A model is selected/);fireEvent.change(screen.getByRole('textbox',{name:'Question'}),{target:{value:'Original lexical'}});fireEvent.click(screen.getByRole('button',{name:'Ask selected sources'}));expect(await screen.findByRole('button',{name:'Retry original request (sends POST)'})).toBeEnabled();
 const original=h.workbench.drafts.turns.getSnapshot('n').operation!.capture;
 fireEvent.click(screen.getByRole('button',{name:kind==='selection'?'Change selection':'Mount owner'}));fireEvent.click(screen.getByRole('button',{name:kind==='selection'?'Change selection':'Mount owner'}));
 await screen.findByText(/A model is selected/);expect(screen.getByRole('button',{name:'Retry original request (sends POST)'})).toBeDisabled();expect(attempts).toHaveLength(1);expect(h.workbench.drafts.turns.getSnapshot('n').operation!.capture).toBe(original);
});
