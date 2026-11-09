import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sourceContext, sourceWorkspace } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useStudio } from './use-studio';
import { StudioPanel } from './StudioPanel';
import { RemoteAudioControls } from './RemoteAudioControls';
import { PortableDialog } from './PortableDialog';
const workspace = sourceWorkspace();
beforeEach(sourceContext);
it('does not revive old audio confirmation or artifact page after A to B to A', async () => { let change!: (v: string) => void; const requests = sourceServer(r => json(r.url.endsWith('/capabilities') ? { operations: [{ name: 'generate_audio', support: 'available' }, { name: 'list_artifacts', support: 'available' }, { name: 'download_artifact', support: 'available' }] } : r.url.endsWith('/connections/notebooklm') ? { state: 'connected' } : [{ id: 'ra', title: 'Remote audio A', kind: 'audio', status: 'ready', remote_source_ids: ['rs'] }])); function Panel() { const [remote, setRemote] = useState('A'); change = setRemote; const c = useStudio('n'); return <RemoteAudioControls notebookId="n" workspace={{ ...workspace, selection: { engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['rs'] }, link: { remote_notebook_id: remote } }} connection={c}/>; } await renderSourceFeature(<Panel />); fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Generate audio overview' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'List Google artifacts' })); await screen.findByText('Remote audio A'); fireEvent.click(screen.getByRole('button', { name: 'Generate audio overview' })); await act(async () => change('B')); await act(async () => change('A')); expect(screen.queryByText('Remote audio A')).not.toBeInTheDocument(); expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled(); expect(requests.some(r => r.method === 'POST')).toBe(false); });
it('opens editors on intent and preserves a dirty note across close, resume and tab changes', async () => { sourceServer(); await renderSourceFeature(<StudioPanel notebookId="n" workspace={workspace}/>); expect(screen.queryByLabelText('Markdown note')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'New Note' })); fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Synthetic draft' } }); fireEvent.change(screen.getByLabelText('Markdown note'), { target: { value: 'Retain me' } }); fireEvent.click(screen.getByRole('button', { name: 'Close' })); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep draft and open' })); expect(screen.queryByLabelText('Markdown note')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Resume draft' })); expect(screen.getByLabelText('Markdown note')).toHaveValue('Retain me'); fireEvent.click(screen.getByRole('button', { name: 'Tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Notes' })); expect(screen.getByLabelText('Note title')).toHaveValue('Synthetic draft'); });
it('Save Answer keeps one unkeyed POST after lost ACK and repeated clicks', async () => { const requests = sourceServer(r => r.url.endsWith('/notes') && r.method === 'POST' ? Promise.reject(new Error('Synthetic lost ACK')) : json({})); function Panel() { const c = useStudio('n'); return <><button onClick={() => c.saveAnswer({ turn_id: 't', notebook_id: 'n', status: 'succeeded', message: 'Synthetic question', answer: 'Synthetic answer', citations: [], scope_snapshot: { source_version_ids: ['v-old'] } })}>Save synthetic answer</button><StudioPanel notebookId="n" workspace={workspace}/></>; } const h = await renderSourceFeature(<Panel />); fireEvent.click(screen.getByText('Save synthetic answer')); await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.saveResult).toBe('unknown')); fireEvent.click(screen.getByText('Save synthetic answer')); expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/notes'))).toHaveLength(1); expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.base.scope_snapshot).toEqual({ source_version_ids: ['v-old'] }); expect(h.workbench.navigation.requestNavigation({ destination: '/elsewhere' })).toBe('blocked'); });
it('retains one ZIP in application memory across unmount and blocks unknown import replay', async () => { let toggle!: (v: boolean) => void; const requests = sourceServer(r => r.url.endsWith('/imports/portable') ? Promise.reject(new Error('Synthetic lost ACK')) : json({})); function Panel() { const [show, setShow] = useState(true); toggle = setShow; const c = useStudio('n'); return show ? <PortableDialog notebookId="n" connection={c}/> : null; } const h = await renderSourceFeature(<Panel />); const file = new File(['ZIP'], 'synthetic.zip'); fireEvent.change(screen.getByLabelText('Restore project package'), { target: { files: [file] } }); await act(async () => toggle(false)); expect(h.workbench.drafts.studio.getSnapshot().operations[0]?.payload).toEqual({ kind: 'import', file }); await act(async () => toggle(true)); fireEvent.click(screen.getByRole('button', { name: 'Restore project package' })); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })); await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().operations[0]?.operation.state).toBe('unknown')); expect(screen.getByLabelText('Restore project package')).toBeDisabled(); expect(requests.filter(r => r.url.endsWith('/imports/portable'))).toHaveLength(1); const row = h.workbench.drafts.studio.getSnapshot().operations[0]!; expect(h.workbench.drafts.studio.begin(row.id, readTurnContext(), sessionCoordinator.current())).toBeNull(); });
it('renders a real controlled conflict comparison and only saves after explicit re-edit', async () => {
    const base = { id: 'note:1', note_id: 'note:1', notebook_id: 'n', revision: 7, title: 'Synthetic base', content: 'Original', citations: [], scope_snapshot: { source_version_ids: ['v-old'] } };
    let server = { ...base, revision: 8, content: 'External writer' };
    const requests = sourceServer(async (r) => {
        if (r.method === 'PATCH' && r.url.endsWith('/notes/note%3A1')) {
            const payload = await r.json();
            if (payload.expected_revision !== server.revision)
                return json({ detail: { code: 'NOTE_REVISION_CONFLICT', current_revision: server.revision } }, 409);
            server = { ...server, ...payload, revision: 9 };
            return json(server);
        }
        return json({});
    }, () => json({ ...workspace, notes: [server] }));
    await renderSourceFeature(<StudioPanel notebookId="n" workspace={{ ...workspace, notes: [base] }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Markdown note'), { target: { value: 'My local draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('This note changed elsewhere. Your draft is safe here. Compare before replacing it.');
    expect(screen.getByLabelText('Markdown note')).toHaveValue('My local draft');
    fireEvent.click(screen.getByRole('button', { name: 'Compare with server' }));
    await screen.findByText('External writer');
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit my draft against this revision' }));
    expect(screen.getByLabelText('Markdown note')).toHaveValue('My local draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Saved', { selector: 'p' });
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(2);
    expect(server).toMatchObject({ revision: 9, content: 'My local draft', scope_snapshot: base.scope_snapshot });
    expect(requests.some(r => r.url.endsWith('/selection'))).toBe(false);
});
it('renders nullable classic notes and sends only an explicitly edited title on PUT', async () => {
    let body: unknown;
    const raw = { id: 'note:native', revision: 7, title: null, content: null, note_type: 'human' };
    const requests = sourceServer(async (r) => {
        if (r.method === 'PUT') {
            body = await r.json();
            return json({ ...raw, revision: 8, title: 'Named' });
        }
        return json({});
    });
    await renderSourceFeature(<StudioPanel notebookId="n" workspace={{ ...workspace, notes: [raw] }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Markdown note')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Named' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Saved', { selector: 'p' });
    expect(body).toEqual({ title: 'Named', expected_revision: 7 });
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
    expect(requests.some(r => r.method === 'PATCH')).toBe(false);
});

import { Message } from '../chat/Message';
import { producerCitation } from '../../test/studio-fixtures';
it('saves from the real mounted Save Answer action with ordinary producer citations',async()=>{const citation=producerCitation(),turn={turn_id:'cited-answer',notebook_id:'n',status:'succeeded',message:'Cited question',answer:'Cited answer',citations:[citation],scope_snapshot:{source_version_ids:['v-old']}};let payload:unknown;const requests=sourceServer(async r=>{if(r.method==='POST'&&r.url.endsWith('/notes')){payload=await r.json();return json({id:'note:cited',notebook_id:'n',revision:1,...payload as object});}return json({});});function Panel(){const c=useStudio('n');return <Message turn={turn} index={0} onSaveAnswer={c.saveAnswer}/>;}const h=await renderSourceFeature(<Panel/>);fireEvent.click(screen.getByRole('button',{name:'Save answer to notes'}));await waitFor(()=>expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.saveResult).toBe('saved'));expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.base.citations).toEqual([citation]);expect(payload).toMatchObject({citations:[citation]});expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);});

it('dispatches two successive explicit exports with distinct keys after known completion',async()=>{const keys:string[]=[];const requests=sourceServer(async r=>{if(r.method==='POST'&&r.url.endsWith('/exports')){const body=await r.json();keys.push(body.idempotency_key);return json({job_id:'job:'+body.idempotency_key,notebook_id:'n',operation:'portable_export',idempotency_key:body.idempotency_key,state:'succeeded',submission_state:'confirmed',result:{export_id:'export_a',download_url:'/api/personal/exports/export_a/download'}},202);}return json({});});function Panel(){const c=useStudio('n');return <PortableDialog notebookId="n" connection={c}/>;}const h=await renderSourceFeature(<Panel/>);for(let i=1;i<=2;i++){fireEvent.click(screen.getByRole('button',{name:'Export project'}));await waitFor(()=>expect(h.workbench.drafts.studio.getSnapshot().operations.filter(r=>r.operation.state==='succeeded')).toHaveLength(i));}expect(new Set(keys).size).toBe(2);expect(requests.filter(r=>r.method==='POST')).toHaveLength(2);});
it('dispatches two successive explicit audio generations after acknowledged success',async()=>{const keys:string[]=[];const requests=sourceServer(async r=>{if(r.method==='POST'&&r.url.endsWith('/artifacts/audio')){const body=await r.json();keys.push(body.idempotency_key);return json({job_id:'job:'+body.idempotency_key,notebook_id:'n',operation:'audio',idempotency_key:body.idempotency_key,state:'succeeded',submission_state:'confirmed',result:{downloaded:false,artifact:{id:'remote-audio',title:'Generated audio',kind:'audio',status:'ready',remote_source_ids:['rs']}}});}return json(r.url.endsWith('/capabilities')?{operations:[{name:'generate_audio',support:'available'}]}:r.url.endsWith('/connections/notebooklm')?{state:'connected'}:{});});function Panel(){const c=useStudio('n');return <RemoteAudioControls notebookId="n" workspace={{...workspace,selection:{engine:'notebooklm',selection_origin:'remote',source_version_ids:[],remote_source_ids:['rs']},link:{remote_notebook_id:'A'}}} connection={c}/>;}const h=await renderSourceFeature(<Panel/>);fireEvent.click(screen.getByRole('button',{name:'Verify Google connection'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Generate audio overview'})).toBeEnabled());for(let i=1;i<=2;i++){fireEvent.click(screen.getByRole('button',{name:'Generate audio overview'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm'}));await waitFor(()=>expect(h.workbench.drafts.studio.getSnapshot().operations.filter(r=>r.operation.state==='succeeded')).toHaveLength(i));}expect(new Set(keys).size).toBe(2);expect(requests.filter(r=>r.method==='POST')).toHaveLength(2);});

it('loads retained local audio from a restored cancelled job without Google or job dispatch',async()=>{const bytes=new TextEncoder().encode('AUDIO'),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),artifact={artifact_id:'artifact_restored',notebook_id:'n',mime_type:'audio/wav',byte_size:5,sha256:sha};const NativeURL=URL;vi.stubGlobal('URL',class extends NativeURL{static createObjectURL(){return 'blob:synthetic-restored-audio';}static revokeObjectURL(){}});const requests=sourceServer(r=>r.url.endsWith('/artifacts/artifact_restored/download')?new Response(bytes,{headers:{'content-type':'audio/wav'}}):json({}));const restored={job_id:'job:restored',notebook_id:'n',operation:'download',state:'cancelled_local',historical_state:'succeeded',submission_state:'not_submitted',restored_history:true,replay_allowed:false,idempotency_key:'restored:job:restored',result:{downloaded:true,artifact}};await renderSourceFeature(<StudioPanel notebookId="n" workspace={{...workspace,jobs:[restored,{...restored,job_id:'job:foreign',result:{downloaded:true,artifact:{...artifact,notebook_id:'other'}}}]}}/>);fireEvent.click(screen.getByRole('button',{name:'Tasks'}));expect(screen.getAllByRole('button',{name:'Play saved audio'})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Play saved audio'}));await waitFor(()=>expect(document.querySelector('audio')).toHaveAttribute('src','blob:synthetic-restored-audio'));expect(screen.getByRole('link',{name:'Download'})).toHaveAttribute('href','blob:synthetic-restored-audio');expect(requests.filter(r=>r.url.includes('/personal/artifacts/'))).toHaveLength(1);expect(requests.filter(r=>r.method!=='GET'||r.url.includes('/notebooklm')||r.url.includes('/personal/jobs/'))).toHaveLength(0);});

it.each([['audio','A-B-A'],['audio','remount'],['download','A-B-A'],['download','remount']] as const)('never revives retained %s job observation/cancellation after %s',async(kind,transition)=>{let change!:(remote:string)=>void,toggle!:(shown:boolean)=>void;const requests=sourceServer(async r=>{if(r.method==='POST'&&(r.url.endsWith('/artifacts/audio')||r.url.endsWith('/download'))){const body=await r.json();return json({job_id:'job:'+body.idempotency_key,notebook_id:'n',operation:kind,idempotency_key:body.idempotency_key,state:'queued',submission_state:'not_submitted'});}if(r.url.endsWith('/capabilities'))return json({operations:[{name:'generate_audio',support:'available'},{name:'list_artifacts',support:'available'},{name:'download_artifact',support:'available'}]});if(r.url.endsWith('/connections/notebooklm'))return json({state:'connected'});if(r.url.endsWith('/artifacts'))return json([{id:'remote-artifact',title:'Remote saved result',kind:'audio',status:'ready',remote_source_ids:['rs']}]);return json({});});function Panel(){const [remote,setRemote]=useState('A'),[shown,setShown]=useState(true);change=setRemote;toggle=setShown;const c=useStudio('n');return shown?<RemoteAudioControls notebookId="n" workspace={{...workspace,selection:{engine:'notebooklm',selection_origin:'remote',source_version_ids:[],remote_source_ids:['rs']},link:{remote_notebook_id:remote}}} connection={c}/>:null;}const h=await renderSourceFeature(<Panel/>);fireEvent.click(screen.getByRole('button',{name:'Verify Google connection'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Generate audio overview'})).toBeEnabled());if(kind==='audio')fireEvent.click(screen.getByRole('button',{name:'Generate audio overview'}));else{fireEvent.click(screen.getByRole('button',{name:'List Google artifacts'}));await screen.findByText('Remote saved result');fireEvent.click(screen.getByRole('button',{name:'Save remote artifact locally'}));}fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm'}));await waitFor(()=>expect(h.workbench.drafts.studio.getSnapshot().operations[0]?.job?.state).toBe('queued'));expect(screen.getByRole('button',{name:'Refresh'})).toBeEnabled();expect(screen.getByRole('button',{name:'Stop local waiting'})).toBeEnabled();const token=h.workbench.drafts.studio.getSnapshot().operations[0]!.operation.token;if(transition==='A-B-A'){await act(async()=>change('B'));await act(async()=>change('A'));}else{await act(async()=>toggle(false));await act(async()=>toggle(true));}expect(screen.getByRole('button',{name:'Refresh'})).toBeDisabled();expect(screen.getByRole('button',{name:'Stop local waiting'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Refresh'}));fireEvent.click(screen.getByRole('button',{name:'Stop local waiting'}));expect(h.workbench.drafts.studio.getSnapshot().operations[0]!.operation.token).toBe(token);expect(requests.filter(r=>r.url.includes('/personal/jobs/'))).toHaveLength(0);expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);});

import { producerCitationRepresentations } from '../../test/studio-fixtures';
import type { WorkbenchNote } from '@study/contracts';
it('re-edits revision 7 ACK nulls against revision 8 workspace omissions and explicitly saves revision 9 with original metadata', async () => {
    const { withNulls, withoutNulls } = producerCitationRepresentations();
    const initial = { id: 'note:wire', note_id: 'note:wire', notebook_id: 'n', revision: 6, title: 'Cited note', content: 'Initial body', citations: [withNulls], scope_snapshot: { source_version_ids: ['v-old'] } };
    let server: WorkbenchNote = initial;
    const payloads: Record<string, unknown>[] = [];
    const requests = sourceServer(async r => {
        if (r.method === 'PATCH' && r.url.endsWith('/notes/note%3Awire')) {
            const payload = await r.json();
            payloads.push(payload);
            if (payload.expected_revision !== server.revision) return json({ detail: { code: 'NOTE_REVISION_CONFLICT', current_revision: server.revision } }, 409);
            server = { ...server, title: payload.title, content: payload.content, revision: server.revision + 1, citations: [withNulls] };
            return json({ ...server, notebook_id: 'n' });
        }
        return json({});
    }, () => json({ ...workspace, notes: [{ ...server, note_id: server.id, notebook_id: 'n' }] }));
    const h = await renderSourceFeature(<StudioPanel notebookId="n" workspace={{ ...workspace, notes: [initial] }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Markdown note'), { target: { value: 'Acknowledged at seven' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.baseRevision).toBe(7));
    const originalBase = h.workbench.drafts.studio.getSnapshot().notes[0]!.editor.base;
    expect(originalBase.citations).toEqual([withNulls]);
    server = { ...server, revision: 8, content: 'External revision eight', citations: [withoutNulls] };
    fireEvent.change(screen.getByLabelText('Markdown note'), { target: { value: 'My retained reasoning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('This note changed elsewhere. Your draft is safe here. Compare before replacing it.');
    fireEvent.click(screen.getByRole('button', { name: 'Compare with server' }));
    await screen.findByText('External revision eight');
    const before = h.workbench.drafts.studio.getSnapshot().notes[0]!;
    expect(before.latest?.citations).toEqual([withoutNulls]);
    expect(payloads.map(p => p.expected_revision)).toEqual([6, 7]);
    const reedit = screen.getByRole('button', { name: 'Edit my draft against this revision' });
    expect(reedit).toBeEnabled();
    fireEvent.click(reedit);
    const after = h.workbench.drafts.studio.getSnapshot().notes[0]!;
    expect(after.editor.baseRevision).toBe(8);
    expect(after.editor.base.citations).toEqual([withNulls]);
    expect(after.editor.base.scope_snapshot).toEqual(initial.scope_snapshot);
    expect(after.history[0]?.editor.base).toBe(originalBase);
    expect(after.history[0]).toMatchObject({ latest: { revision: 8, citations: [withoutNulls] }, comparison: [{ revision: 8, citations: [withoutNulls] }] });
    expect(screen.getByLabelText('Markdown note')).toHaveValue('My retained reasoning');
    expect(payloads).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.baseRevision).toBe(9));
    expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.saveResult).toBe('saved');
    expect(payloads[2]).toEqual({ title: 'Cited note', content: 'My retained reasoning', citations: [withNulls], scope_snapshot: initial.scope_snapshot, expected_revision: 8 });
    expect(payloads.map(p => p.expected_revision)).toEqual([6, 7, 8]);
    expect(originalBase.citations).toEqual([withNulls]);
    expect(before.latest?.citations).toEqual([withoutNulls]);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});

it.each(['disconnect-intent','link-reservation'] as const)('blocks the original audio confirmation after %s and never revives it through fresh proof',async change=>{
 const requests=sourceServer(r=>json(r.url.endsWith('/capabilities')?{operations:[{name:'generate_audio',support:'available'},{name:'list_artifacts',support:'available'}]}:r.url.endsWith('/connections/notebooklm')?{state:'connected'}:{}));
 const w={...workspace,selection:{engine:'notebooklm' as const,selection_origin:'remote' as const,source_version_ids:[],remote_source_ids:['rs']},link:{remote_notebook_id:'A'}};
 function Panel(){const c=useStudio('n');return <RemoteAudioControls notebookId="n" workspace={w} connection={c}/>}
 const h=await renderSourceFeature(<Panel/>);
 fireEvent.click(screen.getByRole('button',{name:'Verify Google connection'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate audio overview'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Generate audio overview'}));
 act(()=>{if(change==='disconnect-intent')h.workbench.controller.invalidateProviderAdmission();else h.workbench.drafts.sources.reserveSelection('n',{...w.selection,remote_source_ids:[]},readTurnContext()!,sessionCoordinator.current(),{providerRevision:h.workbench.controller.getSnapshot().providerEvidenceRevision,remoteNotebookId:'B'})});
 expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm'})).toBeDisabled();
 await act(async()=>{await h.workbench.controller.verifyProviderConnection()});
 expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm'})).toBeDisabled();
 expect(h.workbench.controller.getSnapshot().ready).toBe(true);
 expect(screen.getByRole('button',{name:'List Google artifacts',hidden:true})).toBeDisabled();
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm'}));expect(requests.some(r=>r.method==='POST')).toBe(false);
});

it('does not admit audio artifact listing through a fresh verification while a link transaction is unresolved',async()=>{
 const requests=sourceServer(r=>json(r.url.endsWith('/capabilities')?{operations:[{name:'list_artifacts',support:'available'}]}:{state:'connected'}));
 function Panel(){const c=useStudio('n');return <RemoteAudioControls notebookId="n" workspace={{...workspace,link:{remote_notebook_id:'A'}}} connection={c}/>}
 const h=await renderSourceFeature(<Panel/>);
 act(()=>{h.workbench.drafts.sources.reserveSelection('n',{engine:'notebooklm',selection_origin:'remote',source_version_ids:[],remote_source_ids:[]},readTurnContext()!,sessionCoordinator.current(),{providerRevision:0,remoteNotebookId:'B'})});
 fireEvent.click(screen.getByRole('button',{name:'Verify Google connection'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Verify Google connection'})).toBeEnabled());
 expect(screen.getByRole('button',{name:'List Google artifacts'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'List Google artifacts'}));
 expect(requests.some(r=>r.url.endsWith('/artifacts'))).toBe(false);
});
