import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {runCoverage} from '../../coverage-workspaces.mjs';
import {runGate} from '../../coverage-gate.mjs';
import {runScopeCheck} from '../../coverage-scope-check.mjs';
import {runNodeTests} from '../../coverage-node-tests.mjs';
import {coveragePartitions} from '../../coverage-scope.mjs';
import {inventory} from '../../coverage-inventory.mjs';
import {saveManifest} from '../../coverage-integrity.mjs';
const roots:string[]=[];
const put=(root:string,file:string,text:string)=>{mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);};
function fixture(mode='valid'){
 const root=mkdtempSync(join(tmpdir(),'quality CLI space '));roots.push(root);execFileSync('git',['init','--quiet'],{cwd:root});
 put(root,'.gitignore','coverage/\nnode_modules/\n');
 put(root,'package.json',JSON.stringify({scripts:{pretest:'node -e "process.exit(0)"'}}));
 for(const file of ['examples/easypanel/index.ts','frontend/next.config.ts','apps/web/public/theme-bootstrap.js','frontend/start-server.js','apps/web/vite.config.ts','frontend/vitest.config.ts','scripts/coverage-quality.config.ts'])put(root,file,'export default {};');
 for(const dir of ['packages/contracts','packages/domain','packages/web-transport','apps/bff','apps/web','frontend'])put(root,dir+'/src/main.ts','export const value=1;');
 put(root,'frontend/node_modules/next/package.json','{}');
 const sources=Object.fromEntries(Object.entries(coveragePartitions).map(([name,dir])=>[name,inventory(root,name,dir)]));
 put(root,'fixture.json',JSON.stringify({mode,sources}));
 const child=`import{readFileSync,mkdirSync,writeFileSync}from'node:fs';import{resolve}from'node:path';
 const root=${JSON.stringify(root)}, settings=JSON.parse(readFileSync(resolve(root,'fixture.json'),'utf8'));
 const reportArg=process.argv.find(x=>x.startsWith('--reports-dir='));
 const config=process.argv[process.argv.indexOf('--config')+1];
 const cwd=process.cwd();
 const name=reportArg?reportArg.split('/').at(-1):config?.includes('coverage-quality')?'quality-tooling':config?.includes('coverage-deployment')?'deployment-config':cwd.endsWith('/frontend')?'legacy-web':cwd.split('/').at(-1);
 if(settings.mode==='missing')process.exit(0);
 mkdirSync(resolve(root,'coverage',name),{recursive:true});
 const metrics=Object.fromEntries(['statements','branches','functions','lines'].map(k=>[k,{total:100,covered:100,pct:100}]));
 const summary={total:metrics,...Object.fromEntries(settings.sources[name].map(p=>[p,metrics]))};
 writeFileSync(resolve(root,'coverage',name,'coverage-summary.json'),settings.mode==='malformed'?'{bad':JSON.stringify(summary));
 if(settings.mode==='changed')writeFileSync(resolve(root,'packages/contracts/src/main.ts'),'changed');
 if(settings.mode==='failed')process.exitCode=3;
 `;
 put(root,'node_modules/vitest/vitest.mjs',child);put(root,'frontend/node_modules/vitest/vitest.mjs',child);put(root,'node_modules/c8/bin/c8.js',child);
 // Node treats fixture c8 .js as ESM, just like the installed package.
 put(root,'node_modules/c8/package.json','{"type":"module"}');
 return root;
}
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const read=(root:string,name:string)=>JSON.parse(readFileSync(join(root,'coverage/run-'+name+'.json'),'utf8')).partitions[0];
it('real subprocess fixtures exercise every partition route and full-run manifests without touching this checkout',()=>{
 const root=fixture();expect(runCoverage(root,[])).toBe(0);
 expect(JSON.parse(readFileSync(join(root,'coverage/run-all.json'),'utf8')).partitions).toHaveLength(Object.keys(coveragePartitions).length);
 for(const name of Object.keys(coveragePartitions))expect(read(root,name)).toMatchObject({phase:'complete',testExitCode:0,inputChangedDuringRun:false,sourceChangedDuringRun:false,audit:{missing:[],unexpected:[]}});
},20000);
it.each(['failed','missing','malformed','changed'])('runner records %s evidence and invalidates previous success',mode=>{
 const root=fixture(mode);saveManifest(root,'contracts',{phase:'complete',testExitCode:0});
 expect(runCoverage(root,['--only=contracts'])).toBe(1);
 const result=read(root,'contracts');
 if(mode==='failed')expect(result.testExitCode).toBe(3);
 if(mode==='missing')expect(result.missingReport).toBe(true);
 if(mode==='malformed')expect(result).toMatchObject({phase:'failed',testExitCode:1,blocked:expect.stringContaining('Invalid coverage summary')});
 if(mode==='changed')expect(result).toMatchObject({sourceChangedDuringRun:true,inputChangedDuringRun:true});
});
it('pretest failure cannot leave prior green results; invalid filters do not execute pretest',()=>{
 const root=fixture();put(root,'package.json',JSON.stringify({scripts:{pretest:'node -e "process.exit(7)"'}}));
 expect(runCoverage(root,['--only=contracts'])).toBe(1);expect(read(root,'contracts')).toMatchObject({phase:'failed',blocked:'pretest failed'});
 expect(()=>runCoverage(root,['--only='])).toThrow(/Unknown/);expect(()=>runCoverage(root,['--only=other'])).toThrow(/Unknown/);
});
it('missing legacy dependencies are reported without installation',()=>{
 const root=fixture();rmSync(join(root,'frontend/node_modules/next'),{recursive:true});
 expect(runCoverage(root,['--only=legacy-web'])).toBe(1);expect(read(root,'legacy-web').blocked).toContain('Legacy dependencies missing');
});
it('gate accepts exact fresh reports and rejects stale/tampered/malformed artifacts',()=>{
 const root=fixture();expect(runCoverage(root,[])).toBe(0);expect(runGate(root)).toBe(0);
 const report=join(root,'coverage/contracts/coverage-summary.json');writeFileSync(report,'{bad');expect(runGate(root)).toBe(1);
 put(root,'coverage/run-contracts.json','{bad');expect(runGate(root)).toBe(1);
 put(root,'unknown.ts','export const unknown=1;');expect(runGate(root)).toBe(1);
},20000);
it('scope CLI writes its audit and unknown code fails closed',()=>{
 const root=fixture();expect(runScopeCheck(root)).toBe(0);expect(JSON.parse(readFileSync(join(root,'coverage/scope-audit.json'),'utf8')).unmeasured).toEqual([]);
 put(root,'unknown.ts','export const x=1');expect(runScopeCheck(root)).toBe(1);
});
it('node suite runner preserves fixture cwd and failed child status for modern and legacy groups',()=>{
 const root=fixture();for(const dir of ['apps/bff','apps/web','frontend'])put(root,dir+'/scripts/cwd.test.mjs',`import test from 'node:test';import assert from 'node:assert/strict';test('cwd',()=>assert.ok(process.cwd().endsWith(${JSON.stringify(dir)})));`);
 expect(runNodeTests(root,[])).toBe(0);expect(runNodeTests(root,['--legacy'])).toBe(0);
 put(root,'frontend/scripts/fail.test.mjs',"import test from 'node:test';test('failure',()=>{throw Error('fixture only')});");expect(runNodeTests(root,['--legacy'])).toBe(1);
});
it('module imports never execute CLIs; exported gate works in a real Node subprocess with space-containing fixture paths',()=>{
 const root=fixture();const url=pathToFileURL(resolve('scripts/coverage-gate.mjs')).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`const {runGate}=await import(${JSON.stringify(url)});process.exitCode=runGate(${JSON.stringify(root)});`],{encoding:'utf8'});
 expect(result.status).toBe(1);expect(result.stderr).toContain('missing/blocked/failed run');
});

it('direct-execution guard supports script and Node paths containing spaces',()=>{
 const root=fixture();for(const dir of ['apps/bff','apps/web'])put(root,dir+'/scripts/success.test.mjs',"import test from 'node:test';test('fixture',()=>{});");
 const copy=join(root,'runner space/coverage-node-tests.mjs');put(root,'runner space/coverage-node-tests.mjs',readFileSync(resolve('scripts/coverage-node-tests.mjs'),'utf8'));
 const binary=join(root,'node with spaces');symlinkSync(process.execPath,binary);
 const result=spawnSync(binary,[copy],{cwd:root,encoding:'utf8'});expect(result.status).toBe(0);expect(result.stdout).toContain('pass 1');
});
it.skipIf(process.platform==='win32')('interrupted real run leaves pending, never an older green manifest',async()=>{
 const root=fixture();put(root,'package.json',JSON.stringify({scripts:{pretest:'node -e "setTimeout(()=>{},10000)"'}}));saveManifest(root,'contracts',{phase:'complete',testExitCode:0});
 const url=pathToFileURL(resolve('scripts/coverage-workspaces.mjs')).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`const {runCoverage}=await import(${JSON.stringify(url)});process.exitCode=runCoverage(${JSON.stringify(root)},['--only=contracts']);`],{detached:true,stdio:'ignore'});
 const closed=once(child,'exit');
 try{
  for(let i=0;i<100&&read(root,'contracts').phase!=='pending';i++)await new Promise(resolve=>setTimeout(resolve,10));
  expect(read(root,'contracts').phase).toBe('pending');
 }finally{if(child.pid)process.kill(-child.pid,'SIGTERM');await closed;}
 expect(read(root,'contracts')).toMatchObject({phase:'pending',testExitCode:null});
});
