import {selection,sourceWorkspace} from '../../test/source-fixtures';
import {act,fireEvent,screen,within,waitFor} from '@testing-library/react';
import {expect,it} from 'vitest';
import {libraryServer,renderLibrary} from '../../test/library-harness';
import {json} from '../../test/notebook-fixtures';
import {notebook,libraryWorkspace} from '../../test/library-fixtures';
import {readTurnContext,sessionCoordinator} from '@study/web-transport';

function server(handler?:(r:Request)=>Response|undefined|Promise<Response|undefined>){
 return libraryServer(async r=>{
  const custom=await handler?.(r);if(custom)return custom;
  const p=new URL(r.url).pathname;
  if(p==='/api/credentials/status')return json({configured:{},source:{},encryption_configured:false});
  if(p==='/api/credentials/env-status')return json({});
  if(p==='/api/notebooks/n')return json(notebook);
  return undefined;
 });
}
async function open(){
 const h=await renderLibrary('/notebooks/n');
 fireEvent.click(await screen.findByRole('button',{name:'Notebook settings'}));
 await waitFor(()=>expect(within(screen.getByRole('dialog')).getByLabelText('Name')).toHaveValue(notebook.name));
 return {...h,dialog:()=>within(screen.getByRole('dialog'))};
}
it('opens actual notebook settings without replacing the workspace, and closes without a mutation',async()=>{
 const requests=server();const h=await open();
 const draft={epoch:readTurnContext()!.epoch,notebookId:'n',editorSession:'fixture'};
 const file=new File(['synthetic'],'fixture.txt');act(()=>h.workbench.drafts.update(draft,{question:'Keep me',file}));
 expect(h.dialog().getByLabelText('Name')).toHaveValue(notebook.name);
 fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 expect(h.workbench.drafts.get(draft)?.file).toBe(file);
 expect(h.workbench.drafts.get(draft)?.question).toBe('Keep me');
 expect(requests.filter(r=>r.method!=='GET')).toHaveLength(0);
});
it('uses presence-aware notebook saves and retains edits made while saving',async()=>{
 let resolve!:(r:Response)=>void;
 const requests=server(r=>r.method==='PUT'?new Promise<Response>(yes=>resolve=yes):undefined);
 const h=await open();
 fireEvent.change(h.dialog().getByLabelText('Description'),{target:{value:'First'}});
 fireEvent.click(h.dialog().getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(resolve).toBeDefined());
 fireEvent.change(h.dialog().getByLabelText('Description'),{target:{value:'Second'}});
 await act(async()=>resolve(json({...notebook,description:'First'})));
 expect(h.dialog().getByLabelText('Description')).toHaveValue('Second');
 expect(await requests.find(r=>r.method==='PUT')!.clone().json()).toEqual({description:'First'});
});
it('shows actual delete impacts, keeps the exclusive-source choice explicit and latches confirmation',async()=>{
 let resolve!:(r:Response)=>void;
 const requests=server(r=>r.url.endsWith('/delete-preview')?json({notebook_id:'n',notebook_name:notebook.name,note_count:2,exclusive_source_count:3,shared_source_count:4}):r.method==='DELETE'?new Promise<Response>(yes=>resolve=yes):undefined);
 const h=await open();fireEvent.click(h.dialog().getByRole('button',{name:'Delete Notebook'}));
 expect(await h.dialog().findByText(/2 note/)).toBeVisible();
 expect(h.dialog().getByText(/chat sessions/i)).toBeVisible();
 fireEvent.click(h.dialog().getByLabelText('Delete exclusive sources'));
 fireEvent.click(h.dialog().getByRole('button',{name:'Delete Forever'}));
 fireEvent.click(h.dialog().getByRole('button',{name:'Delete Forever'}));
 await waitFor(()=>expect(requests.filter(r=>r.method==='DELETE')).toHaveLength(1));
 expect(new URL(requests.find(r=>r.method==='DELETE')!.url).searchParams.get('delete_exclusive_sources')).toBe('true');
 await act(async()=>resolve(json({malformed:true})));
 expect(h.dialog().getByText(/still unresolved/)).toBeVisible();
});
it('changes engine through the complete source writer without discarding either source list or reading',async()=>{
 const requests=server();const h=await open();
 fireEvent.change(h.dialog().getByLabelText('Answer engine'),{target:{value:'notebooklm'}});
 await waitFor(()=>expect(requests.some(r=>r.method==='PATCH')).toBe(true));
 const dto=await requests.find(r=>r.method==='PATCH')!.clone().json();
 expect(dto).toEqual({...selection,engine:'notebooklm'});
});
it('does not prefetch provider status; publishes one actual verification with null quota and strict isolation capability',async()=>{
 const requests=server(r=>r.url.endsWith('/connections/notebooklm')?json({state:'connected',account_label:null,last_verified_at:null,reason:null,quota:null}):r.url.endsWith('/notebooklm/capabilities')?json({sdk_version:'0.8.5',adapter_version:'1',operations:[{name:'ask',support:'unsupported',reason:'SCOPE_ISOLATION_UNAVAILABLE',last_verified_at:null,sdk_version:'0.8.5',adapter_version:'1'}]}):undefined);
 const h=await open();fireEvent.click(h.dialog().getByRole('button',{name:'Connections'}));
 expect(requests.filter(r=>r.url.endsWith('/connections/notebooklm'))).toHaveLength(0);
 fireEvent.click(h.dialog().getByRole('button',{name:'Verify Google connection'}));
 await waitFor(()=>expect(requests.filter(r=>r.url.endsWith('/connections/notebooklm'))).toHaveLength(1));
 expect(await h.dialog().findByText('Quota is unknown')).toBeVisible();
 expect(h.dialog().getByText(/SCOPE_ISOLATION_UNAVAILABLE/)).toBeVisible();
});
it('closing transient reauthentication leaves readiness suspended and clears the password',async()=>{
 server();const h=await renderLibrary();
 act(()=>sessionCoordinator.report('reauth-required',sessionCoordinator.current()));
 const password=await screen.findByLabelText('Password');fireEvent.change(password,{target:{value:'synthetic-private'}});
 fireEvent.click(screen.getByRole('button',{name:'Close reauthentication'}));
 expect(screen.queryByLabelText('Password')).toBeNull();
 expect(h.workbench.controller.getSnapshot().ready).toBe(false);
 expect(screen.getByRole('button',{name:'Resume sign-in'})).toHaveFocus();
});
it('publishes deliberate local signout and honest server evidence without treating a resolved action as revocation',async()=>{
 server();const h=await renderLibrary();
 await act(async()=>h.workbench.controller.signoutLocal());
 expect(h.workbench.controller.getSnapshot()).toMatchObject({signedOutLocally:true,localSignoutConfirmed:true,serverRevocation:'not-performed',ready:false});
});

const matrix={sdk_version:'0.8.5',adapter_version:'1',operations:['list_notebooks','create_notebook','ask'].map(name=>({name,support:name==='ask'?'unsupported':'available',reason:name==='ask'?'SCOPE_ISOLATION_UNAVAILABLE':null,last_verified_at:null,sdk_version:'0.8.5',adapter_version:'1'}))};
function remoteServer(handler?:(r:Request)=>Response|undefined|Promise<Response|undefined>){
 return server(async r=>{const v=await handler?.(r);if(v)return v;const p=new URL(r.url).pathname;
 if(p.endsWith('/connections/notebooklm'))return json({state:'connected',quota:0,account_label:null,last_verified_at:null,reason:null});
 if(p.endsWith('/notebooklm/capabilities'))return json(matrix);
 if(p.endsWith('/notebooklm/notebooks'))return json({items:[{id:'remote/one',title:'Remote one'}],next_cursor:'opaque&?=next',listing_complete:false,completeness_note:'Recently viewed only'});
 return undefined});
}
async function remoteOpen(){const h=await open();fireEvent.click(h.dialog().getByRole('button',{name:'Connections'}));fireEvent.click(h.dialog().getByRole('button',{name:'Verify Google connection'}));await waitFor(()=>expect(h.dialog().getByRole('button',{name:'List Google notebooks'})).toBeEnabled());return h}
it('archives and unarchives with exact presence-aware bodies and acknowledged baselines',async()=>{
 const requests=server(async r=>r.method==='PUT'?json({...notebook,...await r.clone().json()}):undefined);const h=await open();
 fireEvent.click(h.dialog().getByRole('button',{name:'Archive'}));await h.dialog().findByRole('button',{name:'Unarchive'});
 fireEvent.click(h.dialog().getByRole('button',{name:'Unarchive'}));await h.dialog().findByRole('button',{name:'Archive'});
 expect(await Promise.all(requests.filter(r=>r.method==='PUT').map(r=>r.clone().json()))).toEqual([{archived:true},{archived:false}]);
});
it('renames without clearing an absent description, and explicitly clears a description',async()=>{
 let current={...notebook}; const requests=server(async r=>{if(r.method==='PUT'){current={...current,...await r.clone().json()};return json(current)}return undefined});const h=await open();
 fireEvent.change(h.dialog().getByLabelText('Name'),{target:{value:'New title'}});fireEvent.click(h.dialog().getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.baseline?.name).toBe('New title'));
 expect(await requests.find(r=>r.method==='PUT')!.clone().json()).toEqual({name:'New title'});
 fireEvent.change(h.dialog().getByLabelText('Description'),{target:{value:'Then clear'}});fireEvent.click(h.dialog().getByRole('button',{name:'Save'}));await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.baseline?.description).toBe('Then clear'));
 fireEvent.change(h.dialog().getByLabelText('Description'),{target:{value:''}});fireEvent.click(h.dialog().getByRole('button',{name:'Save'}));await waitFor(()=>expect(requests.filter(r=>r.method==='PUT')).toHaveLength(3));expect(await requests.filter(r=>r.method==='PUT')[2]!.clone().json()).toEqual({description:''});
});
it('cancels delete without a write and sends explicit false for the keep option',async()=>{
 const requests=server(r=>r.url.endsWith('/delete-preview')?json({notebook_id:'n',notebook_name:notebook.name,note_count:0,exclusive_source_count:1,shared_source_count:1}):r.method==='DELETE'?json({message:'Deleted',deleted_notes:0,deleted_sources:0,unlinked_sources:2,deleted_chat_sessions:1}):undefined);const h=await open();
 fireEvent.click(h.dialog().getByRole('button',{name:'Delete Notebook'}));await h.dialog().findByText(/Notes and chat/);fireEvent.click(h.dialog().getByRole('button',{name:'Cancel'}));
 expect(requests.some(r=>r.method==='DELETE')).toBe(false);
 fireEvent.click(h.dialog().getByRole('button',{name:'Delete Notebook'}));await h.dialog().findByText(/Notes and chat/);fireEvent.click(h.dialog().getByLabelText('Unlink and keep them'));fireEvent.click(h.dialog().getByRole('button',{name:'Delete Forever'}));await waitFor(()=>expect(requests.some(r=>r.method==='DELETE')).toBe(true));expect(new URL(requests.find(r=>r.method==='DELETE')!.url).searchParams.get('delete_exclusive_sources')).toBe('false');
});
it('changes origin without changing sources or reading and keeps unknown fields non-actionable',async()=>{
 const requests=server();const h=await open();fireEvent.change(h.dialog().getByLabelText('Source scope'),{target:{value:'remote'}});
 await waitFor(()=>expect(requests.some(r=>r.method==='PATCH')).toBe(true));expect(await requests.find(r=>r.method==='PATCH')!.clone().json()).toEqual({...selection,selection_origin:'remote'});
});
it('retains dirty notebook settings through dismissal and the one navigation confirmation',async()=>{
 server();const h=await open();fireEvent.change(h.dialog().getByLabelText('Description'),{target:{value:'Retain this'}});fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 fireEvent.click(screen.getByRole('button',{name:'Notebook settings'}));expect(within(screen.getByRole('dialog')).getByLabelText('Description')).toHaveValue('Retain this');
});
it('loads only explicit recent notebook pages with the exact opaque returned cursor',async()=>{
 const requests=remoteServer();const h=await remoteOpen();expect(requests.some(r=>new URL(r.url).pathname.endsWith('/notebooklm/notebooks'))).toBe(false);
 fireEvent.click(h.dialog().getByRole('button',{name:'List Google notebooks'}));await h.dialog().findByText(/Recently viewed only/);
 fireEvent.click(h.dialog().getByRole('button',{name:'Next'}));fireEvent.click(h.dialog().getByRole('button',{name:'Next'}));
 await waitFor(()=>expect(requests.filter(r=>new URL(r.url).pathname.endsWith('/notebooklm/notebooks'))).toHaveLength(2));expect(new URL(requests.filter(r=>new URL(r.url).pathname.endsWith('/notebooklm/notebooks'))[1]!.url).searchParams.get('cursor')).toBe('opaque&?=next');
});
it('unknown link does not clear selection or repeat POST, and keeps the original reservation',async()=>{
 const requests=remoteServer(r=>r.url.endsWith('/notebooklm-link')?json({bad:true}):undefined);const h=await remoteOpen();fireEvent.click(h.dialog().getByRole('button',{name:'List Google notebooks'}));await h.dialog().findByText(/Recently viewed only/);fireEvent.change(h.dialog().getByLabelText('Google notebook'),{target:{value:'remote/one'}});fireEvent.click(h.dialog().getByRole('button',{name:'Link selected notebook'}));await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(0);expect(h.workbench.drafts.sources.getSnapshot().find(r=>r.payload.kind==='selection')?.reserved).toBe(true);expect(h.dialog().getByRole('button',{name:'Link selected notebook'})).toBeDisabled();
});
it('acknowledged link clears remote IDs through the same writer and preserves two-stage unknown outcome',async()=>{
 const requests=remoteServer(r=>r.url.endsWith('/notebooklm-link')?json({link_id:'link',notebook_id:'n',connection_id:'notebooklm',remote_notebook_id:'remote/one',last_checked_at:'now'}):r.method==='PATCH'?new Response('bad',{status:200,headers:{'content-type':'application/json'}}):undefined);
 const h=await remoteOpen();fireEvent.click(h.dialog().getByRole('button',{name:'List Google notebooks'}));await h.dialog().findByText(/Recently viewed only/);fireEvent.change(h.dialog().getByLabelText('Google notebook'),{target:{value:'remote/one'}});fireEvent.click(h.dialog().getByRole('button',{name:'Link selected notebook'}));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 const writes=requests.filter(r=>r.method==='POST'||r.method==='PATCH');expect(writes.map(r=>r.method)).toEqual(['POST','PATCH']);expect(await writes[1]!.clone().json()).toEqual({...selection,remote_source_ids:[]});expect(h.dialog().getByText(/Link confirmed;/)).toBeVisible();
});
it('connect and reconnect show real unavailable manual flow, refresh is explicit, and never invent a login URL',async()=>{
 const flow={flow_id:'flow/synthetic',state:'unavailable',expires_at:'2000-01-01T00:00:00Z',reason:'Login flow expired. Start reconnect to try again.'};
 const requests=remoteServer(r=>r.url.includes('/connections/notebooklm/connect')||r.url.endsWith('/reconnect')?json(flow):undefined);
 const h=await open();fireEvent.click(h.dialog().getByRole('button',{name:'Connections'}));fireEvent.click(h.dialog().getByRole('button',{name:'Start manual Google sign-in'}));await h.dialog().findByText(/flow has expired/);
 expect(h.dialog().queryByRole('link',{name:/Google/})).toBeNull();fireEvent.click(h.dialog().getByRole('button',{name:'Reconnect Google'}));await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.kind).toBe('reconnect'));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('succeeded'));fireEvent.click(h.dialog().getByRole('button',{name:'Refresh'}));
 await waitFor(()=>expect(requests.some(r=>new URL(r.url).pathname.endsWith('/connect/flow%2Fsynthetic'))).toBe(true));
});
it('remote create captures the confirmed original title and unknown receipt permits no job GET or replay',async()=>{
 const requests=remoteServer(r=>r.method==='POST'&&r.url.endsWith('/notebooklm/notebooks')?json({malformed:true}):undefined);const h=await remoteOpen();
 fireEvent.change(h.dialog().getByLabelText('New Google notebook title'),{target:{value:'Captured title'}});fireEvent.click(h.dialog().getByRole('button',{name:'Create Google notebook'}));expect(h.dialog().getByText(/quota or charges/)).toBeVisible();
 fireEvent.click(h.dialog().getByRole('button',{name:'Confirm'}));fireEvent.click(h.dialog().queryByRole('button',{name:'Confirm'})??h.dialog().getByRole('button',{name:'Create Google notebook'}));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 const writes=requests.filter(r=>r.method==='POST'&&r.url.endsWith('/notebooklm/notebooks'));expect(writes).toHaveLength(1);expect(await writes[0]!.clone().json()).toEqual({notebook_id:'n',title:'Captured title',idempotency_key:expect.any(String)});expect(requests.some(r=>r.url.includes('/personal/jobs/'))).toBe(false);
});
it('disconnect requires its exact confirmation and retires every original memory owner without claiming app signout',async()=>{
 const requests=remoteServer(r=>r.method==='DELETE'?json({state:'disconnected',quota:null,account_label:null,last_verified_at:null,reason:null}):undefined);const h=await remoteOpen(),old=readTurnContext()!.epoch;
 fireEvent.click(h.dialog().getByRole('button',{name:'Clear local connection'}));expect(requests.some(r=>r.method==='DELETE')).toBe(false);fireEvent.click(h.dialog().getByRole('button',{name:'Confirm'}));await waitFor(()=>expect(h.workbench.controller.getSnapshot().privacyChanged).toBe(true));expect(h.workbench.controller.getSnapshot().signedOutLocally).toBe(false);expect(h.workbench.drafts.settings.getSnapshot()[0]?.retired).toBe(true);expect(readTurnContext()!.epoch).toBeGreaterThan(old);
});

it('reverification does not renew the old remote listing or its selected link',async()=>{
 const requests=remoteServer();const h=await remoteOpen();fireEvent.click(h.dialog().getByRole('button',{name:'List Google notebooks'}));await h.dialog().findByText(/Recently viewed only/);fireEvent.change(h.dialog().getByLabelText('Google notebook'),{target:{value:'remote/one'}});expect(h.dialog().getByRole('button',{name:'Link selected notebook'})).toBeEnabled();
 fireEvent.click(h.dialog().getByRole('button',{name:'Verify Google connection'}));await waitFor(()=>expect(h.dialog().getByRole('button',{name:'List Google notebooks'})).toBeEnabled());expect(h.dialog().getByRole('button',{name:'Link selected notebook'})).toBeDisabled();expect(h.dialog().getByRole('button',{name:'Next'})).toBeDisabled();expect(requests.filter(r=>r.method==='POST')).toHaveLength(0);
});
it('stale remote-create confirmation cannot submit an edited title',async()=>{
 const requests=remoteServer();const h=await remoteOpen();fireEvent.change(h.dialog().getByLabelText('New Google notebook title'),{target:{value:'Original'}});fireEvent.click(h.dialog().getByRole('button',{name:'Create Google notebook'}));fireEvent.change(h.dialog().getByLabelText('New Google notebook title'),{target:{value:'Changed'}});expect(h.dialog().getByRole('button',{name:'Confirm'})).toBeDisabled();fireEvent.click(h.dialog().getByRole('button',{name:'Cancel'}));expect(requests.some(r=>r.method==='POST')).toBe(false);
});
it.each(['waiting_remote','queued','running'])('observes only an acknowledged original create %s on an explicit click and never automatically links it',async state=>{
 let receipt:Record<string,unknown>|undefined;
 const requests=remoteServer(async r=>{if(r.method==='POST'&&r.url.endsWith('/notebooklm/notebooks')){const body=await r.clone().json();const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({operation:'create_notebook',request:{title:body.title}})));const request_hash=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');receipt={job_id:'owned',notebook_id:'n',operation:'create_notebook',provider:'notebooklm',idempotency_key:body.idempotency_key,request_hash,request_snapshot:{title:body.title},state,submission_state:state==='waiting_remote'?'confirmed':'not_submitted'};return json(receipt)}if(r.url.endsWith('/personal/jobs/owned'))return json({...receipt,state:'succeeded',submission_state:'confirmed',result:{remote_notebook_id:'created-remote'}});return undefined});
 const h=await remoteOpen();fireEvent.change(h.dialog().getByLabelText('New Google notebook title'),{target:{value:'Created'}});fireEvent.click(h.dialog().getByRole('button',{name:'Create Google notebook'}));fireEvent.click(h.dialog().getByRole('button',{name:'Confirm'}));
 const observe=await h.dialog().findByRole('button',{name:'Tasks · Refresh'});expect(requests.some(r=>r.url.includes('/personal/jobs/'))).toBe(false);fireEvent.click(observe);await h.dialog().findByText('created-remote');expect(requests.filter(r=>r.url.includes('/personal/jobs/'))).toHaveLength(1);expect(requests.some(r=>r.url.endsWith('/notebooklm-link')||r.method==='PATCH')).toBe(false);
});
it('shows unsupported engine and origin visibly without coercing or writing either one',async()=>{
 const w=libraryWorkspace();w.selection={engine:'future-engine',selection_origin:'future-origin',source_version_ids:['v-old'],remote_source_ids:[]} as unknown as typeof w.selection;
 const requests=libraryServer(r=>new URL(r.url).pathname==='/api/notebooks/n'?json(notebook):undefined,()=>json(w));const h=await open();
 expect(h.dialog().getByLabelText('Answer engine')).toBeDisabled();expect(h.dialog().getByLabelText('Source scope')).toBeDisabled();expect(h.dialog().getByText(/future-engine/)).toBeInTheDocument();expect(requests.some(r=>r.method==='PATCH')).toBe(false);
});
it('mounts tools and guarded settings destinations and reuses one setup metadata projection',async()=>{
 const requests=server();await renderLibrary('/notebooks/n');fireEvent.click(await screen.findByRole('button',{name:'Tools'}));expect(screen.getAllByRole('link',{name:'Models'}).some(a=>a.getAttribute('href')==='/settings/models')).toBe(true);
 const docs=await screen.findByRole('link',{name:/documentation|docs/i});expect(docs).toHaveAttribute('href','https://github.com/lfnovo/open-notebook/blob/main/docs/3-USER-GUIDE/api-configuration.md#encryption-setup');
 fireEvent.click(screen.getByRole('link',{name:'Settings'}));expect(await screen.findByRole('heading',{name:'Settings'})).toBeVisible();for(const name of ['Models','Transformations','Advanced'])expect(screen.getAllByRole('link',{name}).length).toBeGreaterThan(0);
 expect(requests.filter(r=>new URL(r.url).pathname==='/api/credentials/status')).toHaveLength(1);
});


// B9a fix round 1: mounted cross-owner paths, using only synthetic producers.
function linkServer(initial:string|null,outcome:'success'|'link-unknown'|'clear-unknown'='success'){
 let w=sourceWorkspace();w.link=initial?{remote_notebook_id:initial}:null;
 const requests=libraryServer(async r=>{const p=new URL(r.url).pathname;
  if(p==='/api/notebooks/n')return json(notebook);
  if(p==='/api/credentials/status')return json({configured:{},source:{},encryption_configured:true});
  if(p==='/api/credentials/env-status')return json({});
  if(p.endsWith('/connections/notebooklm'))return json({state:'connected',quota:0,account_label:null,last_verified_at:null,reason:null});
  if(p.endsWith('/notebooklm/capabilities'))return json({...matrix,operations:[...matrix.operations,...['list_sources','upload_source','fetch_source_text'].map(name=>({name,support:'available',reason:null,last_verified_at:null,sdk_version:'0.8.5',adapter_version:'1'}))]});
  if(p.endsWith('/notebooklm/notebooks'))return json({items:[{id:'remote/one',title:'Remote one'}],next_cursor:null,listing_complete:true,completeness_note:null});
  if(p.endsWith('/notebooklm-link')){w={...w,link:{remote_notebook_id:'remote/one'}};return outcome==='link-unknown'?json({bad:true}):json({link_id:'link',notebook_id:'n',connection_id:'notebooklm',remote_notebook_id:'remote/one',last_checked_at:'now'})}
  if(r.method==='PATCH'){w={...w,selection:await r.clone().json()};return outcome==='clear-unknown'?new Response('bad',{headers:{'content-type':'application/json'}}):json({})}
  return undefined;
 },()=>json(w));return requests;
}
async function chooseLink(h:Awaited<ReturnType<typeof remoteOpen>>){
 fireEvent.click(h.dialog().getByRole('button',{name:'List Google notebooks'}));
 await h.dialog().findByRole('option',{name:'Remote one'});
 fireEvent.change(h.dialog().getByLabelText('Google notebook'),{target:{value:'remote/one'}});
 fireEvent.click(h.dialog().getByRole('button',{name:'Link selected notebook'}));
}
it.each(['A',null])('publishes a reconciled link from %s to the real retained workspace consumers',async initial=>{
 const requests=linkServer(initial),h=await remoteOpen();await chooseLink(h);
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('succeeded'));
 fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.getByRole('region',{name:'Google connection'})).toHaveTextContent('remote/one'));
 expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(1);
 expect(requests.filter(r=>r.url.endsWith('/notebooklm-link'))).toHaveLength(1);
});
it.each(['link-unknown','clear-unknown'] as const)('blocks retained remote sync after %s, closing settings and explicitly verifying again',async outcome=>{
 const requests=linkServer('A',outcome),h=await remoteOpen();await chooseLink(h);
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 const remote=within(screen.getByRole('region',{name:'Google connection'}));
 fireEvent.click(remote.getByRole('button',{name:'Verify Google connection'}));
 await remote.findByText('upload_source: available');
 expect(remote.getByRole('button',{name:'Sync selected originals to Google'})).toBeDisabled();
 fireEvent.click(remote.getByRole('button',{name:'Sync selected originals to Google'}));
 expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
});
it('invalidates provider admission at disconnect intent while pending and unknown, without retiring local work',async()=>{
 let finish!:(r:Response)=>void;
 remoteServer(r=>r.method==='DELETE'?new Promise(resolve=>finish=resolve):undefined);
 const h=await remoteOpen(),before=h.workbench.controller.getSnapshot().providerEvidenceRevision,epoch=readTurnContext()!.epoch;
 fireEvent.click(h.dialog().getByRole('button',{name:'Clear local connection'}));
 fireEvent.click(h.dialog().getByRole('button',{name:'Confirm'}));
 expect(h.workbench.controller.getSnapshot().providerEvidenceRevision).toBeGreaterThan(before);
 expect(h.workbench.controller.getSnapshot()).toMatchObject({ready:true,signedOutLocally:false,privacyChanged:false});
 await waitFor(()=>expect(finish).toBeTypeOf('function'));
 await act(async()=>finish(json({bad:true})));
 expect(h.workbench.controller.getSnapshot().providerVerification).toBeNull();
 expect(readTurnContext()!.epoch).toBe(epoch);
 fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 expect(within(screen.getByRole('region',{name:'Sources'})).getByRole('button',{name:'Add sources'})).toBeEnabled();
});
it.each([false,true])('keeps retired dirty settings reachable across remount (closed at retirement: %s)',async closed=>{
 server();const h=await open();
 fireEvent.change(h.dialog().getByLabelText('Description'),{target:{value:'Frozen original description'}});
 const original=h.workbench.drafts.settings.getSnapshot()[0]!;
 if(closed)fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 act(()=>h.workbench.controller.retirePrivacyContext());await act(async()=>h.workbench.controller.check());
 await waitFor(()=>expect(h.workbench.controller.getSnapshot().ready).toBe(true));
 await act(async()=>{await h.queries.refetchQueries({queryKey:['workspace']})});
 if(!closed)fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Close'}));
 fireEvent.click(await screen.findByRole('button',{name:'Notebook settings'}));
 expect(within(screen.getByRole('dialog')).getByLabelText('Description')).toHaveValue('Frozen original description');
 expect(within(screen.getByRole('dialog')).getByLabelText('Description')).toBeDisabled();
 expect(h.workbench.drafts.settings.getSnapshot()).toHaveLength(1);
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'New'}));
 await waitFor(()=>expect(within(screen.getByRole('dialog')).getByLabelText('Description')).toHaveValue(''));
 expect(h.workbench.drafts.settings.get(original.id)?.fields.description).toBe('Frozen original description');
 fireEvent.change(h.dialog().getByRole('combobox',{name:'Notebook settings'}),{target:{value:original.id}});
 fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 await act(async()=>{await h.router.navigate('/settings')});
 if(h.workbench.navigation.getSnapshot().capture)act(()=>h.workbench.navigation.confirm(h.workbench.navigation.getSnapshot().capture));
 await waitFor(()=>expect(h.router.state.location.pathname).toBe('/settings'));
 await act(async()=>{await h.router.navigate('/notebooks/n')});
 fireEvent.click(await screen.findByRole('button',{name:'Notebook settings'}));
 expect(within(screen.getByRole('dialog')).getByLabelText('Description')).toHaveValue('Frozen original description');
 expect(within(screen.getByRole('dialog')).getByLabelText('Description')).toBeDisabled();

});
it('allows a new explicit selection after an unknown link retires without replaying the old reservation',async()=>{
 const requests=linkServer('A','link-unknown'),h=await remoteOpen();await chooseLink(h);
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 const old=h.workbench.drafts.sources.getSnapshot().find(r=>r.payload.kind==='selection')!;
 act(()=>h.workbench.controller.retirePrivacyContext());await act(async()=>h.workbench.controller.check());
 await waitFor(()=>expect(h.workbench.controller.getSnapshot().ready).toBe(true));
 await act(async()=>{await h.queries.refetchQueries({queryKey:['workspace']})});
 fireEvent.click(h.dialog().getByRole('button',{name:'New'}));
 await waitFor(()=>expect(h.dialog().getByLabelText('Answer engine')).toBeEnabled());
 fireEvent.change(h.dialog().getByLabelText('Answer engine'),{target:{value:'notebooklm'}});
 await waitFor(()=>expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(1));
 expect(h.workbench.drafts.sources.get(old.id)?.retired).toBe(true);
 expect(h.workbench.drafts.sources.begin(old.id,readTurnContext(),sessionCoordinator.current())).toBeNull();
 expect(requests.filter(r=>r.url.endsWith('/notebooklm-link'))).toHaveLength(1);
});

it.each(['failed','cancelled_local','needs_reauth','succeeded'])('requires an explicit blank successor after producer terminal create %s, retaining the original receipt',async state=>{
 let key='';
 remoteServer(async r=>{if(r.method==='POST'&&r.url.endsWith('/notebooklm/notebooks')){const body=await r.clone().json();key=body.idempotency_key;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({operation:'create_notebook',request:{title:body.title}})));return json({job_id:'owned-terminal',notebook_id:'n',operation:'create_notebook',provider:'notebooklm',idempotency_key:key,request_hash:[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''),request_snapshot:{title:body.title},state,submission_state:state==='succeeded'?'confirmed':'not_submitted',...(state==='succeeded'?{result:{remote_notebook_id:'created'}}:{})})}return undefined});
 const h=await remoteOpen();
 fireEvent.change(h.dialog().getByLabelText('New Google notebook title'),{target:{value:'Original title'}});
 fireEvent.click(h.dialog().getByRole('button',{name:'Create Google notebook'}));fireEvent.click(h.dialog().getByRole('button',{name:'Confirm'}));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.metadata.create?.state).toBe(state));
 const original=h.workbench.drafts.settings.getSnapshot()[0]!;
 expect(h.dialog().getByRole('button',{name:'Create Google notebook'})).toBeDisabled();
 fireEvent.click(h.dialog().getByRole('button',{name:'New'}));
 await waitFor(()=>expect(h.dialog().getByLabelText('New Google notebook title')).toHaveValue(''));
 expect(h.workbench.drafts.settings.get(original.id)?.metadata.create).toMatchObject({job_id:'owned-terminal',idempotency_key:key,title:'Original title'});
 expect(h.workbench.drafts.settings.get(original.id)?.retired).toBe(true);
});

it.each([false,true])('keeps an unknown link receipt inspectable after retirement, remount and blank successor (closed: %s)',async closed=>{
 const requests=linkServer('A','link-unknown'),h=await remoteOpen();await chooseLink(h);
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 const old=h.workbench.drafts.settings.getSnapshot()[0]!;
 if(closed)fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 act(()=>h.workbench.controller.retirePrivacyContext());await act(async()=>h.workbench.controller.check());
 await act(async()=>{await h.queries.refetchQueries({queryKey:['workspace']})});
 if(!closed)fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 fireEvent.click(await screen.findByRole('button',{name:'Notebook settings'}));
 expect(h.dialog().getByText(old.command!.id)).toBeVisible();
 fireEvent.click(h.dialog().getByRole('button',{name:'Connections'}));
 expect(h.dialog().getByLabelText('Google notebook')).toHaveValue('remote/one');
 expect(h.dialog().getByLabelText('Google notebook')).toBeDisabled();
 fireEvent.click(h.dialog().getByRole('button',{name:'New'}));
 const fresh=h.workbench.drafts.settings.getSnapshot().find(r=>!r.retired)!;
 expect(fresh.fields.remoteId).toBe('');
 fireEvent.change(h.dialog().getByRole('combobox',{name:'Notebook settings'}),{target:{value:old.id}});
 expect(h.dialog().getByText(old.command!.id)).toBeVisible();
 expect(h.workbench.drafts.settings.get(old.id)?.command?.id).toBe(old.command!.id);
 expect(requests.filter(r=>r.url.endsWith('/notebooklm-link'))).toHaveLength(1);
});

it('publishes an exactly reconciled unknown clear without repeating either transaction write',async()=>{
 const requests=linkServer('A','clear-unknown'),h=await remoteOpen();await chooseLink(h);
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('unknown'));
 fireEvent.click(h.dialog().getByRole('button',{name:'Check original request (read only)'}));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]?.command?.status).toBe('succeeded'));
 fireEvent.click(h.dialog().getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.getByRole('region',{name:'Google connection'})).toHaveTextContent('remote/one'));
 expect(h.workbench.drafts.sources.selectionUnconfirmed('n',readTurnContext()!.epoch)).toBe(false);
 expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(1);expect(requests.filter(r=>r.url.endsWith('/notebooklm-link'))).toHaveLength(1);
});
