import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useNavigate } from 'react-router';
import { NotebookPage } from '../notebooks/NotebookPage';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { sourceWorkspace } from '../../test/source-fixtures';
import { json } from '../../test/notebook-fixtures';
import { citation, readerDetail, deferred } from '../../test/reader-fixtures';
function HistoryControls() { const navigate = useNavigate(); return <><button onClick={() => navigate(-1)}>Test history back</button><button onClick={() => navigate(1)}>Test history forward</button></>; }
it('opens citations in the live shell, keeps conversation and returns focus through Back', async () => { const w = sourceWorkspace(); const turn = { turn_id: 't1', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: 'Question preserved', answer: 'Answer preserved', status: 'succeeded', citations: [citation()] }; const requests = sourceServer(request => { const p = new URL(request.url).pathname; if (p.endsWith('/turns'))
    return json([turn]); if (p.includes('/source-versions/'))
    return json(readerDetail()); return json({}); }, () => json(w)); await renderSourceFeature(<><HistoryControls /><NotebookPage /></>, '/notebooks/n'); const origin = await screen.findByRole('button', { name: 'c1 · Retained version' }); expect(origin).toBeEnabled(); fireEvent.click(origin); expect(await screen.findByRole('searchbox', { name: 'Search extracted text' })).toBeInTheDocument(); expect(screen.getByText('Answer preserved')).toBeInTheDocument(); const draft=screen.getByRole('textbox',{name:'Question'}); fireEvent.change(draft,{target:{value:'Unsent preserved'}}); fireEvent.click(screen.getByRole('button',{name:'Expand answers'})); expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','conversation'); fireEvent.click(origin); await waitFor(()=>expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','balanced')); expect(screen.getByRole('textbox',{name:'Question'})).toBe(draft); expect(draft).toHaveValue('Unsent preserved'); expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-reader-open', 'true'); fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } }); await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1)); const patch = requests.find(r => r.method === 'PATCH')!; expect(await patch.clone().json()).toMatchObject({ source_version_ids: ['v-old'], remote_source_ids: [], reading: { source_version_id: 'v-old', page_index: 3 } }); fireEvent.click(screen.getByRole('button', { name: 'Test history back' })); await waitFor(() => expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-reader-open', 'false')); expect(origin).toHaveFocus(); fireEvent.click(screen.getByRole('button', { name: 'Test history forward' })); await screen.findByRole('searchbox', { name: 'Search extracted text' }); expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1); });
it('keeps a later reading position visibly unsaved while a previous selection write is unresolved', async () => { const pending = deferred<Response>(); const turn = { turn_id: 't1', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: 'Q', answer: 'A', status: 'succeeded', citations: [citation()] }; const requests = sourceServer(request => { const p = new URL(request.url).pathname; if (request.method === 'PATCH')
    return pending.promise; if (p.endsWith('/turns'))
    return json([turn]); if (p.includes('/source-versions/'))
    return json(readerDetail()); return json({}); }); await renderSourceFeature(<NotebookPage />, '/notebooks/n'); fireEvent.click(await screen.findByRole('button', { name: 'c1 · Retained version' })); await screen.findByRole('searchbox', { name: 'Search extracted text' }); fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } }); fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } }); expect(await screen.findByText('This reading position is only kept here. Save it when the current selection has been confirmed.')).toBeInTheDocument(); expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1); await act(async () => pending.resolve(json({}))); expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1); expect(screen.getByRole('spinbutton')).toHaveValue(5); });

it('saves reading against an authoritative later selection, not the stale workspace object', async () => {
 const turn={turn_id:'t1',notebook_id:'n',chat_session_id:'v1_n',engine:'independent',message:'Q',answer:'A',status:'succeeded',citations:[citation()]};
 const requests=sourceServer(request=>{const p=new URL(request.url).pathname;if(p.endsWith('/turns'))return json([turn]);if(p.includes('/source-versions/'))return json(readerDetail());return json({});});
 const h=await renderSourceFeature(<NotebookPage/>,'/notebooks/n');fireEvent.click(await screen.findByRole('button',{name:'c1 · Retained version'}));await screen.findByRole('searchbox',{name:'Search extracted text'});
 act(()=>{const context=readTurnContext()!;const store=h.workbench.drafts.sources;const token=store.beginWorkspaceRead('n',context,sessionCoordinator.current());const newer=sourceWorkspace();newer.selection={engine:'independent',selection_origin:'local',source_version_ids:['v-new'],remote_source_ids:[]};expect(store.acceptWorkspaceRead(token,newer,context,sessionCoordinator.current())).toBe(true);});
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'4'}});await waitFor(()=>expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(1));expect(await requests.find(r=>r.method==='PATCH')!.clone().json()).toMatchObject({source_version_ids:['v-new'],reading:{source_version_id:'v-old',page_index:3}});
});

it('keeps narrow keyboard recovery inside the modal through settlement and explicit save', async () => {
    vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: query === '(max-width: 899px)', media: query, onchange: null, addListener() {}, removeListener() {}, dispatchEvent() { return true; }, addEventListener() {}, removeEventListener() {} } as MediaQueryList));
    const pending = deferred<Response>();
    let patches = 0;
    const turn = { turn_id: 't1', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: 'Q', answer: 'A', status: 'succeeded', citations: [citation()] };
    const requests = sourceServer(request => {
        const path = new URL(request.url).pathname;
        if (request.method === 'PATCH') return ++patches === 1 ? pending.promise : json({});
        if (path.endsWith('/turns')) return json([turn]);
        if (path.includes('/source-versions/')) return json(readerDetail());
        return json({});
    });
    await renderSourceFeature(<NotebookPage/>, '/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'c1 · Retained version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reader' });
    await within(dialog).findByRole('searchbox');
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '5' } });
    const recovery = await screen.findByRole('button', { name: 'Save reading position' });
    expect(dialog).toContainElement(recovery);
    expect(within(dialog).getByText('This reading position is only kept here. Save it when the current selection has been confirmed.')).toBeInTheDocument();
    expect(recovery).toBeDisabled();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Physical page 9' })).toHaveFocus();
    await act(async () => pending.resolve(json({})));
    await waitFor(() => expect(recovery).toBeEnabled());
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(recovery).toHaveFocus();
    fireEvent.keyDown(recovery, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(recovery).toHaveFocus();
    // JSDOM has no native Enter activation: dispatch its resulting click only
    // after the real focus trap has made this control keyboard-reachable.
    fireEvent.keyDown(recovery, { key: 'Enter' });
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(2));
    expect(await requests.filter(r => r.method === 'PATCH')[1]!.clone().json()).toMatchObject({ source_version_ids: ['v-old'], remote_source_ids: [], reading: { source_version_id: 'v-old', page_index: 4 } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save reading position' })).not.toBeInTheDocument());
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Physical page 9' })).toHaveFocus();
    expect(within(dialog).getByRole('spinbutton')).toHaveValue(5);
});
