// Pure unit tests: planner and config values only; no filesystem or subprocess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
async function planner() {
 const module = await import('./coverage-unit-plan.mjs').catch(() => ({}));
 assert.equal(typeof module.planUnitPartitions,'function');
 return module;
}
test('explicit unit files retain every production partition including empty ones',async()=>{
 const {planUnitPartitions}=await planner();
 const result=planUnitPartitions(['tests/test_logic.py','apps/web/src/a.test.ts','apps/web/scripts/a.test.mjs']);
 assert.equal(Object.keys(result.partitions).length,11);
 assert.deepEqual(result.partitions.web,['apps/web/src/a.test.ts']);
 assert.deepEqual(result.partitions['node-tools'],['apps/web/scripts/a.test.mjs']);
 assert.deepEqual(result.partitions.contracts,[]);
 assert.deepEqual(result.pythonFiles,['tests/test_logic.py']);
});
for(const files of [[],['apps/web/src'],['../x.test.ts'],['unknown/x.test.ts'],['apps/web/src/a.test.ts','apps/web/src/a.test.ts']])
test('invalid or ambiguous selection fails closed '+JSON.stringify(files),async()=>{
 const {planUnitPartitions}=await planner();assert.throws(()=>planUnitPartitions(files));
});
test('planner maps exact supported runner boundaries without substring matching',async()=>{
 const {planUnitPartitions}=await planner();
 const result=planUnitPartitions(['packages/contracts/src/a.test.ts','packages/domain/src/b.spec.ts','packages/web-transport/src/c.test.ts','apps/bff/test/d.test.ts','frontend/src/e.test.tsx','frontend/scripts/f.test.mjs','scripts/tests/deployment/a.test.ts','scripts/tests/quality/a.test.ts','scripts/tests/quality/config-node.test.mjs']);
 assert.equal(Object.values(result.partitions).flat().length,9);
 assert.deepEqual(result.partitions['quality-configs'],['scripts/tests/quality/config-node.test.mjs']);
});
test('Vitest exact include replacement keeps all production coverage settings even empty',async()=>{
 const {unitVitestConfig}=await planner();
 const base={test:{include:['**/*.test.ts'],setupFiles:['setup.ts'],coverage:{include:['src/**/*.ts'],exclude:['**/*.test.ts']}}};
 const next=unitVitestConfig(base,[]);
 assert.deepEqual(next.test.include,[]);
 assert.equal(next.test.passWithNoTests,true);
 assert.deepEqual(next.test.coverage,base.test.coverage);
 assert.deepEqual(base.test.include,['**/*.test.ts']);
 assert.deepEqual(unitVitestConfig(base,['src/a.test.ts']).test.include,['src/a.test.ts']);
});
