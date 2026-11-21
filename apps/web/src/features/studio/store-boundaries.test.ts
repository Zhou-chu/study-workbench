import { expect, it, vi } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import type { OperationToken } from '@study/domain';
import type { StudioJob } from '../../data/studio-api';
import { sourceContext } from '../../test/source-fixtures';
import { createStudioStore, type StudioPayload } from './studio-store';

function fixture() { const context=sourceContext(); return {store:createStudioStore(()=>{}),context,generation:sessionCoordinator.current()}; }
function job(id:string,state='queued'):StudioJob {return {jobId:'job:'+id,notebookId:'n',operation:'portable_export',idempotencyKey:id,state,submissionState:'confirmed',remoteMayContinue:false};}
const download:StudioPayload={kind:'download',remoteNotebookId:'remote-n',remoteArtifactId:'artifact-a',providerRevision:1,targetAdmission:{ownerId:'owner-a',revision:1}};

it('only reuses the identical local import File and revision-bound promotion intent',()=>{
 const {store,context,generation}=fixture(),file=new File(['a'],'input.zip');
 const first=store.capture('n',{kind:'import',file},context,generation);
 expect(store.capture('n',{kind:'import',file},context,generation)).toBe(first);
 expect(store.capture('n',{kind:'import',file:new File(['a'],'input.zip')},context,generation)).not.toBe(first);
 const origin={kind:'note' as const,id:'note:a',revision:1};
 const promotion=store.capture('n',{kind:'promote',origin},context,generation);
 expect(store.capture('n',{kind:'promote',origin:{...origin}},context,generation)).toBe(promotion);
 expect(store.capture('n',{kind:'promote',origin:{...origin,revision:2}},context,generation)).not.toBe(promotion);
 expect(store.capture('other',{kind:'promote',origin},context,generation)).not.toBe(promotion);
});
it('download identity includes remote notebook and artifact, not merely operation kind',()=>{
 const {store,context,generation}=fixture(); const first=store.capture('n',download,context,generation);
 expect(store.capture('n',{...download},context,generation)).toBe(first);
 expect(store.capture('n',{...download,remoteArtifactId:'artifact-b'},context,generation)).not.toBe(first);
 expect(store.capture('n',{...download,remoteNotebookId:'remote-other'},context,generation)).not.toBe(first);
});
it('discard removes only untouched intentions, never uncertain submitted work',()=>{
 const {store,context,generation}=fixture(); const id=store.capture('n',{kind:'import',file:new File(['a'],'a.zip')},context,generation);
 expect(store.dirty()).toBe(true);expect(store.dirty('other')).toBe(false);expect(store.hasUnsaved()).toBe(true);
 expect(store.discardUnsent('missing')).toBe(false);expect(store.discardUnsent(id)).toBe(true);expect(store.getOperation(id)).toBeUndefined();expect(store.hasUnsaved()).toBe(false);
 const sent=store.capture('n',{kind:'export'},context,generation),row=store.begin(sent,context,generation)!;
 expect(store.blocked()).toBe(true);expect(store.blocked('other')).toBe(false);expect(store.dirty()).toBe(false);
 expect(store.discardUnsent(sent)).toBe(false);
 store.settle(sent,row.operation.token!,{kind:'unknown'},context,generation);
 expect(store.blocked('n')).toBe(true);expect(store.discardUnsent(sent)).toBe(false);expect(store.begin(sent,context,generation)).toBeNull();
});
it.each(['rejected','not-sent','succeeded'] as const)('records explicit %s without replay or an invented receipt',kind=>{
 const {store,context,generation}=fixture();const id=store.capture('n',{kind:'export'},context,generation),row=store.begin(id,context,generation)!;
 store.settle(id,row.operation.token!,{kind},context,generation);
 expect(store.getOperation(id)?.operation.state).toBe(kind==='rejected'?'failed':kind==='not-sent'?'idle':'succeeded');
 expect(store.getOperation(id)?.job).toBeUndefined();expect(store.blocked()).toBe(false);
});
it('mismatched owner context never admits dispatch',()=>{
 const {store,context,generation}=fixture();const id=store.capture('n',{kind:'export'},context,generation);
 expect(store.begin(id,{...context,epoch:context.epoch+1},generation)).toBeNull();
 expect(store.getOperation(id)?.operation.state).toBe('idle');expect(store.getOperation(id)?.operation.token).toBeNull();
});
it('retirement isolates epochs and keeps submitted uncertainty without retaining busy flags',()=>{
 const {store,context,generation}=fixture(),other={...context,epoch:context.epoch+1};
 const idle=store.capture('n',{kind:'import',file:new File(['a'],'a.zip')},context,generation);
 const sent=store.capture('n',{kind:'export'},context,generation);const row=store.begin(sent,context,generation)!;
 store.settle(sent,row.operation.token!,{kind:'job',job:job(sent)},context,generation);store.beginObserve(sent,context,generation);
 const unaffected=store.capture('other',{kind:'export'},other,generation);
 store.retire(context.epoch);
 expect(store.getOperation(idle)?.retired).toBe(true);expect(store.getOperation(idle)?.operation.state).toBe('idle');
 expect(store.getOperation(sent)?.operation.state).toBe('unknown');expect(store.getOperation(sent)?.busy).toBe(false);
 expect(store.getOperation(unaffected)?.retired).toBe(false);expect(store.beginObserve(sent,context,generation)).toBeNull();
 expect(store.capture('n',{kind:'export'},context,generation)).toBe(sent);
});
it.each(['running','waiting_remote','unexpected-state'])('exact %s job receipt has the correct observation state',state=>{
 const {store,context,generation}=fixture();const id=store.capture('n',{kind:'export'},context,generation),row=store.begin(id,context,generation)!;
 store.settle(id,row.operation.token!,{kind:'job',job:job(id,state)},context,generation);
 expect(store.getOperation(id)?.operation.state).toBe(state==='unexpected-state'?'unknown':'running');
 if(state==='unexpected-state')expect(store.beginObserve(id,context,generation)).toBeNull();
});
it('stale settle and observation tokens cannot mutate owned state',()=>{
 const {store,context,generation}=fixture();const id=store.capture('n',{kind:'export'},context,generation),row=store.begin(id,context,generation)!;
 const token={...row.operation.token!} as OperationToken;
 store.settle('missing',token,{kind:'succeeded'},context,generation);store.observed('missing',token,job(id),context,generation);
 store.settle(id,token,{kind:'succeeded'},context,generation);store.observed(id,token,job(id),context,generation);
 expect(store.getOperation(id)).toBe(row);
 store.settle(id,row.operation.token!,{kind:'job',job:job(id)},context,generation);
 const accepted=store.getOperation(id);store.settle(id,row.operation.token!,{kind:'rejected'},context,generation);expect(store.getOperation(id)).toBe(accepted);
 expect(store.beginObserve(id,context,generation)).not.toBeNull();expect(store.beginObserve(id,context,generation)).toBeNull();
 store.observed(id,row.operation.token!,job(id,'succeeded'),context,generation);
 expect(store.getOperation(id)?.operation.state).toBe('succeeded');
 store.observed(id,row.operation.token!,job(id,'queued'),context,generation);
 expect(store.getOperation(id)?.operation.state).toBe('succeeded');
});
it('selection rejects foreign notebook editors and discard removes active selection',()=>{
 const changed=vi.fn(),store=createStudioStore(changed),context=sourceContext(),g=sessionCoordinator.current();
 const id=store.open('n',{title:'Draft',content:'body',citations:[]},context,g);store.select('other',id);
 expect(store.getSnapshot().active.size).toBe(0);store.select('n',id);expect(store.getSnapshot().active.get('n')).toBe(id);
 expect(store.discardNote(id,store.get(id)!,context,g)).toBe(true);expect(store.getSnapshot().active.size).toBe(0);expect(store.get(id)).toBeUndefined();
});

const source={id:'source:a',title:'Synthetic',topics:[],asset:null,embedded:false,embedded_chunks:0,created:'2000-01-01',updated:'2000-01-01',file_available:false,command_id:null,status:null,submissionUnknown:false,notebooks:['n']};
const session={id:'chat:a',title:'Synthetic',created:'2000-01-01',updated:'2000-01-01',source_id:'source:a'};
it.each(['wrong-source','not-in-notebook','empty','missing-session','not-ready'] as const)('rejects source capture with %s without making a draft',reason=>{
 const {store,context,generation}=fixture();
 const result=store.captureSourceMessage('n',reason==='not-in-notebook'?{...source,notebooks:null}:source,reason==='wrong-source'?{...session,source_id:'source:other'}:reason==='missing-session'?{...session,id:''}:session,reason==='empty'?'   ':'Answer',reason==='not-ready'?{...context,ready:false}:context,generation,'origin');
 expect(result).toBeNull();expect(store.getSnapshot().notes).toHaveLength(0);
});
it('recapturing the same source message preserves the existing draft and omitted classic title',()=>{
 const {store,context,generation}=fixture();const id=store.captureSourceMessage('n',source,session,'Answer',context,generation,'origin')!;
 store.edit(id,{content:'User edited'});const snapshot=store.get(id);
 expect(store.captureSourceMessage('n',source,session,'Answer',context,generation,'origin')).toBe(id);
 expect(store.get(id)).toBe(snapshot);expect(store.get(id)?.omitClassicTitle).toBe(true);expect(store.get(id)?.editor.content).toBe('User edited');
});
import liveRecovery from '../../../../../packages/domain/src/fixtures/live-turn-recovery';
import type { TurnView } from '@study/contracts';
it.each([{projection_status:'partial'},{notebook_id:'other'},{status:'failed'},{turn_id:''},{answer:' '},{citations:null}])('rejects malformed or uncertain turn capture %j',patch=>{
 const {store,context,generation}=fixture(),turn={...structuredClone(liveRecovery.history[0]!),...patch} as unknown as TurnView;
 expect(store.captureTurn(String(liveRecovery.history[0]!.notebook_id),turn,context,generation,'turn')).toBeNull();expect(store.getSnapshot().notes).toHaveLength(0);
});
it('non-text question metadata does not prevent capture of a valid answer',()=>{
 const {store,context,generation}=fixture(),turn={...structuredClone(liveRecovery.history[0]!),message:null} as unknown as TurnView;
 const id=store.captureTurn(String(turn.notebook_id),turn,context,generation,'turn')!;
 expect(store.get(id)?.editor.title).toBe('');expect(store.get(id)?.editor.content).toBe(turn.answer);
});
