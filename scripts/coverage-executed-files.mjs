/** Compare runner-native completed test entrypoints, never the requested list alone. */
import {isAbsolute,relative,resolve} from 'node:path';
import { compareCoverageKeys } from './coverage-inventory.mjs';
function local(root,file){
 if(typeof file!=='string'||!isAbsolute(file))throw Error('Execution file must be absolute');
 const path=relative(resolve(root),resolve(file)).replaceAll('\\','/');
 if(!path||path==='..'||path.startsWith('../')||isAbsolute(path))throw Error('Execution file outside repository');
 return path;
}
export function auditExecutedFiles(root,selected,report,engine){
 if(!Array.isArray(selected)||new Set(selected).size!==selected.length)throw Error('Invalid selected files');
 let actual;
 if(engine==='vitest'){
  if(!report||report.success!==true||!Array.isArray(report.testResults))throw Error('Missing/failed Vitest execution evidence');
  actual=report.testResults.map(row=>{
   if(!row||row.status!=='passed'||!Array.isArray(row.assertionResults)||
    !row.assertionResults.every(test=>test && ['passed','skipped','todo'].includes(test.status))||
    !row.assertionResults.some(test=>test.status==='passed'))throw Error('Test entrypoint did not execute passing assertions');
   return local(root,row.name);
  });
 }else if(engine==='node'){
  if(!report||report.version!==1||report.engine!=='node'||report.complete!==true||!Array.isArray(report.summaries))
   throw Error('Missing/incomplete Node execution evidence');
  actual=report.summaries.map(row=>{
   const counts=row?.counts;
   const fields=['tests','passed','failed','cancelled','skipped','todo','topLevel','suites'];
   if(!row||row.success!==true||!counts||
    !fields.every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0)||
    counts.passed<1||counts.failed!==0||counts.cancelled!==0||
    counts.tests!==counts.passed+counts.failed+counts.cancelled+counts.skipped+counts.todo||
    counts.topLevel<1||counts.topLevel>counts.tests+counts.suites)
    throw Error('Node entrypoint has inconsistent counts or did not complete passing tests');
   return local(root,row.file);
  });
 }else throw Error('Unsupported execution evidence engine');
 if(new Set(actual).size!==actual.length)throw Error('Duplicate executed entrypoint');
 actual.sort(compareCoverageKeys);
 if(JSON.stringify(actual)!==JSON.stringify([...selected].sort(compareCoverageKeys)))throw Error('Executed files do not match explicit selection');
 return actual;
}
