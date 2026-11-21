import {beforeEach,expect,it} from 'vitest';
import {createDraftRegistry,createNavigationController} from '../../app/drafts';
import {sourceContext} from '../../test/source-fixtures';
import {readTurnContext,sessionCoordinator} from '@study/web-transport';
beforeEach(sourceContext);
it('Advanced participates in the existing resource guard without changing notebook SettingsDraft',()=>{
 const r=createDraftRegistry(),nav=createNavigationController(r),c=readTurnContext()!,id=r.advanced.open(c)!;
 r.advanced.edit(id,{mode:'all'});nav.activateResource(id);expect(nav.requestNavigation({destination:'/settings'})).toBe('confirm');
 const token=r.advanced.capture(id,c,sessionCoordinator.current(),2)!;r.advanced.begin(token,c,sessionCoordinator.current(),2);
 expect(nav.requestNavigation({destination:'/settings'})).toBe('retain');r.retireContext(c.epoch);
 expect(r.advanced.get(id)?.retired).toBe(true);expect(r.settings.getSnapshot()).toEqual([]);
});
