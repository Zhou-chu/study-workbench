// Tool integration: actual Node/Vitest/c8 and owned temporary fixture files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync,readdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

function invoke(root,args){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const module=new URL('./coverage-node-tests.mjs',import.meta.url).href;
 return spawnSync(process.execPath,['--input-type=module','-e','import {runNodeTests} from '+JSON.stringify(module)+';process.exitCode=runNodeTests('+JSON.stringify(root)+','+JSON.stringify(args)+');'],{env,encoding:'utf8',timeout:10000});
}
const repo=fileURLToPath(new URL('../',import.meta.url));
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'unit-runner-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const dir of ['apps/bff/scripts','apps/web/scripts','src'])mkdirSync(join(root,dir),{recursive:true});
 return root;
}
test('explicit Node files do not discover neighbouring rejected tests',t=>{
 const root=fixture(t);
 writeFileSync(join(root,'apps/web/scripts/selected.test.mjs'),"import test from 'node:test';test('selected',()=>{});");
 writeFileSync(join(root,'apps/web/scripts/rejected.test.mjs'),"throw Error('MUST NOT RUN');");
 const result=invoke(root,['--files-json='+JSON.stringify(['apps/web/scripts/selected.test.mjs'])]);
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/pass 1/);
});
test('empty explicit Node selection executes no discovered test',t=>{
 const root=fixture(t);
 writeFileSync(join(root,'apps/web/scripts/rejected.test.mjs'),"throw Error('MUST NOT RUN');");
 const result=invoke(root,['--files-json=[]']);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.doesNotMatch(result.stdout,/pass 1/);
});
test('explicit Node selection rejects directories and traversal before spawning',t=>{
 const root=fixture(t);
 for(const paths of [['apps/web/scripts'],['../x.test.mjs'],['frontend/scripts/a.test.mjs']])
  assert.notEqual(invoke(root,['--files-json='+JSON.stringify(paths)]).status,0);
});
test('real Vitest empty include still reports untouched production sources at zero',t=>{
 const root=fixture(t);
 symlinkSync(resolve(repo,'node_modules'),join(root,'node_modules'),'dir');
 writeFileSync(join(root,'src/logic.js'),'export function answer(x) { return x ? 1 : 2; }');
 const plan=new URL('./coverage-unit-plan.mjs',import.meta.url).href;
 writeFileSync(join(root,'coverage.config.mjs'),"import {unitVitestConfig} from "+JSON.stringify(plan)+"; export default unitVitestConfig({test:{coverage:{enabled:true,provider:'v8',include:['src/**/*.js'],exclude:[],reporter:['json-summary'],reportsDirectory:'coverage'}}},[]);");
 const result=spawnSync(process.execPath,[resolve(repo,'node_modules/vitest/vitest.mjs'),'run','--config','coverage.config.mjs','--maxWorkers=1'],{cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const report=JSON.parse(readFileSync(join(root,'coverage/coverage-summary.json')));
 assert.ok(report[resolve(root,'src/logic.js')]);
 assert.ok(report.total.statements.total>0);
 for(const metric of ['statements','branches','functions','lines'])assert.equal(report.total[metric].covered,0);
});

test('unit artifact mode rejects invalid evidence before pretest or directory discovery',t=>{
 const root=fixture(t);
 const artifact=join(root,'bad-selection.json');writeFileSync(artifact,JSON.stringify({layer:'unit',unitFiles:['apps/web/scripts/selected.test.mjs']}));
 const module=new URL('./coverage-workspaces.mjs',import.meta.url).href;
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--input-type=module','-e','import {runCoverage} from '+JSON.stringify(module)+';try{runCoverage('+JSON.stringify(root)+','+JSON.stringify(['--unit-selection='+artifact])+');process.exitCode=3}catch(e){console.log(e.message)}'],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/producer|selection|unit/i);
});

test('real c8 empty explicit Node selection measures untouched source at zero',t=>{
 const root=fixture(t);
 writeFileSync(join(root,'src/logic.js'),'function answer(x) { return x ? 1 : 2; }');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,[resolve(repo,'node_modules/c8/bin/c8.js'),'--all','--src=src','--include=src/*.js','--reporter=json-summary','--reports-dir=coverage',process.execPath,'--eval',''],{cwd:root,env,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const report=JSON.parse(readFileSync(join(root,'coverage/coverage-summary.json')));
 assert.ok(report[resolve(root,'src/logic.js')]);
 assert.ok(report.total.statements.total>0);
 for(const metric of ['statements','branches','functions','lines'])assert.equal(report.total[metric].covered,0);
});
test('real Vitest exact file include never runs neighbouring integration suite',t=>{
 const root=fixture(t);
 symlinkSync(resolve(repo,'node_modules'),join(root,'node_modules'),'dir');
 writeFileSync(join(root,'src/logic.js'),'export function answer() { return 1; }');
 writeFileSync(join(root,'src/logic.test.js'),"import {test,expect} from 'vitest';import {answer} from './logic.js';test('unit',()=>expect(answer()).toBe(1));");
 writeFileSync(join(root,'src/logic.integration.test.js'),"throw Error('MUST NOT RUN');");
 const plan=new URL('./coverage-unit-plan.mjs',import.meta.url).href;
 writeFileSync(join(root,'coverage.config.mjs'),"import {unitVitestConfig} from "+JSON.stringify(plan)+"; export default unitVitestConfig({test:{include:['src/*.test.js'],coverage:{enabled:true,provider:'v8',include:['src/logic.js'],exclude:[],reporter:['json-summary'],reportsDirectory:'coverage'}}},['src/logic.test.js']);");
 const result=spawnSync(process.execPath,[resolve(repo,'node_modules/vitest/vitest.mjs'),'run','--config','coverage.config.mjs','--maxWorkers=1'],{cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/1 passed/);
});

// Reporter doubles below verify orchestration/identity, NOT actual coverage rates.
test('validated same-checkout artifact dispatches all eleven partitions and preserves mixed reports',async t=>{
 const root=fixture(t);
 const put=(file,text)=>{mkdirSync(resolve(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);};
 for(const file of readdirSync(join(repo,'scripts')).filter(f=>/^coverage-.*\.mjs$/.test(f)&&!f.endsWith('.test.mjs'))){
  mkdirSync(join(root,'scripts'),{recursive:true});copyFileSync(join(repo,'scripts',file),join(root,'scripts',file));
 }
 put('scripts/quality/test_layers.py',readFileSync(join(repo,'scripts/quality/test_layers.py')));
 put('.gitignore','coverage/\nnode_modules/\nfrontend/node_modules/\n');
 put('package.json',JSON.stringify({type:'module',scripts:{pretest:'node -e "process.exit(0)"'}}));
 for(const dir of ['packages/contracts','packages/domain','packages/web-transport','apps/bff','apps/web','frontend']){
  put(dir+'/src/a.ts','export const x=1;');
  put(dir+'/coverage.config.ts','export default {test:{coverage:{include:["src/**/*.ts"]}}};');
 }
 for(const file of ['apps/web/vite.config.ts','frontend/vitest.config.ts','scripts/coverage-quality.config.ts','scripts/coverage-deployment.config.ts','examples/easypanel/index.ts','frontend/next.config.ts'])put(file,'export default {test:{coverage:{include:[]}}};');
 put('apps/web/public/theme-bootstrap.js','const x=1;');put('frontend/start-server.js','const x=1;');
 const testFile='apps/web/scripts/selected.test.mjs',bytes="import test from 'node:test';test('selected',()=>{});";
 put(testFile,bytes);
 put('scripts/quality/test-layers.json',JSON.stringify({version:1,entries:[{path:testFile,layer:'unit',targets:['apps/web/public/theme-bootstrap.js'],reason:'Synthetic direct boundary.',sha256:createHash('sha256').update(bytes).digest('hex')}]}));
 put('frontend/node_modules/next/package.json','{}');
 const {inventory}=await import(pathToFileURL(join(root,'scripts/coverage-inventory.mjs')).href);
 const {unitPartitions}=await import(pathToFileURL(join(root,'scripts/coverage-unit-plan.mjs')).href);
 const sources=Object.fromEntries(Object.entries(unitPartitions).map(([name,dir])=>[name,inventory(root,name,dir)]));
 const child="import{mkdirSync,writeFileSync,readFileSync}from'node:fs';import{resolve,basename}from'node:path';const root="+JSON.stringify(root)+",sources="+JSON.stringify(sources)+";const a=process.argv;const report=a.find(x=>x.startsWith('--reports-dir='));const config=a[a.indexOf('--config')+1];const name=report?report.split('/').at(-1):basename(config,'.mjs');const dir=resolve(root,'coverage/unit',name);mkdirSync(dir,{recursive:true});const metrics=Object.fromEntries(['statements','branches','functions','lines'].map(k=>[k,{total:1,covered:0,pct:0}]));writeFileSync(resolve(dir,'coverage-summary.json'),JSON.stringify({total:metrics,...Object.fromEntries(sources[name].map(f=>[f,metrics]))}));writeFileSync(resolve(dir,'dispatch.json'),JSON.stringify({args:a,config:report?null:readFileSync(config,'utf8')}));";
 put('node_modules/vitest/vitest.mjs',child);put('frontend/node_modules/vitest/vitest.mjs',child);
 put('node_modules/c8/bin/c8.js',child);put('node_modules/c8/package.json','{"type":"module"}');
 const git=(...args)=>{const r=spawnSync('/usr/bin/git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
 const module=await import(pathToFileURL(join(root,'scripts/coverage-unit-selection.mjs')).href);
 const artifact=module.createUnitSelection(root);
 put('coverage/selection.json',JSON.stringify(artifact));
 put('coverage/run-contracts.json','preserved mixed evidence');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 env.PATH=resolve(process.execPath,'..')+':/usr/bin:/bin';
 const result=spawnSync(process.execPath,[join(root,'scripts/coverage-workspaces.mjs'),'--unit-selection='+join(root,'coverage/selection.json')],{cwd:root,env,encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(readFileSync(join(root,'coverage/run-contracts.json'),'utf8'),'preserved mixed evidence');
 const rows=JSON.parse(readFileSync(join(root,'coverage/unit/run-all.json'))).partitions;
 assert.equal(rows.length,11);
 for(const row of rows){
  assert.equal(row.layer,'unit');assert.equal(row.selectionRevision,artifact.revision);
  assert.deepEqual(row.audit.missing,[]);assert.deepEqual(row.audit.unexpected,[]);
  assert.equal(row.emptyUnitPartition,row.partition!=='node-tools');
  const dispatch=JSON.parse(readFileSync(join(root,'coverage/unit',row.partition,'dispatch.json')));
  if(dispatch.config)assert.match(dispatch.config,/unitVitestConfig\(base,\[\]\)/);
 }
 const dispatch=JSON.parse(readFileSync(join(root,'coverage/unit/node-tools/dispatch.json')));
 assert.ok(dispatch.args.includes('--files-json='+JSON.stringify([testFile])));
});

test('malformed explicit Node option can never fall back to discovery',t=>{
 const root=fixture(t);
 for(const args of [['--files-json=null'],['--files-json'],['--files-json=[]','--files-json=[]']]){
  const result=invoke(root,args);
  assert.notEqual(result.status,0,'must reject '+JSON.stringify(args));
 }
});
