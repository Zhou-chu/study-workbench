// Pure protocol units, no subprocess or filesystem.
import {test} from 'node:test';
import assert from 'node:assert/strict';
async function api(){const m=await import('./coverage-executed-files.mjs').catch(()=>({}));assert.equal(typeof m.auditExecutedFiles,'function');return m;}
const root='/repo';
const path='frontend/src/app/(dashboard)/[id]/page.test.tsx';
function vitest(name='/repo/'+path){return {success:true,testResults:[{name,status:'passed',assertionResults:[{status:'passed'}]}]};}
function node(){return {version:1,engine:'node',complete:true,summaries:[{file:'/repo/a.test.mjs',success:true,counts:{tests:1,passed:1,failed:0,cancelled:0,skipped:0,todo:0,topLevel:1,suites:0}}]};}
test('Vitest exact execution matches literal paths',async()=>{const m=await api();assert.deepEqual(m.auditExecutedFiles(root,[path],vitest(),'vitest'),[path]);});
test('Node file summaries match actual entrypoints',async()=>{const m=await api();assert.deepEqual(m.auditExecutedFiles(root,['a.test.mjs'],node(),'node'),['a.test.mjs']);});
for(const change of ['missing','extra','duplicate','skipped','failed','malformed','outside'])
test('Vitest rejects '+change+' execution evidence',async()=>{
 const m=await api();const r=vitest();
 if(change==='missing')r.testResults=[];
 if(change==='extra')r.testResults.push(vitest('/repo/other.test.ts').testResults[0]);
 if(change==='duplicate')r.testResults.push(r.testResults[0]);
 if(change==='skipped')r.testResults[0].assertionResults=[{status:'pending'}];
 if(change==='failed')r.success=false;
 if(change==='malformed')r.testResults=null;
 if(change==='outside')r.testResults[0].name='/other/test.ts';
 assert.throws(()=>m.auditExecutedFiles(root,[path],r,'vitest'));
});
test('empty execution is explicit, not absent evidence',async()=>{
 const m=await api();
 assert.deepEqual(m.auditExecutedFiles(root,[],{success:true,testResults:[]},'vitest'),[]);
 assert.deepEqual(m.auditExecutedFiles(root,[],{version:1,engine:'node',complete:true,summaries:[]},'node'),[]);
 assert.throws(()=>m.auditExecutedFiles(root,[],null,'vitest'));
});
for(const change of ['incomplete','skip','duplicate','missing','failed'])
test('Node rejects '+change+' file summaries',async()=>{
 const m=await api(),r=node();
 if(change==='incomplete')r.complete=false;
 if(change==='skip')r.summaries[0].counts.passed=0;
 if(change==='duplicate')r.summaries.push(r.summaries[0]);
 if(change==='missing')r.summaries=[];
 if(change==='failed')r.summaries[0].success=false;
 assert.throws(()=>m.auditExecutedFiles(root,['a.test.mjs'],r,'node'));
});

for(const status of ['failed','unknown','pending',null,undefined])
test('passed Vitest row cannot hide an inconsistent '+String(status)+' assertion',async()=>{
 const m=await api(),r=vitest();
 r.testResults[0].assertionResults.push({status});
 assert.throws(()=>m.auditExecutedFiles(root,[path],r,'vitest'));
});
test('passed Vitest assertions may coexist with explicit skipped and todo',async()=>{
 const m=await api(),r=vitest();
 r.testResults[0].assertionResults.push({status:'skipped'},{status:'todo'});
 assert.deepEqual(m.auditExecutedFiles(root,[path],r,'vitest'),[path]);
});
for(const [key,value] of [['tests',0],['tests',99],['skipped',-1],['todo',0.5],['topLevel',Infinity],['suites','0'],['passed',true],['skipped',undefined],['topLevel',99]])
test('Node rejects inconsistent or invalid '+key+'='+String(value),async()=>{
 const m=await api(),r=node();r.summaries[0].counts[key]=value;
 assert.throws(()=>m.auditExecutedFiles(root,['a.test.mjs'],r,'node'));
});
test('Node accepts consistent passing, skipped and todo counts',async()=>{
 const m=await api(),r=node();
 Object.assign(r.summaries[0].counts,{tests:3,skipped:1,todo:1,topLevel:3});
 assert.deepEqual(m.auditExecutedFiles(root,['a.test.mjs'],r,'node'),['a.test.mjs']);
});
