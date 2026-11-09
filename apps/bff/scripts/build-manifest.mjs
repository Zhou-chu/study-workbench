import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {beginBuild,rebuildPackages,runNode,ROOT,verifyArtifact,canonical} from '../../../scripts/v1/spa-artifact-common.mjs';
export async function buildBff(slot){
 const build=await beginBuild('bff',slot);
 await rebuildPackages('bff');
 runNode([path.join(ROOT,'node_modules/typescript/bin/tsc'),'--project','tsconfig.build.json','--outDir',build.candidate,'--sourceMap','false','--declaration','false'],build.app);
 await writeFile(path.join(build.candidate,'package.json'),canonical({type:'module',private:true})+'\n',{flag:'wx'});
 return build.finish();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,target]=process.argv.slice(2);
 if(mode==='--verify')await verifyArtifact(path.resolve(target),{kind:'bff',contract:path.join(ROOT,'contracts/v1/openapi.json')});
 else if(mode===undefined||mode==='--build')await buildBff(target);
 else throw Error('Usage: --build [slot] | --verify dist');
 console.log('BFF source/artifact file gate PASS; listener/runtime NOT_RUN');
}
