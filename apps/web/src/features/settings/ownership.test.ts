import {expect,it,beforeEach} from 'vitest';
import {createDraftRegistry,createNavigationController} from '../../app/drafts';
import {sourceContext} from '../../test/source-fixtures';
import {readTurnContext,sessionCoordinator} from '@study/web-transport';
beforeEach(()=>sourceContext());
it('settings drafts join the existing resource guard without displacing Library ownership',()=>{
 const r=createDraftRegistry(),n=createNavigationController(r),c=readTurnContext()!;
 const id=r.settings.open('n',c,sessionCoordinator.current());
 r.settings.edit(id,{name:'changed'});n.activateResource(id);
 expect(n.requestNavigation({destination:'/sources'})).toBe('confirm');
 const capture=n.getSnapshot().capture;r.settings.edit(id,{name:'later'});
 expect(n.confirm(capture)).toBeNull();expect(r.hasUnsaved()).toBe(true);
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
