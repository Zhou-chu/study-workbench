import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import {auditRepositoryScope} from './coverage-scope.mjs';
export function runScopeCheck(root=fileURLToPath(new URL('../',import.meta.url))) {
const audit=auditRepositoryScope(root);
const syntaxFailures=[];
for(const path of audit.configuration){
 const source=ts.createSourceFile(path,readFileSync(resolve(root,path),'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
 if(source.parseDiagnostics.length)syntaxFailures.push({path,diagnostics:source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '))});
}
mkdirSync(resolve(root,'coverage'),{recursive:true});
writeFileSync(resolve(root,'coverage','scope-audit.json'),JSON.stringify({...audit,configurationSyntaxFailures:syntaxFailures},null,2)+'\n');
console.log(JSON.stringify({unmeasured:audit.unmeasured,configurationSyntaxChecked:audit.configuration,syntaxFailures},null,2));
return audit.unmeasured.length||syntaxFailures.length?1:0;

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runScopeCheck();
