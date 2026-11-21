import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {beginBuild,rebuildPackages,runNode,ROOT,verifyArtifact,stageGateway} from '../../../scripts/v1/spa-artifact-common.mjs';
export async function buildWeb(slot){
 const build=await beginBuild('web',slot);
 await rebuildPackages('web');
 runNode([path.join(ROOT,'node_modules/typescript/bin/tsc'),'--noEmit'],build.app);
 runNode([path.join(build.app,'scripts/prepare-pdf-assets.mjs')],ROOT);
 runNode([path.join(ROOT,'node_modules/vite/bin/vite.js'),'build','--outDir',build.candidate],build.app,{SPA_ARTIFACT_IDENTITY:JSON.stringify(build.identity)});
 return build.finish();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,target,...retained]=process.argv.slice(2);
 if(mode==='--verify')await verifyArtifact(path.resolve(target),{kind:'web',contract:path.join(ROOT,'contracts/v1/openapi.json'),source:true});
 else if(mode==='--stage-gateway')await stageGateway(path.resolve(target),retained.map(p=>path.resolve(p)));
 else if(mode===undefined||mode==='--build')await buildWeb(target);
 else throw Error('Usage: --build [slot] | --verify dist | --stage-gateway fresh-output current-dist [retained-dist ...]');
 console.log('Web source/artifact file gate PASS; runtime and served bytes NOT_RUN');
}
