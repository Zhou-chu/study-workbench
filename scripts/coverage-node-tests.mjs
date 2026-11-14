import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {fileURLToPath} from 'node:url';
// Run existing node:test suites in their original cwd; propagate c8's child environment.
export function runNodeTests(root=process.cwd(),args=process.argv.slice(2)) {
let failed=false;
for(const directory of args.includes('--legacy')?['frontend']:['apps/bff','apps/web']){
 const files=readdirSync(resolve(root,directory,'scripts')).filter(file=>file.endsWith('.test.mjs')).map(file=>'scripts/'+file);
 const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{cwd:resolve(root,directory),stdio:'inherit',env:process.env});
 if(result.status!==0)failed=true;
}
return failed?1:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runNodeTests();
