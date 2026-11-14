import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {coverageEnvironment} from '../../coverage-environment.mjs';
import {recordedRun} from '../../coverage-process.mjs';
import {assessCoverage} from '../../coverage-policy.mjs';
import {beginRun,saveManifest,inputDigest,fileDigest} from '../../coverage-integrity.mjs';
import {inventory,auditReport,sourceDigest,qualityToolingFiles,qualityConfigFiles} from '../../coverage-inventory.mjs';
import {auditRepositoryScope} from '../../coverage-scope.mjs';
const roots:string[]=[];
const temp=()=>{const root=mkdtempSync(join(tmpdir(),'quality-unit-'));roots.push(root);return root;};
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();vi.resetModules();});
it('isolates credentials, proxies and home without mutating parent',()=>{
 const parent={PATH:'/bin',HOME:'/real',OPENAI_API_KEY:'fake',NODE_OPTIONS:'bad',HTTP_PROXY:'bad'};
 const root=temp(),env=coverageEnvironment(root,parent);
 expect(env.PATH).toBe('/bin');expect(env.HOME).toBe(join(root,'home'));expect(env.NODE_ENV).toBe('test');
 for(const key of ['OPENAI_API_KEY','NODE_OPTIONS','HTTP_PROXY'])expect(env).not.toHaveProperty(key);
 expect(parent.HOME).toBe('/real');
});
it('persists child success/failure output and spawn errors',()=>{
 const root=temp(),env=coverageEnvironment(root,process.env),logPath=join(root,'out/log');
 expect(recordedRun(process.execPath,['-e',"console.log('stdout');console.error('stderr');process.exitCode=3"],{cwd:root,env,logPath})).toBe(3);
 expect(readFileSync(logPath,'utf8')).toMatch(/stdout[\s\S]*stderr/);
 expect(recordedRun(join(root,'absent'),[],{cwd:root,env,logPath})).toBe(1);
 expect(readFileSync(logPath,'utf8')).toContain('ENOENT');
});
it('strict raw ratios and corrupted, stale, pending reports fail closed',()=>{
 const row={phase:'complete',inputDigest:'i',reportHash:'r',testExitCode:0,sourceDigest:'s',audit:{missing:[],unexpected:[]},coverage:Object.fromEntries(['lines','branches','functions','statements'].map(k=>[k,{covered:91,total:100}]))};
 expect(assessCoverage(row,'s','i','r')).toEqual([]);
 for(const change of [{phase:'pending'},{blocked:'build'},{testExitCode:1},{inputChangedDuringRun:true},{sourceChangedDuringRun:true},{missingReport:true},{audit:{missing:['file'],unexpected:[]}}])expect(assessCoverage({...row,...change},'s','i','r').length).toBeGreaterThan(0);
 expect(assessCoverage(null,'s','i','r').length).toBeGreaterThan(0);
 for(const value of [{covered:90,total:100},{covered:0,total:0},{covered:NaN,total:100},{covered:101,total:100},{covered:-1,total:10},{covered:1.5,total:10}])expect(assessCoverage({...row,coverage:{...row.coverage,lines:value}},'s','i','r').length).toBeGreaterThan(0);
 expect(assessCoverage(row,'changed','changed','changed').length).toBeGreaterThan(0);
});
it('real git input digests include binary/helpers and installed receipts; pending replaces success',()=>{
 const root=temp();execFileSync('git',['init','--quiet'],{cwd:root});
 writeFileSync(join(root,'file.py'),'original');const before=inputDigest(root);
 writeFileSync(join(root,'file.py'),'changed');expect(inputDigest(root)).not.toBe(before);
 mkdirSync(join(root,'node_modules'),{recursive:true});writeFileSync(join(root,'node_modules/.package-lock.json'),'{}');
 expect(inputDigest(root)).not.toBe(before);expect(fileDigest(join(root,'file.py'))).toMatch(/^[a-f0-9]{64}$/);
 saveManifest(root,'sample',{phase:'complete'});beginRun(root,['sample'],'digest');
 expect(JSON.parse(readFileSync(join(root,'coverage/run-sample.json'),'utf8')).partitions[0]).toMatchObject({phase:'pending',inputDigest:'digest',testExitCode:null});
});
it('unexecuted tools remain inventory and source audit rejects absent or extra report entries',()=>{
 const root=temp();mkdirSync(join(root,'scripts'),{recursive:true});
 writeFileSync(join(root,'scripts/coverage-unused.mjs'),'export const untouched=1;');
 writeFileSync(join(root,'scripts/coverage-unused.test.mjs'),'test');
 expect(qualityToolingFiles(root).map(p=>relative(root,p))).toEqual(['scripts/coverage-unused.mjs']);
 expect(auditReport(root,'quality-tooling','.').missing).toEqual(['scripts/coverage-unused.mjs']);
 const before=sourceDigest(root,'quality-tooling','.');writeFileSync(join(root,'scripts/coverage-unused.mjs'),'changed');expect(sourceDigest(root,'quality-tooling','.')).not.toBe(before);
 mkdirSync(join(root,'coverage/quality-tooling'),{recursive:true});writeFileSync(join(root,'coverage/quality-tooling/coverage-summary.json'),JSON.stringify({total:{},[join(root,'extra.ts')]:{}}));
 expect(auditReport(root,'quality-tooling','.').unexpected).toEqual(['extra.ts']);
});
it('repository scope marks tooling measured while retaining unknown executable gaps',()=>{
 const root=temp();execFileSync('git',['init','--quiet'],{cwd:root});mkdirSync(join(root,'scripts'),{recursive:true});
 writeFileSync(join(root,'scripts/coverage-new.mjs'),'export const value=1');writeFileSync(join(root,'unknown.ts'),'export const value=2');
 const audit=auditRepositoryScope(root);expect(audit.unmeasured).toEqual(['unknown.ts']);expect(audit.records.find(r=>r.path==='scripts/coverage-new.mjs')).toMatchObject({kind:'measured-source',partition:'quality-tooling'});
 expect(inventory(root,'quality-tooling','.')).toHaveLength(1);
});

it('tool configs remain a separate complete disjoint denominator, including unexecuted files',()=>{
 const root=temp();mkdirSync(join(root,'scripts'),{recursive:true});mkdirSync(join(root,'apps/web'),{recursive:true});mkdirSync(join(root,'frontend'),{recursive:true});
 for(const file of ['scripts/coverage-quality.config.ts','apps/web/vite.config.ts','frontend/vitest.config.ts','scripts/coverage-unused.mjs'])writeFileSync(join(root,file),'export default {};');
 expect(qualityConfigFiles(root)).toHaveLength(3);expect(qualityToolingFiles(root)).toEqual([join(root,'scripts/coverage-unused.mjs')]);
 expect(auditReport(root,'quality-configs',null).missing).toHaveLength(3);
 expect(new Set([...qualityConfigFiles(root),...qualityToolingFiles(root)]).size).toBe(4);
});

it('production inventory distinguishes fixtures, declarations, tests and entrypoints for every workspace kind',()=>{
 const root=temp();
 for(const directory of ['apps/web/src/test','frontend/src/test','apps/bff/src','packages/domain/src','apps/web/scripts','apps/bff/scripts','scripts/v1','frontend/scripts'])mkdirSync(join(root,directory),{recursive:true});
 for(const path of ['apps/web/src/main.tsx','frontend/src/main.tsx','apps/bff/src/cli.ts','packages/domain/src/core.ts','apps/web/src/test/setup.ts','frontend/src/test/setup.ts','apps/web/src/ambient.d.ts','apps/web/src/unit.test.ts','apps/web/src/unit.spec.ts','apps/web/src/README.md','apps/web/scripts/build.mjs','apps/bff/scripts/build.mjs','scripts/v1/runtime.mjs','frontend/scripts/build.mjs'])writeFileSync(join(root,path),'export const x=1;');
 expect(inventory(root,'web','apps/web')).toEqual([join(root,'apps/web/src/main.tsx')]);
 expect(inventory(root,'legacy-web','frontend')).toEqual([join(root,'frontend/src/main.tsx')]);
 expect(inventory(root,'bff','apps/bff')).toEqual([join(root,'apps/bff/src/cli.ts')]);
 expect(inventory(root,'domain','packages/domain')).toEqual([join(root,'packages/domain/src/core.ts')]);
 expect(inventory(root,'node-tools',null)).toHaveLength(4);
 expect(inventory(root,'legacy-node-tools',null)).toEqual([join(root,'frontend/scripts/build.mjs'),join(root,'frontend/start-server.js')]);
});
it('source audit accepts exact reports and rejects malformed JSON instead of silently passing',()=>{
 const root=temp();mkdirSync(join(root,'packages/domain/src'),{recursive:true});const source=join(root,'packages/domain/src/core.ts');writeFileSync(source,'export const x=1;');
 const report=join(root,'coverage/domain');mkdirSync(report,{recursive:true});
 writeFileSync(join(report,'coverage-summary.json'),JSON.stringify({total:{},[source]:{}}));
 expect(auditReport(root,'domain','packages/domain')).toEqual({expectedSourceFiles:1,reportedSourceFiles:1,missing:[],unexpected:[]});
 writeFileSync(join(report,'coverage-summary.json'),'{bad');expect(()=>auditReport(root,'domain','packages/domain')).toThrow();
});
it('scope audit preserves fixture/declaration/vendor categories without excusing unknown first-party scripts',()=>{
 const root=temp();execFileSync('git',['init','--quiet'],{cwd:root});
 for(const path of ['unit.test.ts','ambient.d.ts','tests/helper.ts','apps/web/public/pdfjs/vendor.js','unknown.mjs']){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),'fixture');}
 const result=auditRepositoryScope(root);expect(result.unmeasured).toEqual(['unknown.mjs']);
 expect(Object.fromEntries(result.records.map(r=>[r.path,r.kind]))).toMatchObject({'unit.test.ts':'test-infrastructure','ambient.d.ts':'declarations','tests/helper.ts':'test-infrastructure','apps/web/public/pdfjs/vendor.js':'third-party-pdfjs'});
});
it('exact metadata counts, empty audits and hash equality are all necessary for a pass',()=>{
 const good={phase:'complete',inputDigest:'i',reportHash:'r',testExitCode:0,sourceDigest:'s',audit:{missing:[],unexpected:[]},coverage:Object.fromEntries(['lines','branches','functions','statements'].map(k=>[k,{covered:100,total:100}]))};
 for(const audit of [null,{missing:[]},{missing:'wrong',unexpected:[]},{missing:[],unexpected:['extra']},{missing:[],unexpected:'wrong'}])expect(assessCoverage({...good,audit},'s','i','r').length).toBeGreaterThan(0);
 for(const value of [undefined,{total:100},{covered:1,total:NaN},{covered:1,total:1.5}])expect(assessCoverage({...good,coverage:{...good.coverage,lines:value}},'s','i','r').length).toBeGreaterThan(0);
 expect(assessCoverage({...good,coverage:{...good.coverage,lines:{covered:90001,total:100000}}},'s','i','r')).toEqual([]);
});
