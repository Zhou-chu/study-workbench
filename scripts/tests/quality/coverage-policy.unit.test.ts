import {expect,it} from 'vitest';
import {assessCoverage} from '../../coverage-policy.mjs';

it('strict raw ratios and corrupted, stale, pending reports fail closed',()=>{
 const row={phase:'complete',inputDigest:'i',reportHash:'r',testExitCode:0,sourceDigest:'s',audit:{missing:[],unexpected:[]},coverage:Object.fromEntries(['lines','branches','functions','statements'].map(k=>[k,{covered:91,total:100}]))};
 expect(assessCoverage(row,'s','i','r')).toEqual([]);
 for(const change of [{phase:'pending'},{blocked:'build'},{testExitCode:1},{inputChangedDuringRun:true},{sourceChangedDuringRun:true},{missingReport:true},{audit:{missing:['file'],unexpected:[]}}])expect(assessCoverage({...row,...change},'s','i','r').length).toBeGreaterThan(0);
 expect(assessCoverage(null,'s','i','r').length).toBeGreaterThan(0);
 for(const value of [{covered:90,total:100},{covered:0,total:0},{covered:NaN,total:100},{covered:101,total:100},{covered:-1,total:10},{covered:1.5,total:10}])expect(assessCoverage({...row,coverage:{...row.coverage,lines:value}},'s','i','r').length).toBeGreaterThan(0);
 expect(assessCoverage(row,'changed','changed','changed').length).toBeGreaterThan(0);
});

it('exact metadata counts, empty audits and hash equality are all necessary for a pass',()=>{
 const good={phase:'complete',inputDigest:'i',reportHash:'r',testExitCode:0,sourceDigest:'s',audit:{missing:[],unexpected:[]},coverage:Object.fromEntries(['lines','branches','functions','statements'].map(k=>[k,{covered:100,total:100}]))};
 for(const audit of [null,{missing:[]},{missing:'wrong',unexpected:[]},{missing:[],unexpected:['extra']},{missing:[],unexpected:'wrong'}])expect(assessCoverage({...good,audit},'s','i','r').length).toBeGreaterThan(0);
 for(const value of [undefined,{total:100},{covered:1,total:NaN},{covered:1,total:1.5}])expect(assessCoverage({...good,coverage:{...good.coverage,lines:value}},'s','i','r').length).toBeGreaterThan(0);
 expect(assessCoverage({...good,coverage:{...good.coverage,lines:{covered:90001,total:100000}}},'s','i','r')).toEqual([]);
});
