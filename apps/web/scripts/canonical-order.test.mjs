import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical, digest as spaDigest} from '../../../scripts/v1/spa-artifact-common.mjs';
import {digest as legacyDigest} from '../../../frontend/scripts/artifact-identity.mjs';
// Fixed historical UTF-16 ordering, not locale/collation or numeric ordering.
const orderedKeys=['01','10x','2x','A','Z','a','e\u0301','é','中','😀','\uE000'];
const source=Object.fromEntries([...orderedKeys].reverse().map(key=>[key,1]));
const expectedObject=Object.fromEntries(orderedKeys.map(key=>[key,1]));
const expected=JSON.stringify(expectedObject);
const sha=value=>createHash('sha256').update(value).digest('hex');
test('artifact canonical hashes preserve historical UTF-16 key ordering without normalization',()=>{
 assert.equal(canonical(source),expected);
 assert.equal(spaDigest(source),sha(expected));
 assert.equal(legacyDigest(source),sha(expected));
 assert.equal(spaDigest(expectedObject),spaDigest(source));
 assert.equal(legacyDigest(expectedObject),legacyDigest(source));
 assert.notEqual(spaDigest({'é':1}),spaDigest({'e\u0301':1}));
 assert.notEqual(legacyDigest({'é':1}),legacyDigest({'e\u0301':1}));
});
test('canonicalization recursively sorts objects but preserves array order and caller input',()=>{
 const value={z:[source,3,2,10],a:{nested:source}};
 const before=JSON.stringify(value);
 const serialized=JSON.stringify({a:{nested:expectedObject},z:[expectedObject,3,2,10]});
 assert.equal(canonical(value),serialized);
 assert.equal(spaDigest(value),sha(serialized));
 assert.equal(legacyDigest(value),sha(serialized));
 assert.equal(JSON.stringify(value),before);
 assert.notEqual(spaDigest([2,10]),spaDigest([10,2]));
 assert.notEqual(legacyDigest([2,10]),legacyDigest([10,2]));
});
test('integer property enumeration remains JSON-compatible, including empty containers and primitives',()=>{
 const value={'10':'ten','2':'two','01':'leading',empty:{},array:[],nil:null,flag:false};
 const expected='{"2":"two","10":"ten","01":"leading","array":[],"empty":{},"flag":false,"nil":null}';
 assert.equal(canonical(value),expected);
 assert.equal(spaDigest(value),sha(expected));
 assert.equal(legacyDigest(value),sha(expected));
});
