import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createAdvancedStore} from './advanced-store';
import {observeAdvanced} from './advanced-observer';
import {createDraftRegistry,createNavigationController} from '../../app/drafts';
import {createSettingsApi,RebuildSubmissionUnknown,SettingsRequestError} from '../../data/settings-api';
import {commandId,parseRebuildReceipt,parseRebuildStatus,parseApiVersion} from '../../data/advanced-contracts';
import {sourceContext} from '../../test/source-fixtures';
import {json} from '../../test/notebook-fixtures';
import {readTurnContext,sessionCoordinator,RequestNotDispatchedError} from '@study/web-transport';
import {advancedMessages} from '../../i18n/advanced-messages';
import {languages} from '../../i18n';
beforeEach(sourceContext);afterEach(()=>vi.useRealTimers());
const receipt={command_id:'command:owned',total_items:0,message:'/private not retained'};
const status={command_id:'command:owned',status:'running',progress:null,stats:null,started_at:null,completed_at:null,error_message:null};
const setup=()=>{const s=createAdvancedStore(()=>{}),c=readTurnContext()!,g=sessionCoordinator.current(),id=s.open(c)!,token=s.capture(id,c,g,4)!;return {s,c,g,id,token}};
it('keeps immutable original fields, duplicate latch, edits and acknowledgement independent',()=>{
 const {s,c,g,id,token}=setup();expect(s.begin(token,c,g,4)).toBe(true);expect(s.begin(token,c,g,4)).toBe(false);
 s.edit(id,{mode:'all'});s.settle(token,{kind:'receipt',receipt:parseRebuildReceipt(receipt)},c,g);
 expect(token.request.mode).toBe('existing');expect(s.get(id)?.fields.mode).toBe('all');expect(s.get(id)?.status).toBe('accepted');
 expect(s.reset(id,c)).toBe(false);expect(s.canObserve(token,c,g)).toBe(true);
 s.observe(token,parseRebuildStatus({...status,status:'completed',progress:{processed:0,total:0,percentage:0}},receipt.command_id),c,g);
 expect(s.reset(id,c)).toBe(true);expect(s.get(id)?.history).toHaveLength(1);expect(s.get(id)?.history[0]?.receipt?.total_items).toBe(0);
});
it('typed acknowledgement and terminal status never erase the separate unknown guard',()=>{
 const {s,c,g,id,token}=setup();s.begin(token,c,g,4);s.settle(token,{kind:'unknown',commandId:receipt.command_id,status:409},c,g);
 s.observe(token,parseRebuildStatus({...status,status:'completed'},receipt.command_id),c,g);
 expect(s.get(id)?.attempt?.unknown).toBe(true);expect(s.reset(id,c)).toBe(false);expect(s.capture(id,c,g,4)).toBeNull();
});
it('original generation/control/provider changes reject confirmation and observer cannot retarget',()=>{
 const {s,c,g,id,token}=setup();expect(s.begin(token,c,g+1,4)).toBe(false);expect(s.begin(token,c,g,5)).toBe(false);
 s.edit(id,{include_sources:false});expect(s.begin(token,c,g,4)).toBe(false);
 const next=s.capture(id,c,g,5)!;s.begin(next,c,g,5);s.settle(next,{kind:'receipt',receipt:parseRebuildReceipt(receipt)},c,g);
 expect(s.observe(token,parseRebuildStatus({...status,status:'completed'},receipt.command_id),c,g)).toBe(false);expect(s.canObserve(next,c,g+1)).toBe(false);
});
it('retired selected records reopen frozen, explicit fresh is blank and old uncertainty stays visible',()=>{
 const {s,c,g,id,token}=setup();s.edit(id,{mode:'all'});const original=s.capture(id,c,g,4)!;s.begin(original,c,g,4);s.retire(c.epoch);
 expect(s.open({...c,epoch:c.epoch+1})).toBe(id);const next=s.fresh(id,{...c,epoch:c.epoch+1})!;expect(next).not.toBe(id);
 expect(s.get(next)?.fields.mode).toBe('existing');expect(s.get(id)?.attempt?.unknown).toBe(true);expect(s.getSnapshot()).toHaveLength(2);expect(s.select(id)).toBe(true);expect(s.open(c)).toBe(id);
 expect(s.begin(token,c,g,4)).toBe(false);
});
it('Advanced participates in the existing resource guard without changing notebook SettingsDraft',()=>{
 const r=createDraftRegistry(),nav=createNavigationController(r),c=readTurnContext()!,id=r.advanced.open(c)!;
 r.advanced.edit(id,{mode:'all'});nav.activateResource(id);expect(nav.requestNavigation({destination:'/settings'})).toBe('confirm');
 const token=r.advanced.capture(id,c,sessionCoordinator.current(),2)!;r.advanced.begin(token,c,sessionCoordinator.current(),2);
 expect(nav.requestNavigation({destination:'/settings'})).toBe('retain');r.retireContext(c.epoch);
 expect(r.advanced.get(id)?.retired).toBe(true);expect(r.settings.getSnapshot()).toEqual([]);
});
it('uses exactly the three allowed Advanced paths and never transports an invented payload field',async()=>{
 const c=readTurnContext()!,requests:{path:string;method:string;body?:BodyInit|null}[]=[];
 const api=createSettingsApi({send:async r=>{requests.push(r);return json(r.method==='POST'?receipt:r.path==='/config'?{version:'x',latestVersion:null,hasUpdate:false}:status)}});
 await api.rebuild({mode:'existing',include_sources:false,include_notes:true,include_insights:false},c,'local-only');
 await api.rebuildStatus(receipt.command_id,c);await api.version(c);
 expect(requests.map(r=>[r.method,r.path])).toEqual([['POST','/embeddings/rebuild'],['GET','/embeddings/rebuild/command%3Aowned/status'],['GET','/config']]);
 expect(JSON.parse(String(requests[0]?.body))).toEqual({mode:'existing',include_sources:false,include_notes:true,include_insights:false});
});
it.each([undefined,'command:owned','../bad','command:slash/bad'])('safe typed409 preserves only usable original command %s',async command=>{
 const api=createSettingsApi({send:async()=>json({detail:{code:'COMMAND_SUBMISSION_UNKNOWN',retry_safe:false,command_id:command,resource_id:'private',message:'secret'}},409)});
 const input={mode:'existing' as const,include_sources:true,include_notes:false,include_insights:false};
 try{await api.rebuild(input,readTurnContext()!,'local');throw Error('expected')}catch(e){expect(e).toBeInstanceOf(RebuildSubmissionUnknown);expect((e as RebuildSubmissionUnknown).command_id).toBe(command==='command:owned'?command:undefined);expect(JSON.stringify(e)).not.toMatch(/private|secret|resource_id/)}
});
it.each([400,404,409,422,429])('keeps generic HTTP%s distinct from typed uncertainty',async code=>{
 const api=createSettingsApi({send:async()=>json({detail:{code:'OTHER',retry_safe:false,command_id:'command:other'}},code)});
 await expect(api.rebuild({mode:'all',include_sources:true,include_notes:false,include_insights:false},readTurnContext()!,'local')).rejects.toEqual(new SettingsRequestError(code));
});
it('rejects bad identities and malformed required counts, preserves optional null/absence and discards errors',()=>{
 for(const id of ['',' ','a/b','a%2fb','a?b','a#b','a\\b'])expect(()=>commandId(id)).toThrow();
 expect(()=>parseRebuildReceipt({command_id:'command:x',estimated_items:4,message:'x'})).toThrow();
 expect(parseRebuildStatus(status,receipt.command_id)).toMatchObject({progress:null,stats:null});
 expect(parseRebuildStatus({command_id:receipt.command_id,status:'future'},receipt.command_id)).not.toHaveProperty('progress');
 expect(parseRebuildStatus({...status,status:'failed',error_message:'/private secret'},receipt.command_id)).toMatchObject({error_present:true});
 expect(JSON.stringify(parseRebuildReceipt(receipt))).not.toContain('private');
 for(const patch of [{command_id:'other'},{progress:{processed:1,total:2,percentage:Infinity}},{stats:{failed:-1}}])expect(()=>parseRebuildStatus({...status,...patch},receipt.command_id)).toThrow();
 expect(parseApiVersion({version:'x',latestVersion:null,hasUpdate:false})).toEqual({version:'x',latestVersion:null,hasUpdate:false});
 expect(parseApiVersion({version:'unknown'})).not.toHaveProperty('hasUpdate');expect(()=>parseApiVersion({version:'x',hasUpdate:null})).toThrow();
});
it('authentic not-dispatched can release only its original pending attempt',()=>{
 const {s,c,g,id,token}=setup();s.begin(token,c,g,4);s.settle(token,{kind:'not-sent'},c,g);expect(s.capture(id,c,g,4)).not.toBeNull();
 const proof=new RequestNotDispatchedError('superseded');expect(proof.reason).toBe('superseded');
});
it('finite observation makes at most twelve starts five seconds apart and never resumes itself',async()=>{
 vi.useFakeTimers();const starts:number[]=[],values:string[]=[];let ended=0,unavailable=0;
 observeAdvanced({notBefore:Date.now(),current:()=>true,onStart:t=>{starts.push(t);return true},read:async()=>status,value:v=>{values.push(v.status);return true},unavailable:()=>{unavailable++},stopped:()=>{ended++}});
 await vi.advanceTimersByTimeAsync(120000);
 expect(starts).toHaveLength(12);for(let i=1;i<starts.length;i++)expect(starts[i]!-starts[i-1]!).toBeGreaterThanOrEqual(5000);
 expect(unavailable).toBe(1);expect(ended).toBe(1);expect(values).toHaveLength(12);
});
it('observation deadline stops a hanging read and ignores its late result',async()=>{
 vi.useFakeTimers();let resolve!:(v:typeof status)=>void;let applied=0,stopped=0;let signal:AbortSignal|undefined;
 observeAdvanced({notBefore:Date.now(),current:()=>true,onStart:()=>true,read:s=>{signal=s;return new Promise(yes=>resolve=yes)},value:()=>{applied++;return true},unavailable:()=>{},stopped:()=>{stopped++}});
 await vi.advanceTimersByTimeAsync(60000);expect(signal?.aborted).toBe(true);resolve(status);await Promise.resolve();expect(applied).toBe(0);expect(stopped).toBe(1);
});
it('observation stops on owner loss, terminal, unsupported and errors without another request',async()=>{
 for(const cause of ['owner','terminal','unknown','error']){vi.useFakeTimers();let live=true,reads=0,applied=0;const stop=observeAdvanced({notBefore:Date.now(),current:()=>live,onStart:()=>true,read:async()=>{reads++;if(cause==='error')throw Error('synthetic');return status},value:()=>{applied++;return cause==='owner'},unavailable:()=>{},stopped:()=>{}});await vi.advanceTimersByTimeAsync(1);live=false;await vi.advanceTimersByTimeAsync(60000);stop();expect(reads).toBe(1);expect(applied).toBe(cause==='error'?0:1);vi.useRealTimers();}
});
it('has explicit Advanced safety translations in all fourteen locales, not an English fallback',()=>{
 expect(Object.keys(advancedMessages).sort()).toEqual(languages.map(l=>l.code).sort());const keys=Object.keys(advancedMessages['en-US']).sort();
 for(const [code,row]of Object.entries(advancedMessages)){expect(Object.keys(row).sort()).toEqual(keys);expect(Object.values(row).every(v=>v.trim())).toBe(true);if(code!=='en-US')expect(row.disclosure).not.toBe(advancedMessages['en-US'].disclosure)}
});

it('refuses a different acknowledged command even when a caller supplied a separately valid projection',()=>{
 const {s,c,g,id,token}=setup();s.begin(token,c,g,4);s.settle(token,{kind:'receipt',receipt:parseRebuildReceipt(receipt)},c,g);
 s.observe(token,parseRebuildStatus({...status,command_id:'command:other',status:'completed'},'command:other'),c,g);
 expect(s.get(id)?.attempt?.phase).toBe('accepted');expect(s.get(id)?.attempt?.unavailable).toBe(true);expect(s.reset(id,c)).toBe(false);
});
