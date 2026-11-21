import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,dirname,basename} from 'node:path';
import {readFileSync} from 'node:fs';
async function loadConfig(source){
 const outfile=resolve(source===resolve('frontend/vitest.config.ts')?'frontend/coverage/quality-config-runtime':'coverage/quality-config-runtime',basename(source)+'.cjs');
 await build({entryPoints:[source],bundle:true,packages:'external',platform:'node',format:'cjs',outfile,sourcemap:'inline',sourcesContent:true,
 define:{__dirname:JSON.stringify(dirname(source)),'import.meta.url':JSON.stringify(pathToFileURL(source).href)}});
 // Verify esbuild's untouched inline source map resolves to the real source bytes.
 const output=readFileSync(outfile,'utf8');
 const encoded=/sourceMappingURL=data:application\/json;base64,([^\s]+)/.exec(output)?.[1];
 assert.ok(encoded,'inline source map is required for official c8 remapping');
 const map=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
 const sourceIndex=map.sources.findIndex(file=>resolve(dirname(outfile),map.sourceRoot||'',file)===source);
 assert.ok(sourceIndex>=0,'source map must identify the original configuration path');
 assert.equal(map.sourcesContent[sourceIndex],readFileSync(source,'utf8'));
 const require=createRequire(import.meta.url);delete require.cache[outfile];
 return {config:require(outfile).default};
}
test('official esbuild/Node loader evaluates tooling and legacy test configuration without starting servers',async()=>{
 const legacy=await loadConfig(resolve('frontend/vitest.config.ts'));
 assert.equal(legacy.config.test.environment,'jsdom');assert.equal(legacy.config.css.postcss.plugins.length,0);
 const quality=await loadConfig(resolve('scripts/coverage-quality.config.ts'));
 assert.equal(quality.config.test.maxWorkers,1);assert.ok(quality.config.test.coverage.include.includes('scripts/coverage-workspaces.mjs'));
});
test('official esbuild/Node loader preserves absent and explicit artifact identity',async()=>{
 const previous=process.env.SPA_ARTIFACT_IDENTITY;
 try{
  delete process.env.SPA_ARTIFACT_IDENTITY;
  let loaded=await loadConfig(resolve('apps/web/vite.config.ts'));assert.equal(loaded.config.base,'/');
  process.env.SPA_ARTIFACT_IDENTITY='{"release_slot":"unit-test"}';
  loaded=await loadConfig(resolve('apps/web/vite.config.ts'));assert.equal(loaded.config.base,'/_spa/releases/unit-test/');
  process.env.SPA_ARTIFACT_IDENTITY='';
  loaded=await loadConfig(resolve('apps/web/vite.config.ts'));assert.equal(loaded.config.base,'/');
  process.env.SPA_ARTIFACT_IDENTITY='{invalid';
  await assert.rejects(loadConfig(resolve('apps/web/vite.config.ts')),SyntaxError);
 }finally{if(previous===undefined)delete process.env.SPA_ARTIFACT_IDENTITY;else process.env.SPA_ARTIFACT_IDENTITY=previous;}
});
