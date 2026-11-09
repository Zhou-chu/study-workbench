import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const common=await import('../../../scripts/v1/spa-artifact-common.mjs').catch(()=>({}));
test('standalone BFF closure accepts measured ESM package and local modules only',async()=>{
 assert.equal(typeof common.verifyBffClosure,'function');
 const root=await mkdtemp(path.join(tmpdir(),'c1-bff-'));
 try {
  await writeFile(path.join(root,'package.json'),'{"type":"module","private":true}');
  await writeFile(path.join(root,'cli.js'),"import './server.js';");
  await writeFile(path.join(root,'server.js'),"import {createServer} from 'node:http'; export {createServer};");
  await common.verifyBffClosure(root);
  for(const source of ["import React from 'react';","import next from 'next';","import '../outside.js';","const x = import('next');","const x = require('next');","const x = import /* hidden */ ('next');","export {x} from 'next';","import 'node:child_process';"]){
   await writeFile(path.join(root,'server.js'),source);
   await assert.rejects(common.verifyBffClosure(root),/closure|import|dependency/i);
  }
  await mkdir(path.join(root,'node_modules')); await writeFile(path.join(root,'node_modules/secret.js'),'export default 1');
  await assert.rejects(common.verifyBffClosure(root),/private|closure|dependency/i);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('parses actual emitted ESM without confusing import route literals or executing code',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'c1-bff-syntax-'));
 try{
  await writeFile(path.join(root,'package.json'),'{"type":"module","private":true}');
  await writeFile(path.join(root,'cli.js'),"import './server.js'; throw Error('must-not-execute');");
  await writeFile(path.join(root,'server.js'),"import /* static */ // trivia\n{AsyncLocalStorage} from 'node:async_hooks';\nconst routes=[['POST','/import'],\n ['GET','/x']];\nexport {AsyncLocalStorage};");
  await common.verifyBffClosure(root);
 }finally{await rm(root,{recursive:true,force:true});}
});

const loaderCases=["const later = import // ordinary line comment\n('next');", "const later = import /* first */ // second\r\n /* third */ ('react');", "const later = import // line\u2028('next');", "const later = import // line\u2029('next');", "const later = import \ufeff /* space */ ('next');", "const later = `template ${import // line\n('next')}`;", "const later = require // line\n('next');", "const later = require /* comment */ ('next');", "const load = r\\u0065quire; load('next');", "const load = \\u{72}equire; load('next');", "const later = require?.('next');", "const later = (require)('next');", "const later = module.require // line\n('next');", "const later = eval // line\n('1');", "const later = (0,eval)('1');", "const later = e\\u0076al /* comment */ ('1');", "const later = Function // line\n('return 1')();", "const later = new Function /* comment */ ('return 1');", "const later = globalThis['Function']('return 1');", "const later = createRequire // line\n(import.meta.url)('next');", "importScripts // line\n('next');"];

for(const source of loaderCases)test('fix1 I3 rejects comment/escape/indirect loader '+JSON.stringify(source),async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'c1-loader-'));
 try{
  await writeFile(path.join(root,'package.json'),'{"type":"module","private":true}');
  await writeFile(path.join(root,'cli.js'),"import './server.js'; throw Error('must-not-execute');");
  await writeFile(path.join(root,'server.js'),source);
  await assert.rejects(common.verifyBffClosure(root),/closure|dependency/);
 }finally{await rm(root,{recursive:true,force:true});}
});
