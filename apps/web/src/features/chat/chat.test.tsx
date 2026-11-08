import { useState } from 'react';
import { readTurnContext } from '@study/web-transport';
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
    expect(screen.getByText('v-new')).toBeInTheDocument();
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
it('invalidates verified Google admission after provider evidence changes without changing selected engine', async () => {
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
    await act(async () => { await view.workbench.controller.transport.send({ method: 'GET', path: '/personal/notebooklm/capabilities', context: readTurnContext()! }); });
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
it('keeps bounded outline and context-budget limits visible with semantic coverage beside the answer', async () => {
    const w = sourceWorkspace();
    w.turns = [{ turn_id: 'coverage', status: 'succeeded', message: 'Coverage question', answer: 'Answer', warnings: ['BOUNDED_OVERVIEW:4', 'CONTEXT_BUDGET:2048'], retrieval: { retrieval_method: 'lexical_fallback', fallback_reason: 'profile unavailable', indexed_version_count: 1, selected_version_count: 3, warnings: [] } }];
    sourceServer(r => new URL(r.url).pathname.endsWith('/models/defaults') ? json({ default_chat_model: 'm' }) : json([]));
    await renderSourceFeature(<ConversationPanel notebookId="n" workspace={w}/>);
    expect(screen.getByText('Bounded outline: based on selected evidence excerpts, not an exhaustive outline of all selected material.')).toBeVisible();
    expect(screen.getByText('Context limit: some retrieved evidence could not be included.')).toBeVisible();
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
