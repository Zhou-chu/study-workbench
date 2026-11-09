import * as settingsApi from '../../data/settings-api';
import type { ConversationRetrieval } from '../chat/ConversationPanel';
import type { ComponentProps } from 'react';
const captures = vi.hoisted(() => ({ values: [] as ConversationRetrieval[] }));
vi.mock('../chat/ConversationPanel', async original => {
 const actual = await original<typeof import('../chat/ConversationPanel')>();
 return {...actual, ConversationPanel: (props: ComponentProps<typeof actual.ConversationPanel>) => {
  if(props.retrieval) captures.values.push(props.retrieval);
  return <actual.ConversationPanel {...props}/>;
 }};
});
import {sourceWorkspace} from '../../test/source-fixtures';
import {createHash} from 'node:crypto';
import {readerDetail} from '../../test/reader-fixtures';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { libraryServer, renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
import { notebook } from '../../test/library-fixtures';
import { status, preview, receipt } from '../../test/retrieval-fixtures';
import { readTurnContext } from '@study/web-transport';

function server(custom?: (r: Request) => Response | undefined | Promise<Response | undefined>, workspace: () => Response = () => json(sourceWorkspace())) {
 return libraryServer(async r => {
  const v = await custom?.(r); if (v) return v;
  const p = new URL(r.url).pathname;
  if (p === '/api/credentials/status') return json({configured:{},source:{},encryption_configured:false});
  if (p === '/api/credentials/env-status') return json({});
  if (p === '/api/notebooks/n') return json(notebook);
  if (p.endsWith('/semantic-index/preview')) return json(preview);
  if (p.endsWith('/semantic-index')) return json(r.method === 'GET' ? status : receipt);
  return undefined;
 },workspace);
}
async function open() {
 const h = await renderLibrary('/notebooks/n');
 fireEvent.click(await screen.findByRole('button',{name:'Notebook settings'}));
 await screen.findByRole('group',{name:'Semantic indexing'});
 return {...h, q:()=>within(screen.getByRole('dialog'))};
}
async function load(h: Awaited<ReturnType<typeof open>>) {
 fireEvent.click(h.q().getByRole('button',{name:'Refresh index status'}));
 await waitFor(()=>expect(h.q().getByLabelText('Embedding profile')).toBeEnabled());
 fireEvent.change(h.q().getByLabelText('Embedding profile'),{target:{value:'p'}});
}
async function plan(h: Awaited<ReturnType<typeof open>>) {
 await load(h);
 fireEvent.click(h.q().getByRole('button',{name:'Preview indexing'}));
 await h.q().findByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.');
}
it('T01-T04 keeps explicit hybrid through overlay close and requires its own query consent',async()=>{
 const requests=server();const h=await open();await load(h);
 fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 expect(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.')).not.toBeChecked();
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Close'}));
 fireEvent.click(screen.getByRole('button',{name:'Notebook settings'}));
 expect(h.q().getByLabelText('Hybrid (explicit submit only)')).toBeChecked();
 expect(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.')).toBeChecked();
 expect(requests.filter(r=>r.method==='POST')).toHaveLength(0);
 fireEvent.click(h.q().getByLabelText('Lexical only'));
 expect(h.q().getByLabelText('Lexical only')).toBeChecked();
});
it('T05-T09 previews exact metadata, separates consent, cancels locally and latches build',async()=>{
 let done!:(r:Response)=>void;
 const requests=server(r=>r.method==='POST'&&r.url.endsWith('/semantic-index')?new Promise(yes=>done=yes):undefined);
 const h=await open();await plan(h);
 expect(await requests.find(r=>r.url.endsWith('/preview'))!.clone().json()).toEqual({source_version_ids:['v-old'],profile_id:'p'});
 expect(h.q().getByRole('button',{name:'Confirm indexing'})).toBeDisabled();
 fireEvent.click(h.q().getByRole('button',{name:'Cancel preview'}));
 expect(h.q().queryByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.')).toBeNull();
 fireEvent.click(h.q().getByRole('button',{name:'Preview indexing'}));
 fireEvent.click(await h.q().findByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));
 await waitFor(()=>expect(done).toBeDefined());
 expect(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/semantic-index'))).toHaveLength(1);
 await act(async()=>done(json(receipt)));
 expect(h.q().getByText('child')).toBeVisible();
});
it('T10-T11 unknown POST retains same-key recovery and never adopts listed job IDs',async()=>{
 let calls=0;
 const requests=server(r=>r.method==='POST'&&r.url.endsWith('/semantic-index')?json(++calls===1?{invalid:true}:receipt):undefined);
 const h=await open();await plan(h);
 fireEvent.click(h.q().getByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));
 await waitFor(()=>expect(h.q().getByRole('button',{name:'Recover original submission (sends POST)'})).toBeEnabled());
 fireEvent.click(h.q().getByRole('button',{name:'Recover original submission (sends POST)'}));
 await h.q().findByText('child');
 const writes=requests.filter(r=>r.method==='POST'&&r.url.endsWith('/semantic-index'));
 expect(writes).toHaveLength(2);
 expect(await writes[0]!.clone().json()).toEqual(await writes[1]!.clone().json());
 expect(requests.some(r=>r.url.includes('/personal/jobs/'))).toBe(false);
});
it('T04/T05 configuration A-B-A retires acknowledgement and preview without resetting hybrid',async()=>{
 server();const h=await open();await plan(h);
 fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 act(()=>{const s=h.workbench.drafts.configuration;const id=s.open('models',readTurnContext()!);s.invalidate(id!);});
 expect(h.q().getByLabelText('Hybrid (explicit submit only)')).toBeChecked();
 expect(h.q().queryByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.')).toBeNull();
 expect(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.')).not.toBeChecked();
});
it.each(['missing-child','wrong-fingerprint','unsafe-flags'])('T09 rejects %s receipts without claiming completion',async flaw=>{
 const bad=flaw==='missing-child'?{...receipt,jobs:[]}:flaw==='wrong-fingerprint'?{...receipt,profile_fingerprint:'c'.repeat(64)}:{...receipt,retry_safe:true};
 server(r=>r.method==='POST'&&r.url.endsWith('/semantic-index')?json(bad):undefined);
 const h=await open();await plan(h);fireEvent.click(h.q().getByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));
 await waitFor(()=>expect(h.q().getByRole('button',{name:'Recover original submission (sends POST)'})).toBeEnabled());
 expect(h.q().queryByText('child')).toBeNull();
});

it('T14-T16 uses the resolved historical extraction and exact acknowledged maintenance job only',async()=>{
 let maintenance: Record<string,unknown>|null=null;
 const raw=readerDetail();
 Object.assign(raw.version,{origin:'upload',original_status:'available'});
 Object.assign(raw.extraction,{verification_origin:'restored_archive'});
 const requests=server(async r=>{
  const path=new URL(r.url).pathname;
  if(path==='/api/personal/source-versions/v-old')return json(raw);
  if(path==='/api/personal/source-versions/v-old/revalidate'){
   const body=await r.clone().json();
   maintenance={job_id:'maintenance',notebook_id:'n',source_version_id:'v-old',operation:'revalidate',extraction_id:'x-old',fresh_extraction_id:'x-fresh',idempotency_key:body.idempotency_key,request_hash:createHash('sha256').update('{"extraction_id": "x-old", "operation": "revalidate"}').digest('hex'),state:'queued',remote_may_continue:false};
   return json(maintenance);
  }
  if(path==='/api/personal/jobs/maintenance')return json({...maintenance,state:'succeeded',result:{source_version_id:'v-old',extraction_id:'x-old',fresh_extraction_id:'x-fresh',checked_count:0,verified_count:0,unverified_count:0}});
  return undefined;
 });
 const h=await open();fireEvent.click(h.q().getByRole('button',{name:'Close'}));
 fireEvent.click(screen.getByRole('button',{name:'Same title'}));
 fireEvent.click(screen.getByRole('button',{name:'Read v-old'}));
 fireEvent.click(await screen.findByRole('button',{name:'Revalidate archived references'}));
 fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 await waitFor(()=>expect(maintenance).not.toBeNull());
 const post=requests.find(r=>r.url.endsWith('/revalidate'))!;
 expect(await post.clone().json()).toMatchObject({extraction_id:'x-old'});
 expect(requests.filter(r=>r.url.includes('/personal/jobs/'))).toHaveLength(0);
 fireEvent.click(await screen.findByRole('button',{name:'Refresh this maintenance job'}));
 expect(await screen.findByText('Checked 0 references; 0 verified, 0 still unverified. Unmatched references were not moved or rewritten.')).toBeVisible();
 expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(0);
 expect(requests.some(r=>r.url.includes('semantic-index'))).toBe(false);
});

function pyHash(value: unknown): string {
 const serialize=(v:unknown):string=>Array.isArray(v)?'['+v.map(serialize).join(', ')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+': '+serialize(x)).join(', ')+'}':JSON.stringify(v);
 return createHash('sha256').update(serialize(value)).digest('hex');
}
function liveJob(body: Record<string,unknown>, id: string, state='failed') {
 const jobs=[{...receipt.jobs[0],state}];
 const r={...receipt,jobs,state};
 const common={notebook_id:'n',request_hash:pyHash({notebook_id:'n',...body}),retry_safe:false,remote_cancel_confirmed:false,state};
 if(id==='group')return {...common,job_id:'group',group_id:'group',operation:'index_evidence_group',replay_allowed:false,version_ids:['v-old'],job_ids:['child'],receipt:r,jobs};
 return {...common,...jobs[0],job_id:'child',group_id:'group',operation:'index_evidence',source_version_id:'v-old',extraction_id:'ex-old',
  scope_snapshot:preview.snapshot,version_snapshot:preview.snapshot,profile:Object.fromEntries(Object.entries(preview.profile).filter(([k])=>!['fingerprint','endpoint_fingerprint'].includes(k))),
  profile_id:'p',profile_fingerprint:preview.profile.fingerprint,disclosed_profile_fingerprint:preview.profile.fingerprint,
  destination_descriptor_version:preview.profile.destination_descriptor_version,preview_hash:preview.preview_hash,
  request_snapshot:body,idempotency_key:body.idempotency_key,submission_state:'not_submitted',
  retry_of_job_id:body.retry_of_job_id,acknowledge_duplicate_embedding_cost:body.acknowledge_duplicate_embedding_cost};
}
it('T10/T12/T13 observes only the live original group and children, then performs a separately consented fresh full-version retry',async()=>{
 let body:Record<string,unknown>={};let stage='failed';
 const requests=server(async r=>{
  const p=new URL(r.url).pathname;
  if(r.method==='POST'&&p.endsWith('/semantic-index')){body=await r.clone().json();return json(receipt);}
  if(p.includes('/personal/jobs/')){if(p.endsWith('/cancel'))stage='cancelled_local';return json(liveJob(body,p.includes('/group')?'group':'child',stage));}
  if(r.method==='GET'&&p.endsWith('/semantic-index'))return json({...status,jobs:[{...receipt.jobs[0],job_id:'unowned'}]});
  return undefined;
 });
 const h=await open();await plan(h);
 fireEvent.click(h.q().getByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));await h.q().findByText('child');
 fireEvent.click(h.q().getByRole('button',{name:'Refresh index status'}));
 await waitFor(()=>expect(h.q().getByRole('button',{name:'Preview full-version retry · child'})).toBeEnabled());
 expect(requests.filter(r=>r.url.includes('/personal/jobs/')).map(r=>new URL(r.url).pathname)).toEqual(['/api/personal/jobs/group','/api/personal/jobs/child']);
 expect(h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.attempts[0]!.receipt?.state).toBe('submission_unknown');
 fireEvent.click(h.q().getByRole('button',{name:'Stop local waiting'}));
 await waitFor(()=>expect(requests.some(r=>r.url.endsWith('/group/cancel'))).toBe(true));
 await waitFor(()=>expect(h.q().getByRole('button',{name:'Preview full-version retry · child'})).toBeEnabled());
 fireEvent.click(h.q().getByRole('button',{name:'Preview full-version retry · child'}));
 const cost=await h.q().findByLabelText('I acknowledge a full-version retry may duplicate previous embedding work and cost.');
 expect(cost).not.toBeChecked();
 fireEvent.click(h.q().getByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 expect(h.q().getByRole('button',{name:'Confirm indexing'})).toBeDisabled();
 fireEvent.click(cost);fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));
 await waitFor(()=>expect(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/semantic-index'))).toHaveLength(2));
 const posts=await Promise.all(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/semantic-index')).map(r=>r.clone().json()));
 expect(posts[1]).toMatchObject({source_version_ids:['v-old'],retry_of_job_id:'child',acknowledge_duplicate_embedding_cost:true,acknowledge_external_processing:true});
 expect(posts[1].idempotency_key).not.toBe(posts[0].idempotency_key);
});
it('T05 refuses a preview whose extraction changed since the disclosed status',async()=>{
 server(r=>r.url.endsWith('/preview')?json({...preview,snapshot:{...preview.snapshot,entries:[{...preview.snapshot.entries[0],extraction_id:'changed'}]}}):undefined);
 const h=await open();await load(h);
 fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Preview indexing'}));
 await waitFor(()=>expect(h.q().getByRole('alert')).toBeVisible());
 expect(h.q().queryByRole('button',{name:'Confirm indexing'})).toBeNull();
 expect(h.q().getByLabelText('Hybrid (explicit submit only)')).toBeChecked();
 expect(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.')).not.toBeChecked();
});
it.each(['remote_text_snapshot','future'])('T14 does not expose repair for unsupported origin %s',async origin=>{
 const raw=readerDetail();Object.assign(raw.version,{origin,original_status:'available',mime_type:'text/markdown'});
 server(r=>new URL(r.url).pathname==='/api/personal/source-versions/v-old'?json(raw):undefined);
 const h=await open();fireEvent.click(h.q().getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Same title'}));fireEvent.click(screen.getByRole('button',{name:'Read v-old'}));
 expect(await screen.findByRole('button',{name:'Re-extract original'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Revalidate archived references'})).toBeDisabled();
});
it('T14 retained Markdown repair posts once, leaves unknown frozen, and never exposes the retained path',async()=>{
 const raw=readerDetail();Object.assign(raw.version,{origin:'web_snapshot',mime_type:'text/markdown'});
 const requests=server(r=>new URL(r.url).pathname==='/api/personal/source-versions/v-old'?json(raw):r.url.endsWith('/reparse')?json({malformed:true}):undefined);
 const h=await open();fireEvent.click(h.q().getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Same title'}));fireEvent.click(screen.getByRole('button',{name:'Read v-old'}));
 fireEvent.click(await screen.findByRole('button',{name:'Re-extract original'}));
 fireEvent.click(screen.getByRole('button',{name:'Confirm'}));fireEvent.click(screen.queryByRole('button',{name:'Confirm'})??screen.getByRole('button',{name:'Re-extract original'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Re-extract original'})).toBeDisabled());
 expect(requests.filter(r=>r.url.endsWith('/reparse'))).toHaveLength(1);
 expect(Object.keys(await requests.find(r=>r.url.endsWith('/reparse'))!.clone().json())).toEqual(['idempotency_key']);
 expect(document.body.textContent).not.toContain('/private');
 expect(screen.queryByRole('button',{name:'Refresh this maintenance job'})).toBeNull();
});

it('T01-T04 preserves ORIGINAL B5 closures across mode/configuration A-B-A and actual unmount',async()=>{
 server();const h=await open();await load(h);
 fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 const original=captures.values.at(-1)!;
 expect(original.options).toMatchObject({retrieval_mode:'hybrid',embedding_profile_id:'p',acknowledge_query_processing:true});
 expect(Object.isFrozen(original.options)).toBe(true);expect(original.isCurrent()).toBe(true);
 fireEvent.click(h.q().getByRole('button',{name:'Close'}));
 expect(original.isCurrent()).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Notebook settings'}));
 fireEvent.click(h.q().getByLabelText('Lexical only'));fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 expect(original.isCurrent()).toBe(false);
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 const afterMode=captures.values.at(-1)!;expect(afterMode.isCurrent()).toBe(true);
 act(()=>{const s=h.workbench.drafts.configuration;const id=s.open('models',readTurnContext()!);s.invalidate(id!);});
 expect(afterMode.isCurrent()).toBe(false);
 fireEvent.click(h.q().getByRole('button',{name:'Refresh index status'}));
 await waitFor(()=>expect(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.')).toBeEnabled());
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 const last=captures.values.at(-1)!;expect(last.isCurrent()).toBe(true);
 h.unmount();expect(last.isCurrent()).toBe(false);expect(original.isCurrent()).toBe(false);
});
it('T05 delayed stale preview cannot unlock a newer explicit refresh',async()=>{
 let resolvePreview!:(r:Response)=>void;let resolveStatus!:(r:Response)=>void;let reads=0;
 server(r=>r.url.endsWith('/preview')?new Promise(yes=>resolvePreview=yes):r.method==='GET'&&new URL(r.url).pathname.endsWith('/semantic-index')&&++reads>1?new Promise(yes=>resolveStatus=yes):undefined);
 const h=await open();await load(h);
 fireEvent.click(h.q().getByRole('button',{name:'Preview indexing'}));
 await waitFor(()=>expect(resolvePreview).toBeDefined());
 act(()=>{const s=h.workbench.drafts.configuration;s.open('models',readTurnContext()!);});
 fireEvent.click(h.q().getByRole('button',{name:'Refresh index status'}));
 await waitFor(()=>expect(resolveStatus).toBeDefined());
 await act(async()=>resolvePreview(json(preview)));
 expect(h.q().getByRole('button',{name:'Refresh index status'})).toBeDisabled();
 await act(async()=>resolveStatus(json(status)));
 expect(h.q().getByRole('button',{name:'Refresh index status'})).toBeEnabled();
 expect(h.q().queryByRole('button',{name:'Confirm indexing'})).toBeNull();
});
it('B9d memory choices join the existing navigation guard rather than silently leaving the workspace',async()=>{
 server();const h=await open();
 fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 fireEvent.click(h.q().getByRole('button',{name:'Close'}));
 await act(async()=>{void h.router.navigate('/settings/models');});
 expect(h.workbench.drafts.hasUnsaved()).toBe(true);
 expect(h.router.state.location.pathname).toBe('/notebooks/n');
});

it.each([false,true])('T10 explicit refresh reads at most one group plus twenty original children and stops on malformed child (%s)',async malformed=>{
 const ids=Array.from({length:20},(_,i)=>'v'+i);
 const entries=ids.map((version_id,i)=>({...preview.snapshot.entries[0]!,version_id,extraction_id:'ex'+i}));
 const snap={notebook_id:'n',entries};
 const pre={...preview,snapshot:snap,evidence_count:20};
 const children=ids.map((source_version_id,i)=>({...receipt.jobs[0]!,job_id:'child'+i,source_version_id,total_evidence:1,state:'failed'}));
 const rec={...receipt,jobs:children,job_ids:children.map(j=>j.job_id),state:'failed'};
 const stat={...status,snapshot:snap};
 let body:Record<string,unknown>={};
 const workspace=sourceWorkspace();workspace.selection={...workspace.selection,engine:'independent',selection_origin:'local',source_version_ids:ids,remote_source_ids:[]};
 workspace.sources=[{source_id:'source20',title:'Twenty sources',versions:ids.map(source_version_id=>({source_version_id,notebook_id:'n',origin:'upload',status:'ready',extraction_status:'ready',original_status:'available'}))}];
 const requests=server(async r=>{
  const path=new URL(r.url).pathname;
  if(path.endsWith('/preview'))return json(pre);
  if(path.endsWith('/semantic-index')){if(r.method==='GET')return json(stat);body=await r.clone().json();return json(rec);}
  if(path==='/api/personal/jobs/group')return json({job_id:'group',group_id:'group',notebook_id:'n',operation:'index_evidence_group',replay_allowed:false,request_hash:pyHash({notebook_id:'n',...body}),version_ids:ids,job_ids:rec.job_ids,receipt:rec,jobs:children,state:'failed',retry_safe:false,remote_cancel_confirmed:false});
  if(path.includes('/personal/jobs/child')){
   const i=Number(path.match(/child(\\d+)$/)?.[1] ?? path.split('child')[1]);
   if(malformed)return json({invalid:true});
   return json({...liveJob(body,'child'),...children[i],extraction_id:'ex'+i,scope_snapshot:snap,version_snapshot:{notebook_id:'n',entries:[entries[i]]}});
  }
  return undefined;
 },()=>json(workspace));
 const h=await open();await load(h);fireEvent.click(h.q().getByRole('button',{name:'Preview indexing'}));
 fireEvent.click(await h.q().findByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));await h.q().findByText('child19');
 fireEvent.click(h.q().getByRole('button',{name:'Refresh index status'}));
 await waitFor(()=>expect(h.q().getByRole('button',{name:'Refresh index status'})).toBeEnabled());
 const reads=requests.filter(r=>r.url.includes('/personal/jobs/'));
 expect(reads).toHaveLength(malformed?2:21);
 expect(new Set(reads.map(r=>r.url)).size).toBe(reads.length);
 fireEvent.click(h.q().getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Notebook settings'}));
 fireEvent(window,new Event('focus'));fireEvent(window,new Event('online'));
 expect(requests.filter(r=>r.url.includes('/personal/jobs/'))).toHaveLength(reads.length);
});
it('T11 same-key recovery is refused after configuration invalidation and never repaired by loading current status',async()=>{
 const requests=server(r=>r.method==='POST'&&r.url.endsWith('/semantic-index')?json({bad:true}):undefined);
 const h=await open();await plan(h);fireEvent.click(h.q().getByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));await waitFor(()=>expect(h.q().getByRole('button',{name:'Recover original submission (sends POST)'})).toBeEnabled());
 act(()=>h.workbench.drafts.configuration.open('models',readTurnContext()!));
 fireEvent.click(h.q().getByRole('button',{name:'Refresh index status'}));
 await waitFor(()=>expect(h.q().getByRole('button',{name:'Refresh index status'})).toBeEnabled());
 expect(h.q().getByRole('button',{name:'Recover original submission (sends POST)'})).toBeDisabled();
 expect(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/semantic-index'))).toHaveLength(1);
 expect(h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.attempts[0]!.phase).toBe('unknown');
});

it('T05/T11 a PREVIEW_CHANGED conflict retires preview consent but preserves the original unknown obligation',async()=>{
 const requests=server(r=>r.method==='POST'&&r.url.endsWith('/semantic-index')?json({detail:'PREVIEW_CHANGED'},409):undefined);
 const h=await open();await plan(h);
 fireEvent.click(h.q().getByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Confirm indexing'}));
 await waitFor(()=>expect(h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.attempts[0]!.phase).toBe('unknown'));
 expect(h.q().queryByRole('button',{name:'Confirm indexing'})).toBeNull();
 expect(h.q().getByRole('button',{name:'Recover original submission (sends POST)'})).toBeDisabled();
 expect(h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.attempts[0]!.httpStatus).toBe(409);
 expect(requests.filter(r=>r.method==='POST'&&r.url.endsWith('/semantic-index'))).toHaveLength(1);
});

it('T16 closes the reader during an owned refresh without canceling CPU work or applying its late result',async()=>{
 let settled=false;
 const create=settingsApi.createSettingsApi;
 vi.spyOn(settingsApi,'createSettingsApi').mockImplementation((...args)=>{
  const api=create(...args);
  return {...api,maintenanceJob:async(...args)=>{try{return await api.maintenanceJob(...args);}finally{settled=true;}}};
 });
 let pending!:(r:Response)=>void;let job:Record<string,unknown>={};
 const raw=readerDetail();Object.assign(raw.version,{origin:'upload',original_status:'available'});
 const requests=server(async r=>{
  const path=new URL(r.url).pathname;
  if(path==='/api/personal/source-versions/v-old')return json(raw);
  if(path.endsWith('/reparse')){const body=await r.clone().json();job={job_id:'maint',notebook_id:'n',source_version_id:'v-old',operation:'reparse',extraction_id:null,fresh_extraction_id:'fresh',idempotency_key:body.idempotency_key,request_hash:pyHash({operation:'reparse',extraction_id:null}),state:'queued',remote_may_continue:false};return json(job);}
  if(path==='/api/personal/jobs/maint')return new Promise(yes=>pending=yes);
  return undefined;
 });
 const h=await open();fireEvent.click(h.q().getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Same title'}));fireEvent.click(screen.getByRole('button',{name:'Read v-old'}));
 fireEvent.click(await screen.findByRole('button',{name:'Re-extract original'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 fireEvent.click(await screen.findByRole('button',{name:'Refresh this maintenance job'}));await waitFor(()=>expect(pending).toBeDefined());
 fireEvent.keyDown(document.querySelector('.reader-pane')!,{key:'Escape'});
 await waitFor(()=>expect(document.querySelector('.workspace-reader')).toHaveAttribute('hidden'));
 expect(screen.queryByRole('button',{name:'Refresh this maintenance job',hidden:true})).toBeNull();
 await act(async()=>pending(json({...job,state:'succeeded',result:{source_version_id:'v-old',extraction_id:'fresh',evidence_count:2,status:'ready'}})));
 await waitFor(()=>expect(settled).toBe(true));
 expect(h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.maintenance[0]!.job?.state).toBe('queued');
 expect(requests.some(r=>r.url.endsWith('/cancel'))).toBe(false);
 expect(requests.filter(r=>r.url.endsWith('/reparse'))).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Notebook settings'}));
 expect(h.q().getByText('maint')).toBeVisible();
 expect(h.q().getByText(h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.maintenance[0]!.id)).toBeVisible();
});

it('T06 cancellation restores preview focus without substituting document consent for query consent',async()=>{
 server();const h=await open();await load(h);
 fireEvent.click(h.q().getByLabelText('Hybrid (explicit submit only)'));
 fireEvent.click(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.'));
 fireEvent.click(h.q().getByRole('button',{name:'Preview indexing'}));
 await h.q().findByLabelText('I acknowledge processing these document excerpts at the disclosed destination; quota may be consumed.');
 fireEvent.click(h.q().getByRole('button',{name:'Cancel preview'}));
 expect(h.q().getByRole('button',{name:'Preview indexing'})).toHaveFocus();
 expect(h.q().getByLabelText('I acknowledge sending this query for embedding at the disclosed destination; quota may be consumed.')).toBeChecked();
});


it('T16 rejects a maintenance refresh that changes its originally acknowledged fresh extraction',async()=>{
 const raw=readerDetail();Object.assign(raw.version,{origin:'upload',original_status:'available'});
 let job:Record<string,unknown>={};
 server(async r=>{
  const path=new URL(r.url).pathname;
  if(path==='/api/personal/source-versions/v-old')return json(raw);
  if(path.endsWith('/reparse')){const body=await r.clone().json();job={job_id:'stable-maint',notebook_id:'n',source_version_id:'v-old',operation:'reparse',extraction_id:null,fresh_extraction_id:'fresh-original',idempotency_key:body.idempotency_key,request_hash:pyHash({operation:'reparse',extraction_id:null}),state:'queued',remote_may_continue:false};return json(job);}
  if(path==='/api/personal/jobs/stable-maint')return json({...job,fresh_extraction_id:'different-extraction'});
  return undefined;
 });
 const h=await open();fireEvent.click(h.q().getByRole('button',{name:'Close'}));fireEvent.click(screen.getByRole('button',{name:'Same title'}));fireEvent.click(screen.getByRole('button',{name:'Read v-old'}));
 fireEvent.click(await screen.findByRole('button',{name:'Re-extract original'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 fireEvent.click(await screen.findByRole('button',{name:'Refresh this maintenance job'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh this maintenance job'})).toBeEnabled());
 const attempt=h.workbench.drafts.settings.getSnapshot()[0]!.retrieval.maintenance[0]!;
 expect(attempt.observationFailed).toBe(true);
 expect(attempt.job?.fresh_extraction_id).toBe('fresh-original');
});
