import { beginRun, saveManifest, inputDigest, fileDigest } from './coverage-integrity.mjs';
import { coverageEnvironment } from './coverage-environment.mjs';
import { tmpdir } from 'node:os';
import { recordedRun } from './coverage-process.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve,relative } from 'node:path';
import { auditReport, sourceDigest, inventory } from './coverage-inventory.mjs';
export function runCoverage(root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2)) {
const partitions={contracts:'packages/contracts',domain:'packages/domain','web-transport':'packages/web-transport',bff:'apps/bff',web:'apps/web','legacy-web':'frontend','node-tools':null,'legacy-node-tools':null,'deployment-config':'.','quality-tooling':'.','quality-configs':null};
const onlyArg=args.find(arg=>arg.startsWith('--only='));
const only=onlyArg?.slice(7);
if(onlyArg&&!Object.hasOwn(partitions,only))throw new Error('Unknown/empty coverage partition: '+only);
const temporary=mkdtempSync(resolve(tmpdir(),'notebook-coverage-'));
const environment=coverageEnvironment(temporary,process.env);
const cleanup=()=>rmSync(temporary,{recursive:true,force:true});
process.on('exit',cleanup);
try {
const run=(command,args,cwd=root,label='pretest')=>{
 const logPath=resolve(root,'coverage/diagnostics',label+'.log');
 const status=recordedRun(command,args,{cwd,env:environment,logPath});
 console.log(label+': exit '+status+'; log '+logPath);return status;
};
const npm=process.platform==='win32'?'npm.cmd':'npm';
const names=Object.keys(partitions).filter(name=>!only||name===only);
const initialDigest=inputDigest(root);
beginRun(root,names,initialDigest);
if(run(npm,['run','pretest'])!==0){for(const name of names)saveManifest(root,name,{partition:name,phase:'failed',testExitCode:1,inputDigest:initialDigest,blocked:'pretest failed'});return 1;}
const results=[];
for(const [name,directory] of Object.entries(partitions)){
 if(only&&name!==only)continue;
 const before=sourceDigest(root,name,directory);
 const inputs=inputDigest(root);
 saveManifest(root,name,{partition:name,phase:'pending',testExitCode:null,inputDigest:inputs});
 const summary=resolve(root,'coverage',name,'coverage-summary.json');
 rmSync(summary,{force:true}); // Never accept a previous run's report after startup failure.
 let status,blocked;
 if(name==='legacy-web'&&!existsSync(resolve(root,'frontend/node_modules/next/package.json'))){
  status=1;blocked='Legacy dependencies missing; no automatic installation.';
 }else if(name==='quality-configs'){
  const flags=['--all','--extension=.ts','--extension=.cjs','--src=apps/web','--src=frontend','--src=scripts','--include=apps/web/vite.config.ts','--include=frontend/vitest.config.ts','--include=scripts/coverage-quality.config.ts','--include=coverage/quality-config-runtime/*.cjs','--include=frontend/coverage/quality-config-runtime/*.cjs','--exclude-after-remap'];
  status=run(process.execPath,[resolve(root,'node_modules/c8/bin/c8.js'),...flags,'--reporter=text','--reporter=json','--reporter=json-summary','--reporter=lcov','--reports-dir=coverage/'+name,process.execPath,'--enable-source-maps','--test','--test-concurrency=1','scripts/tests/quality/config-node.test.mjs'],root,name);
 }else if(directory){
  const binary=name==='legacy-web'?'frontend/node_modules/vitest/vitest.mjs':'node_modules/vitest/vitest.mjs';
  status=run(process.execPath,[resolve(root,binary),'run','--config',name==='quality-tooling'?'scripts/coverage-quality.config.ts':name==='deployment-config'?'scripts/coverage-deployment.config.ts':'coverage.config.ts','--maxWorkers=1'],resolve(root,directory),name);
 }else{
  const legacy=name==='legacy-node-tools';
  const inputs=legacy?['--src=frontend','--include=frontend/scripts/**/*.{js,mjs}','--include=frontend/start-server.js']:['--src=apps/bff/scripts','--src=apps/web/scripts','--src=scripts/v1','--src=apps/web/public','--include=apps/web/public/theme-bootstrap.js','--include=apps/bff/scripts/**/*.{js,mjs}','--include=apps/web/scripts/**/*.{js,mjs}','--include=scripts/v1/**/*.{js,mjs}'];
  status=run(process.execPath,[resolve(root,'node_modules/c8/bin/c8.js'),'--all','--extension=.mjs','--extension=.js',...inputs,'--exclude=**/*.test.mjs','--reporter=text','--reporter=json','--reporter=json-summary','--reporter=lcov','--reports-dir=coverage/'+name,process.execPath,'scripts/coverage-node-tests.mjs',...(legacy?['--legacy']:[])],root,name);
 }
 const row={partition:name,phase:'complete',inputDigest:inputs,inputChangedDuringRun:inputs!==inputDigest(root),testExitCode:status,...(blocked?{blocked}:{}),sourceDigest:before,sourceChangedDuringRun:before!==sourceDigest(root,name,directory),audit:{expectedSourceFiles:inventory(root,name,directory).length,reportedSourceFiles:0,missing:inventory(root,name,directory).map(file=>relative(root,file)),unexpected:[]}};
 if(existsSync(summary)){try{row.audit=auditReport(root,name,directory);row.reportHash=fileDigest(summary);row.coverage=JSON.parse(readFileSync(summary,'utf8')).total;}catch(error){row.phase='failed';row.testExitCode=1;row.blocked='Invalid coverage summary: '+String(error);}}
 else {row.missingReport=true;row.audit=auditReport(root,name,directory);}
 results.push(row);
 // Save each completed partition immediately, even if a later long run is interrupted.
 mkdirSync(resolve(root,'coverage'),{recursive:true});
 saveManifest(root,name,row);
}
if(!only)writeFileSync(resolve(root,'coverage','run-all.json'),JSON.stringify({generatedAt:new Date().toISOString(),partitions:results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
return results.some(row=>row.testExitCode!==0||row.missingReport||row.sourceChangedDuringRun||row.inputChangedDuringRun||row.audit.missing.length||row.audit.unexpected.length)?1:0;

} finally {process.removeListener('exit',cleanup);cleanup();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runCoverage();
