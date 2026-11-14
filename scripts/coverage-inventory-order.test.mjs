import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventory, qualityToolingFiles, qualityConfigFiles} from './coverage-inventory.mjs';
test('inventory preserves UTF-16 order, not numeric or locale collation', () => {
 const root=mkdtempSync(join(tmpdir(),'inventory-order-'));
 try {
  const names=['z','Z','2','10','é','e','中','𐀀',''];
  mkdirSync(join(root,'apps/web/src'),{recursive:true});
  mkdirSync(join(root,'scripts'));
  for(const name of names){
   writeFileSync(join(root,'apps/web/src',name+'.ts'),'');
   writeFileSync(join(root,'scripts','coverage-'+name+'.mjs'),'');
  }
  const order=['10','2','Z','e','z','é','中','𐀀',''];
  assert.deepEqual(inventory(root,'web','apps/web'),order.map(n=>join(root,'apps/web/src',n+'.ts')));
  assert.deepEqual(qualityToolingFiles(root),order.map(n=>join(root,'scripts','coverage-'+n+'.mjs')));
  assert.deepEqual(qualityConfigFiles(root),['apps/web/vite.config.ts','frontend/vitest.config.ts','scripts/coverage-quality.config.ts'].map(n=>join(root,n)));
  assert.deepEqual(inventory(root,'deployment-config','.'),['examples/easypanel/index.ts','frontend/next.config.ts'].map(n=>join(root,n)));
 } finally {rmSync(root,{recursive:true,force:true});}
});
