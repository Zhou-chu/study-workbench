import { auditRepositoryScope } from './coverage-scope.mjs';
import { inputDigest, fileDigest } from './coverage-integrity.mjs';
import { assessCoverage } from './coverage-policy.mjs';
import { readFileSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {sourceDigest} from './coverage-inventory.mjs';
export function runGate(root=fileURLToPath(new URL('../',import.meta.url))) {
const partitions={contracts:'packages/contracts',domain:'packages/domain','web-transport':'packages/web-transport',bff:'apps/bff',web:'apps/web','legacy-web':'frontend','node-tools':null,'legacy-node-tools':null,'deployment-config':'.','quality-tooling':'.','quality-configs':null};
const scope=auditRepositoryScope(root);
let failed=scope.unmeasured.length>0;
if(failed)console.error('Unmeasured first-party executable paths: ',scope.unmeasured);
for(const [name,directory] of Object.entries(partitions)){
 const path=resolve(root,'coverage','run-'+name+'.json');
 let row=null;
 try {row=existsSync(path)?JSON.parse(readFileSync(path,'utf8')).partitions.find(row=>row.partition===name):null;}catch{ /* malformed manifests fail closed */ }
 const report=resolve(root,'coverage',name,'coverage-summary.json');
 let reportHash;
 try{reportHash=fileDigest(report);if(row)row.coverage=JSON.parse(readFileSync(report,'utf8')).total;}catch{reportHash=undefined;}
 const reasons=assessCoverage(row,sourceDigest(root,name,directory),inputDigest(root),reportHash);
 if(reasons.length){failed=true;console.error(name+': FAIL: '+reasons.join('; '));}else console.log(name+': PASS all four raw ratios >90%');
}
console.log('This gate covers JS/TS partitions only, not Python/shell or whole-project completion.');
return failed?1:0;

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runGate();
