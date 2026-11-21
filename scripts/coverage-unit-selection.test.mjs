// Tool integration: real owned fixture repositories, trusted Git reads and Python.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function api(root) {
  const module = await import(pathToFileURL(join(root, 'scripts/coverage-unit-selection.mjs')).href);
  assert.equal(typeof module.createUnitSelection, 'function', 'trusted selector must exist');
  return module;
}
function fixture(t, layer = 'unit') {
  const root = mkdtempSync(join(tmpdir(), 'notebook-unit-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['tests', 'api', 'scripts/quality']) mkdirSync(join(root, dir), {recursive:true});
  writeFileSync(join(root,'api/a.py'), 'value = 1\n');
  const bytes = 'def test_a(): assert True\n';
  writeFileSync(join(root,'tests/test_a.py'), bytes);
  writeFileSync(join(root,'scripts/quality/test-layers.json'), JSON.stringify({version:1, entries:[
    {path:'tests/test_a.py',layer,targets:['api/a.py'],reason:'Synthetic direct function fixture.',
     sha256:createHash('sha256').update(bytes).digest('hex')}
  ]}));
  const git = (...args) => execFileSync('/usr/bin/git', args, {
    cwd:root, env:{PATH:'/usr/bin:/bin', HOME:root, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null'},
    stdio:['ignore','pipe','pipe'], encoding:'utf8'
  });
  for (const file of ['scripts/coverage-unit-selection.mjs', 'scripts/coverage-trusted-git.mjs', 'scripts/quality/test_layers.py']) {
    copyFileSync(new URL('../' + file, import.meta.url), join(root, file));
  }
  git('init'); git('add','.');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
  return {root,git};
}
test('trusted selector binds real clean tracked inventory and runner recaptures it', async t => {
  const {root,git} = fixture(t);
  const module = await api(root);
  const artifact = module.createUnitSelection(root);
  assert.equal(artifact.revision, git('rev-parse','HEAD').trim());
  assert.deepEqual(artifact.inventory,['api/a.py','scripts/coverage-trusted-git.mjs','scripts/coverage-unit-selection.mjs','scripts/quality/test-layers.json','scripts/quality/test_layers.py','tests/test_a.py']);
  assert.deepEqual(module.validateCurrentUnitSelection(root,artifact),['tests/test_a.py']);
  artifact.unitFiles = ['tests'];
  assert.throws(() => module.validateCurrentUnitSelection(root,artifact), /selection|match/i);
});
test('untracked files invalidate the complete current inventory before execution', async t => {
  const {root} = fixture(t);
  const module = await api(root);
  const artifact = module.createUnitSelection(root);
  writeFileSync(join(root,'tests/test_hidden.py'),'def test_hidden(): pass\n');
  assert.throws(() => module.validateCurrentUnitSelection(root,artifact), /clean/i);
});
test('tracked source changes invalidate clean snapshot before execution', async t => {
  const {root} = fixture(t);
  const module = await api(root);
  const artifact = module.createUnitSelection(root);
  writeFileSync(join(root,'api/a.py'),'value = 2\n');
  assert.throws(() => module.validateCurrentUnitSelection(root,artifact), /clean/i);
});
for (const layer of ['mixed','unclassified']) test(layer+' classification never emits a selection', async t => {
  const {root} = fixture(t,layer);
  const module = await api(root);
  assert.throws(() => module.createUnitSelection(root), /unresolved/i);
});

test('committed source/revision changes reject an old otherwise valid artifact', async t => {
  const {root,git} = fixture(t);
  const module = await api(root);
  const artifact = module.createUnitSelection(root);
  writeFileSync(join(root,'api/a.py'),'value = 2\n');
  git('add','api/a.py');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','new source');
  assert.throws(() => module.validateCurrentUnitSelection(root,artifact), /match/i);
});

for (const variant of ['missing', 'different']) test('selector A rejects repository B with '+variant+' policy', async t => {
  const a = fixture(t);
  const b = fixture(t);
  const moduleA = await api(a.root);
  if (variant === 'missing') unlinkSync(join(b.root,'scripts/quality/test_layers.py'));
  else writeFileSync(join(b.root,'scripts/quality/test_layers.py'),'raise RuntimeError("Different policy")\n');
  b.git('add','.');
  b.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','alter policy');
  assert.throws(() => moduleA.createUnitSelection(b.root), /producer|ownership|belongs/i);
});
test('runner A rejects repository B even when B artifact and policy are valid', async t => {
  const a = fixture(t);
  const b = fixture(t);
  const moduleA = await api(a.root);
  const moduleB = await api(b.root);
  const artifact = moduleB.createUnitSelection(b.root);
  assert.throws(() => moduleA.validateCurrentUnitSelection(b.root,artifact), /producer|ownership|belongs/i);
});
test('tracked __proto__ filename remains an own hashed inventory entry', async t => {
  const {root,git} = fixture(t);
  writeFileSync(join(root,'__proto__'),'ordinary tracked source input');
  git('add','__proto__');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','special name');
  const module = await api(root);
  const artifact = module.createUnitSelection(root);
  assert.equal(Object.hasOwn(artifact.fileHashes,'__proto__'),true);
  assert.equal(artifact.fileHashes.__proto__,createHash('sha256').update('ordinary tracked source input').digest('hex'));
  assert.deepEqual(module.validateCurrentUnitSelection(root,artifact),['tests/test_a.py']);
});
for (const producer of ['scripts/coverage-unit-selection.mjs','scripts/coverage-trusted-git.mjs','scripts/quality/test_layers.py']) test('loaded producer identity rejects changed '+producer, async t => {
  const {root,git} = fixture(t);
  const module = await api(root);
  const artifact = module.createUnitSelection(root);
  writeFileSync(join(root,producer),'# Changed producer identity\n');
  git('add','.');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','change producer');
  assert.throws(() => module.createUnitSelection(root), /producer|identity/i);
  assert.throws(() => module.validateCurrentUnitSelection(root,artifact), /producer|identity/i);
});
