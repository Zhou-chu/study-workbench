import {expect,it,beforeEach} from 'vitest';
import {createDraftRegistry,createNavigationController} from '../../app/drafts';
import {createSourceOperations} from '../sources/source-operations';
import {selection,sourceContext} from '../../test/source-fixtures';
import {readTurnContext,sessionCoordinator,RequestNotDispatchedError} from '@study/web-transport';
beforeEach(()=>sourceContext());
import {safeReturnPath} from '../auth/cold-return';
it('clears each private callback in its original epoch despite another callback throwing',()=>{
 const r=createDraftRegistry(),calls:string[]=[];
 r.registerPrivateClear(9,()=>{calls.push('first');throw Error('synthetic')});
 const unregister=r.registerPrivateClear(9,()=>calls.push('removed'));unregister();
 r.registerPrivateClear(9,()=>calls.push('second'));r.registerPrivateClear(10,()=>calls.push('other'));
 r.retireContext(9);expect(calls).toEqual(['first','second']);r.retireContext(9);expect(calls).toEqual(['first','second']);
});
it('rejects non-root, login, control, protocol relative and backslash cold-return destinations',()=>{
 for(const v of ['https://elsewhere.test/','//elsewhere.test','/\\evil','/login','/login?next=/sources','/%2f%2fevil','/sources\n','javascript:alert(1)'])expect(safeReturnPath(v)).toBeNull();
 expect(safeReturnPath('/notebooks/n?tab=tools#scope')).toBe('/notebooks/n?tab=tools#scope');
});
it('reserves the sole selection writer and invalidates old revisions even through A-B-A',()=>{
 const c=readTurnContext()!;const s=createSourceOperations(()=>{}),g=sessionCoordinator.current();
 const rev=s.selectionRevision('n');
 const id=s.reserveSelection('n',{...selection,remote_source_ids:[]},c,g)!;
 expect(s.selectionRevision('n')).toBeGreaterThan(rev);
 expect(s.begin(id,c,g)).toBeNull();
 expect(s.capture('n',{kind:'selection',selection},c,g)).toBe(id);
 s.releaseSelection(id);expect(s.begin(id,c,g)).not.toBeNull();
 expect(s.selectionRevision('n')).not.toBe(rev);
});
it('settings drafts join the existing resource guard without displacing Library ownership',()=>{
 const r=createDraftRegistry(),n=createNavigationController(r),c=readTurnContext()!;
 const id=r.settings.open('n',c,sessionCoordinator.current());
 r.settings.edit(id,{name:'changed'});n.activateResource(id);
 expect(n.requestNavigation({destination:'/sources'})).toBe('confirm');
 const capture=n.getSnapshot().capture;r.settings.edit(id,{name:'later'});
 expect(n.confirm(capture)).toBeNull();expect(r.hasUnsaved()).toBe(true);
});

it('releases a link reservation only on actual never-dispatched proof, never generic failure',()=>{
 const c=readTurnContext()!,s=createSourceOperations(()=>{}),g=sessionCoordinator.current();
 const id=s.reserveSelection('n',selection,c,g)!;
 expect(s.releaseUnsentReservation(id,new Error('network'))).toBe(false);expect(s.get(id)?.reserved).toBe(true);
 expect(s.releaseUnsentReservation(id,new RequestNotDispatchedError('duplicate'))).toBe(true);expect(s.get(id)).toBeUndefined();
 const sent=s.reserveSelection('n',selection,c,g)!;s.releaseSelection(sent);s.begin(sent,c,g);
 expect(s.releaseUnsentReservation(sent,new RequestNotDispatchedError('duplicate'))).toBe(false);
});

it('retains a foreign-epoch reservation without returning it as the new epoch writer',()=>{
 const c=readTurnContext()!,s=createSourceOperations(()=>{}),g=sessionCoordinator.current();
 const old=s.reserveSelection('n',selection,c,g)!;s.retire(c.epoch);const next=sourceContext();
 const fresh=s.reserveSelection('n',selection,next,sessionCoordinator.current());
 expect(fresh).not.toBeNull();expect(fresh).not.toBe(old);
 expect(s.get(old)?.retired).toBe(true);expect(s.begin(old,next,sessionCoordinator.current())).toBeNull();
});

it('does not silently select a new settings owner after the original is retired',()=>{
 const d=createDraftRegistry(),oldContext=readTurnContext()!,g=sessionCoordinator.current();
 const old=d.settings.open('n',oldContext,g);d.settings.edit(old,{remoteTitle:'Original unknown title'});
 const command=d.settings.begin(old,'create',oldContext,g)!;
 d.settings.settle(old,command,'unknown',oldContext,g);d.retireContext(oldContext.epoch);
 const next=sourceContext();
 expect(d.settings.open('n',next,sessionCoordinator.current())).toBe(old);
 expect(d.settings.get(old)).toMatchObject({retired:true,fields:{remoteTitle:'Original unknown title'},command:{id:command.id,status:'unknown'}});
});
