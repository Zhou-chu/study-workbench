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
  for(const source of ["import React from 'react';","import next from 'next';","import '../outside.js';","const x = import('next');","const x = require('next');"]){
   await writeFile(path.join(root,'server.js'),source);
   await assert.rejects(common.verifyBffClosure(root),/closure|import|dependency/i);
  }
  await mkdir(path.join(root,'node_modules')); await writeFile(path.join(root,'node_modules/secret.js'),'export default 1');
  await assert.rejects(common.verifyBffClosure(root),/private|closure|dependency/i);
 } finally {await rm(root,{recursive:true,force:true});}
});
