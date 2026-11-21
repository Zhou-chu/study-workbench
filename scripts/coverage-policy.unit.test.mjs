import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCoverage } from './coverage-policy.mjs';
const assess=(row,digest)=>assessCoverage(row,digest,'inputs','report');
const row=(covered,total)=>({phase:'complete',inputDigest:'inputs',reportHash:'report',testExitCode:0,sourceDigest:'fresh',audit:{missing:[],unexpected:[]},coverage:Object.fromEntries(['statements','branches','functions','lines'].map(key=>[key,{covered,total}]))});
test('strict >90 uses raw counts, never rounded percentages or pass rates',()=>{
 assert.equal(assess(row(90,100),'fresh').length,4);
 assert.equal(assess(row(90001,100000),'fresh').length,0);
 assert.equal(assess(row(0,0),'fresh').length,4);
 assert.ok(assess({...row(100,100),testExitCode:1},'fresh').length);
 assert.ok(assess(row(100,100),'changed').length);
 for(const [covered,total] of [[undefined,100],[NaN,100],[100,NaN],[101,100],[1.5,2],[-1,100]])assert.ok(assess(row(covered,total),'fresh').length);
 assert.ok(assess({...row(100,100),audit:{missing:[],unexpected:['extra.js']}},'fresh').length);
 assert.ok(assess({...row(100,100),audit:{missing:['unimported.ts'],unexpected:[]}},'fresh').length);
});
