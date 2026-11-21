import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventory, sourceDigest, qualityToolingFiles, qualityConfigFiles} from './coverage-inventory.mjs';
test('inventory preserves UTF-16 order, not numeric or locale collation', () => {
 const root=mkdtempSync(join(tmpdir(),'inventory-order-'));
 try {
  const names=['z','Z','2','10','é','e','e\u0301','中','𐀀',''];
  mkdirSync(join(root,'apps/web/src'),{recursive:true});
  mkdirSync(join(root,'scripts'));
  for(const name of names){
   writeFileSync(join(root,'apps/web/src',name+'.ts'),name);
   writeFileSync(join(root,'scripts','coverage-'+name+'.mjs'),'');
  }
  const order=['10','2','Z','e','e\u0301','z','é','中','𐀀',''];
  const sourcePaths=names.map(n=>join(root,'apps/web/src',n+'.ts'));
  assert.equal(JSON.stringify(inventory(root,'web','apps/web')),JSON.stringify(sourcePaths.sort()));
  assert.deepEqual(inventory(root,'web','apps/web'),order.map(n=>join(root,'apps/web/src',n+'.ts')));
  const defaultDigest=createHash('sha256');
  for(const name of names.slice().sort())defaultDigest.update('apps/web/src/'+name+'.ts').update(name);
  assert.equal(sourceDigest(root,'web','apps/web'),defaultDigest.digest('hex'));
  const helperPaths=names.map(n=>join(root,'scripts','coverage-'+n+'.mjs'));
  assert.equal(JSON.stringify(qualityToolingFiles(root)),JSON.stringify(helperPaths.sort()));
  assert.deepEqual(qualityToolingFiles(root),order.map(n=>join(root,'scripts','coverage-'+n+'.mjs')));
  assert.deepEqual(qualityConfigFiles(root),['apps/web/vite.config.ts','frontend/vitest.config.ts','scripts/coverage-quality.config.ts'].map(n=>join(root,n)));
  assert.deepEqual(inventory(root,'deployment-config','.'),['examples/easypanel/index.ts','frontend/next.config.ts'].map(n=>join(root,n)));
 } finally {rmSync(root,{recursive:true,force:true});}
});
