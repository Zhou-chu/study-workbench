import {fileURLToPath} from 'node:url';
import {recordedRun} from './coverage-process.mjs';
import { beginRun,saveManifest,inputDigest } from './coverage-integrity.mjs';
import {coverageEnvironment} from './coverage-environment.mjs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync,rmSync,readFileSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessCoverage } from './coverage-policy.mjs';
import { inventory,auditReport,sourceDigest } from './coverage-inventory.mjs';
const assess=(row,digest)=>assessCoverage(row,digest,'inputs','report');
const row=(covered,total)=>({phase:'complete',inputDigest:'inputs',reportHash:'report',testExitCode:0,sourceDigest:'fresh',audit:{missing:[],unexpected:[]},coverage:Object.fromEntries(['statements','branches','functions','lines'].map(key=>[key,{covered,total}]))});
test('strict >90 uses raw counts, never rounded percentages or pass rates',()=>{
 assert.equal(assess(row(90,100),'fresh').length,4);
 assert.equal(assess(row(90001,100000),'fresh').length,0);
 assert.equal(assess(row(0,0),'fresh').length,4);
 assert.ok(assess({...row(100,100),testExitCode:1},'fresh').length);
 assert.ok(assess(row(100,100),'changed').length);
 for(const [covered,total] of [[undefined,100],[NaN,100],[100,NaN],[101,100],[1.5,2],[-1,100]])assert.ok(assess(row(covered,total),'fresh').length);
 assert.ok(assess({...row(100,100),audit:{missing:[],unexpected:['extra.js']}},'fresh').length);
 assert.ok(assess({...row(100,100),audit:{missing:['unimported.ts'],unexpected:[]}},'fresh').length);
});
test('unimported production files and entrypoints remain expected; missing reports fail audit',()=>{
 const root=mkdtempSync(join(tmpdir(),'coverage-inventory-'));
 try{
  mkdirSync(join(root,'apps/web/src/test'),{recursive:true});
  for(const file of ['main.tsx','unimported.ts','example.test.ts','ambient.d.ts','test/fixture.ts'])writeFileSync(join(root,'apps/web/src',file),'export const value=1;');
  assert.equal(inventory(root,'web','apps/web').length,2);
  assert.equal(auditReport(root,'web','apps/web').missing.length,2);
  const before=sourceDigest(root,'web','apps/web');
  writeFileSync(join(root,'apps/web/src/unimported.ts'),'export const value=2;');
  assert.notEqual(sourceDigest(root,'web','apps/web'),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('pending atomically invalidates an old successful partition before pretest or interrupted work',()=>{
 const root=mkdtempSync(join(tmpdir(),'coverage-pending-'));
 try{
  saveManifest(root,'web',row(100,100));
  beginRun(root,['web'],'inputs');
  const pending=JSON.parse(readFileSync(join(root,'coverage/run-web.json'),'utf8')).partitions[0];
  assert.equal(pending.phase,'pending');
  assert.ok(assess(pending,'fresh').length);
  assert.deepEqual(readdirSync(join(root,'coverage')),['run-web.json']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('input digest changes for tests, config, locks and shared source; report tampering fails',()=>{
 const root=mkdtempSync(join(tmpdir(),'coverage-input-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:root});
  for(const file of ['test.test.ts','coverage.config.ts','package-lock.json','shared.ts','helper.py','fixture.bin'])writeFileSync(join(root,file),'initial');
  for(const file of ['test.test.ts','coverage.config.ts','package-lock.json','shared.ts','helper.py','fixture.bin']){
   const before=inputDigest(root);writeFileSync(join(root,file),'changed');assert.notEqual(inputDigest(root),before,file);
  }
  assert.ok(assessCoverage(row(100,100),'fresh','changed','report').length);
  assert.ok(assessCoverage(row(100,100),'fresh','inputs','tampered').length);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('child environment drops credentials and live switches and redirects persisted state',()=>{
 const root=mkdtempSync(join(tmpdir(),'coverage-env-'));
 try{
  const parent={PATH:'/bin',OPENAI_API_KEY:'synthetic-secret',LIVE_TESTS:'1',HOME:'/real/home',NODE_OPTIONS:'--require=/real/code',HTTP_PROXY:'http://real'};
  const env=coverageEnvironment(root,parent);
  assert.equal(env.PATH,'/bin');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.LIVE_TESTS,undefined);
  assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.HTTP_PROXY,undefined);
  assert.ok(env.HOME.startsWith(root));assert.ok(env.STUDY_WORKBENCH_DATA_DIR.startsWith(root));
  assert.equal(parent.HOME,'/real/home');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('failed process stdout and stderr persist without masking its exit code',()=>{
 const root=mkdtempSync(join(tmpdir(),'coverage-log-'));
 try{
  const logPath=join(root,'diagnostics/test.log');
  assert.equal(recordedRun(process.execPath,['-e',"console.log('case name');console.error('failure trace');process.exitCode=3"],{cwd:root,env:process.env,logPath}),3);
  const log=readFileSync(logPath,'utf8');assert.match(log,/case name/);assert.match(log,/failure trace/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('installed c8 includes unexecuted first-party files with compatible glob and exclusion dependencies',()=>{
 const root=mkdtempSync(join(tmpdir(),'coverage-c8-'));
 try{
  writeFileSync(join(root,'entry.mjs'),"console.log('synthetic');");
  writeFileSync(join(root,'untouched.mjs'),"export function untouched(){return 42;}");
  const c8=fileURLToPath(new URL('../node_modules/c8/bin/c8.js',import.meta.url));
  const logPath=join(root,'run.log');
  assert.equal(recordedRun(process.execPath,[c8,'--all','--src=.','--include=*.mjs','--reporter=json-summary','--reports-dir=reports',process.execPath,'entry.mjs'],{cwd:root,env:coverageEnvironment(join(root,'state'),process.env),logPath}),0,readFileSync(logPath,'utf8'));
  const report=JSON.parse(readFileSync(join(root,'reports/coverage-summary.json'),'utf8'));
  assert.ok(report[join(root,'untouched.mjs')]);
  assert.equal(report[join(root,'untouched.mjs')].lines.covered,0);
  assert.ok(report[join(root,'untouched.mjs')].lines.total>0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('deployment source inventory includes both real entrypoints even before execution',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const files=inventory(root,'deployment-config','.');
 assert.deepEqual(files,[join(root,'examples/easypanel/index.ts'),join(root,'frontend/next.config.ts')]);
});
