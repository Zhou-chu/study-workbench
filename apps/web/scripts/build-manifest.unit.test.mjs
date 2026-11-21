import test from 'node:test';
import assert from 'node:assert/strict';
const common = await import('../../../scripts/v1/spa-artifact-common.mjs').catch(()=>({}));

test('canonical inventory digest measures sizes, modes, bytes and sorted paths',()=>{
 assert.equal(typeof common.digest,'function');
 assert.equal(common.digest({b:2,a:1}),common.digest({a:1,b:2}));
 assert.notEqual(common.digest([{path:'a',size:1,mode:'0644',sha256:'a'}]),common.digest([{path:'a',size:1,mode:'0755',sha256:'a'}]));
});
