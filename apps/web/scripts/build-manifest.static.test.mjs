import test from 'node:test';
import assert from 'node:assert/strict';
const common = await import('../../../scripts/v1/spa-artifact-common.mjs').catch(()=>({}));
const artifact = await import('./build-manifest.mjs').catch(()=>({}));

test('Web manifest producer and verifier are independent callable file gates',()=>{
 assert.equal(typeof artifact.buildWeb,'function'); assert.equal(typeof common.verifyArtifact,'function');
});
