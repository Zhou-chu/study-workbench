import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {fileURLToPath} from 'node:url';
// Run existing node:test suites in their original cwd; propagate c8's child environment.
export function runNodeTests(root=process.cwd(),args=process.argv.slice(2)) {
const explicitArgs=args.filter(arg=>arg.startsWith('--files-json='));
if(args.includes('--files-json') || explicitArgs.length>1)throw Error('Duplicate explicit Node selection');
const explicit=explicitArgs.length?JSON.parse(explicitArgs[0].slice('--files-json='.length)):null;
const reportArgs=args.filter(arg=>arg.startsWith('--execution-report='));
if(reportArgs.length>1 || args.includes('--execution-report') || (reportArgs.length && !explicitArgs.length))
 throw Error('Execution report requires an explicit selection');
const reportPath=reportArgs.length?resolve(root,reportArgs[0].slice('--execution-report='.length)):null;
if(reportPath){mkdirSync(resolve(reportPath,'..'),{recursive:true});rmSync(reportPath,{force:true});}
const summaries=[];
const quality=args.includes('--quality-configs');
if(quality && !explicitArgs.length)throw Error('Quality config execution requires explicit files');
const directories=quality?['.']:args.includes('--legacy')?['frontend']:['apps/bff','apps/web'];
if(explicitArgs.length && (!Array.isArray(explicit)||new Set(explicit).size!==explicit.length||explicit.some(file=>
 typeof file!=='string'||!(quality?file==='scripts/tests/quality/config-node.test.mjs':directories.some(directory=>file.startsWith(directory+'/scripts/')&&
 /^[A-Za-z0-9_.-]+\.test\.mjs$/.test(file.slice((directory+'/scripts/').length)))))))
 throw Error('Invalid explicit Node test file');
let failed=false;
for(const directory of directories){
 const files=explicit!==null?(quality?explicit:explicit.filter(file=>file.startsWith(directory+'/')).map(file=>file.slice(directory.length+1))):readdirSync(resolve(root,directory,'scripts')).filter(file=>file.endsWith('.test.mjs')).map(file=>'scripts/'+file);
 if(explicit!==null && !files.length)continue;
 const childReport=reportPath?reportPath+'.'+directories.indexOf(directory)+'.json':null;
 if(childReport)rmSync(childReport,{force:true});
 const reporter=childReport?['--test-reporter=spec','--test-reporter-destination=stdout',
  '--test-reporter='+fileURLToPath(new URL('./coverage-node-reporter.mjs',import.meta.url)),
  '--test-reporter-destination='+childReport]:[];
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...reporter,...files],{cwd:resolve(root,directory),stdio:'inherit',env});
 if(childReport){
  try{
   const observed=JSON.parse(readFileSync(childReport,'utf8'));
   if(observed.version!==1||observed.engine!=='node'||observed.complete!==true||!Array.isArray(observed.summaries))throw Error('Incomplete child execution report');
   summaries.push(...observed.summaries);
  }catch{failed=true;}
 }
 if(result.status!==0)failed=true;
}
if(reportPath)writeFileSync(reportPath,JSON.stringify({version:1,engine:'node',complete:!failed,summaries})+'\n');
return failed?1:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runNodeTests();
