import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createSessionController} from '../features/auth/session';
import * as owner from '../features/auth/session';
import {createDraftRegistry,createNavigationController} from './drafts';
import {readTurnContext,invalidateTurnContext,sessionCoordinator} from '@study/web-transport';
const local={schema_version:'spa-artifact-v1' as const,source_commit:'a'.repeat(40),authored_digest:'b'.repeat(64),asset_digest:'c'.repeat(64),contract_digest:'d'.repeat(64),ui_transport_protocol:1 as const,supported_contracts:['workspace-view-v1'] as ['workspace-view-v1']};
const config={apiUrl:'',auth_mode:'legacy_password',web_session_protocol:null,ui_transport_protocol:1,client_contracts:['workspace-view-v1']};
const caps={contract_version:'client-capabilities-v1',supported_contracts:['workspace-view-v1'],limits:{source_upload_max_bytes:50,portable:{max_archive_bytes:10,max_expanded_bytes:20,max_entity_bytes:10,max_manifest_bytes:10,max_request_bytes:30,multipart_overhead_bytes:10,max_entries:2,max_compression_ratio:5}}};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{invalidateTurnContext();sessionCoordinator.begin();sessionCoordinator.setPhase('bootstrapping');});
afterEach(()=>{vi.restoreAllMocks();});
function fixture(){
 let runtime:unknown=config,capabilities:unknown=caps,capStatus=200;
 const requests:Request[]=[];
 vi.stubGlobal('fetch',vi.fn(async(r:Request)=>{requests.push(r);const p=new URL(r.url).pathname;
  return p==='/config'?json(runtime):p==='/api/auth/status'?json({auth_enabled:false}):p==='/api/personal/client-capabilities'?json(capabilities,capStatus):json({ok:true});
 }));
 const drafts=createDraftRegistry(),retire=vi.fn((epoch:number)=>drafts.retireContext(epoch));
 const controller=createSessionController(retire,async()=>local);
 return {drafts,retire,requests,controller,runtime:(v:unknown)=>{runtime=v;},caps:(v:unknown)=>{capabilities=v;},status:(n:number)=>{capStatus=n;}};
}
it('evaluates real BFF and authenticated API evidence independently',()=>{
 expect(typeof owner.evaluateCompatibility).toBe('function');
 expect(owner.evaluateCompatibility(local,config,caps)).toBe('compatible');
 expect(owner.evaluateCompatibility(local,{...config,ui_transport_protocol:2},caps)).toBe('blocked');
 expect(owner.evaluateCompatibility(local,config,{...caps,supported_contracts:[]})).toBe('blocked');
 expect(owner.evaluateCompatibility(local,config,null)).toBe('unavailable');
 expect(owner.evaluateCompatibility(null,config,caps)).toBe('unavailable');
});
it('keeps original draft, File and unknown identity when runtime becomes incompatible',async()=>{
 const f=fixture();await f.controller.start();const before=readTurnContext()!;
 const id={epoch:before.epoch,notebookId:'n',editorSession:'e'},file=new File(['original'],'original.txt');
 f.drafts.update(id,{question:'unsaved',file});
 const creation=f.drafts.openNotebookCreation(before)!;f.drafts.editNotebookCreation(creation,{name:'unknown'});
 f.drafts.beginNotebookCreation(creation,before);f.drafts.settleNotebookCreation(creation,'unknown',before);
 const original=f.drafts.get(creation);
 f.runtime({...config,ui_transport_protocol:2});await f.controller.check();
 expect(f.controller.getSnapshot()).toMatchObject({ready:false,compatibility:'blocked',hasWorkspace:true});
 expect(f.drafts.get(id)).toMatchObject({question:'unsaved',file,retired:false});
 expect(f.drafts.get(creation)).toBe(original);expect(f.retire).not.toHaveBeenCalled();expect(readTurnContext()?.epoch).toBe(before.epoch);
 await expect(f.controller.transport.send({method:'POST',path:'/notebooks',context:before})).rejects.toThrow();
 expect(f.requests.filter(r=>r.method==='POST')).toHaveLength(0);f.controller.dispose();
});
it('does not use a new BFF declaration as proof that an old API is compatible',async()=>{
 const f=fixture();f.caps({...caps,supported_contracts:[]});await f.controller.start();
 expect(f.requests.some(r=>new URL(r.url).pathname==='/api/personal/client-capabilities')).toBe(true);
 expect(f.controller.getSnapshot()).toMatchObject({ready:false,compatibility:'blocked'});
 f.status(404);await f.controller.check();expect(f.controller.getSnapshot()).toMatchObject({ready:false,compatibility:'unavailable'});f.controller.dispose();
});
it('single-flights stale revalidation without automatically continuing a requested mutation',async()=>{
 const f=fixture();await f.controller.start();const before=readTurnContext()!,count=f.requests.length;
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
 await Promise.allSettled([f.controller.transport.send({method:'POST',path:'/notebooks',context:before}),f.controller.transport.send({method:'POST',path:'/notebooks',context:before})]);
 await f.controller.check();
 expect(f.requests.filter(r=>r.method==='POST')).toHaveLength(0);
 expect(f.requests.slice(count).filter(r=>new URL(r.url).pathname==='/config')).toHaveLength(1);
 expect(f.controller.getSnapshot().ready).toBe(true);f.controller.dispose();
});
it('suspends on offline and hidden and revalidates on recovery without replay',async()=>{
 const f=fixture();await f.controller.start();
 window.dispatchEvent(new Event('offline'));expect(f.controller.getSnapshot().ready).toBe(false);
 window.dispatchEvent(new Event('online'));await f.controller.check();expect(f.controller.getSnapshot().ready).toBe(true);
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
 document.dispatchEvent(new Event('visibilitychange'));expect(f.controller.getSnapshot().ready).toBe(false);
 visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await f.controller.check();
 expect(f.controller.getSnapshot().ready).toBe(true);expect(f.retire).not.toHaveBeenCalled();f.controller.dispose();
});
it('never treats route-retain as permission to reload in-memory custody',()=>{
 const drafts=createDraftRegistry(),navigation=createNavigationController(drafts),reload=vi.fn();
 expect(typeof navigation.requestUpdate).toBe('function');
 const id={epoch:1,notebookId:'n',editorSession:'e'};drafts.update(id,{file:new File(['file'],'f'),question:'original'});
 expect(navigation.requestUpdate(reload)).toBe(false);expect(reload).not.toHaveBeenCalled();
 drafts.update(id,{file:null,question:''});expect(navigation.requestUpdate(reload)).toBe(true);expect(reload).toHaveBeenCalledTimes(1);
});

it('rejects a late capability receipt after a newer offline suspension',async()=>{
 const f=fixture();await f.controller.start();let release!:(r:Response)=>void;
 const original=fetch;
 vi.stubGlobal('fetch',vi.fn((r:Request)=>new URL(r.url).pathname==='/api/personal/client-capabilities'?new Promise<Response>(resolve=>{release=resolve;}):original(r)));
 const checking=f.controller.check();
 for(let i=0;i<20&&!release;i++)await Promise.resolve();
 expect(release).toBeTypeOf('function');
 window.dispatchEvent(new Event('offline'));release(json(caps));await checking;
 expect(f.controller.getSnapshot()).toMatchObject({ready:false,compatibility:'unavailable'});
 expect(f.retire).not.toHaveBeenCalled();f.controller.dispose();
});
it('rejects affirmative malformed evidence rather than trusting contract-name strings alone',()=>{
 expect(owner.evaluateCompatibility(local,{...config,apiUrl:'https://evil.test'},caps)).toBe('blocked');
 expect(owner.evaluateCompatibility(local,config,{contract_version:'client-capabilities-v1',supported_contracts:['workspace-view-v1']})).toBe('blocked');
});
