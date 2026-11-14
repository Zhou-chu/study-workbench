import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {fileURLToPath} from 'node:url';
// Run existing node:test suites in their original cwd; propagate c8's child environment.
export function runNodeTests(root=process.cwd(),args=process.argv.slice(2)) {
const explicitArgs=args.filter(arg=>arg.startsWith('--files-json='));
if(args.includes('--files-json') || explicitArgs.length>1)throw Error('Duplicate explicit Node selection');
const explicit=explicitArgs.length?JSON.parse(explicitArgs[0].slice('--files-json='.length)):null;
const directories=args.includes('--legacy')?['frontend']:['apps/bff','apps/web'];
if(explicitArgs.length && (!Array.isArray(explicit)||new Set(explicit).size!==explicit.length||explicit.some(file=>
 typeof file!=='string'||!directories.some(directory=>file.startsWith(directory+'/scripts/')&&
 /^[A-Za-z0-9_.-]+\.test\.mjs$/.test(file.slice((directory+'/scripts/').length))))))
 throw Error('Invalid explicit Node test file');
let failed=false;
for(const directory of directories){
 const files=explicit!==null?explicit.filter(file=>file.startsWith(directory+'/')).map(file=>file.slice(directory.length+1)):readdirSync(resolve(root,directory,'scripts')).filter(file=>file.endsWith('.test.mjs')).map(file=>'scripts/'+file);
 if(explicit!==null && !files.length)continue;
 const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{cwd:resolve(root,directory),stdio:'inherit',env:process.env});
 if(result.status!==0)failed=true;
}
return failed?1:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runNodeTests();
