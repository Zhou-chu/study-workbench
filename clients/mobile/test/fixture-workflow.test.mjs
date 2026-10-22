import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../src/', import.meta.url);
// Guard import-time and execution-time network access.
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
  Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('Network forbidden: ' + name); } });
}
const repoModule = await import('../src/fixture/FixtureRepository.ts').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const notes = await import('../src/domain/notes.ts').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const workspace = await import('../src/domain/workspace.ts').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const ops = await import('../src/domain/operations.ts').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const request = { notebook_id: 'notebook:synthetic', engine: 'independent', message: 'Create a public example outline.', task: 'outline', source_version_ids: [] };
test('list → faithful workspace → separately labeled text → conditional save → queued receipt', async () => {
  assert.equal(typeof repoModule.FixtureRepository, 'function', 'fixture repository is required');
  const repo = new repoModule.FixtureRepository();
  assert.equal(repoModule.DEMO_BANNER, '演示数据 · 未连接服务');
  const [item] = await repo.listNotebooks();
  const ws = await repo.getWorkspace(item.id);
  assert.equal(ws.notes[0].revision, 1);
  assert.equal(ws.selection, null);
  assert.equal(ws.sources.length, 0, 'public contract fixture is not enriched with invented source fields');
  const text = repo.getPublicText();
  assert.equal(text.kind, 'public-synthetic-text');
  assert.match(text.label, /公开合成/);
  assert.equal('text' in ws, false);
  const saved = await repo.saveNote(ws.notes[0].id, 'My draft', 1);
  assert.equal(saved.kind, 'saved');
  assert.equal(saved.note.revision, 2);
  assert.equal(saved.message, '已保存在本次演示中（重启后重置）');
  const receipt = await repo.submitOutline(request, 'action-1');
  assert.equal(receipt.kind, 'receipt');
  assert.equal(receipt.message, '演示任务排队中');
  assert.equal(receipt.receipt.state, 'queued');
  const job = await repo.getJob(receipt.receipt.job_id);
  assert.equal(job.state, 'queued');
  assert.equal('result' in job, false);
  assert.equal((await new repoModule.FixtureRepository().getWorkspace(item.id)).notes[0].revision, 1);
});
test('public workspace fixture equality, detached values, unknown/null/omitted retained', async () => {
  assert.equal(typeof repoModule.FixtureRepository, 'function');
  const publicFixture = JSON.parse(readFileSync(new URL('../../../contracts/v1/fixtures/workspace.json', import.meta.url)));
  const repo = new repoModule.FixtureRepository();
  assert.deepEqual(await repo.getWorkspace('notebook:synthetic'), publicFixture);
  const extended = {...publicFixture, future: {state:'unrecognized'}, notes:[{id:'n',revision:1}, {id:'n2',revision:1,content:null}], selection:{future:null}};
  const custom = new repoModule.FixtureRepository({workspace:extended});
  const loaded = await custom.getWorkspace('notebook:synthetic');
  assert.deepEqual(loaded, extended);
  loaded.future.state = 'mutated';
  assert.equal((await custom.getWorkspace('notebook:synthetic')).future.state, 'unrecognized');
  assert.equal(notes.openDraft(loaded.notes[0]).content, undefined);
  assert.equal(notes.openDraft(loaded.notes[1]).content, null);
  assert.equal('content' in (await custom.getWorkspace('notebook:synthetic')).notes[0], false);
});
test('stale navigation cannot replace newer workspace or destroy drafts', () => {
  assert.equal(typeof workspace.beginNavigation, 'function');
  let state = workspace.initialNavigation();
  const first = workspace.beginNavigation(state, 'a'); state = first.state;
  const second = workspace.beginNavigation(state, 'b'); state = second.state;
  assert.deepEqual(workspace.resolveNavigation(state, first.ticket, {notebook:{id:'a'}}), state);
  assert.deepEqual(workspace.resolveNavigation(state, second.ticket, {notebook:{id:'a'}}), state);
  const loaded = {notebook:{id:'b'}};
  state = workspace.resolveNavigation(state, second.ticket, loaded);
  assert.equal(state.workspace, loaded);
  state = workspace.backToList(state);
  assert.equal(state.screen, 'list');
  assert.deepEqual(workspace.resolveNavigation(state, second.ticket, loaded), state);
});
test('conflict, error, unknown and stale saves preserve draft and expected revision', async () => {
  assert.equal(typeof notes.openDraft, 'function');
  for (const mode of ['conflict','unknown','error']) {
    const repo = new repoModule.FixtureRepository({saveMode:mode});
    const original = (await repo.getWorkspace('notebook:synthetic')).notes[0];
    let draft = notes.editDraft(notes.openDraft(original), 'unsaved');
    const pending = notes.beginSave(draft); draft = pending.draft;
    const result = await repo.saveNote(original.id, pending.attempt.content, pending.attempt.expectedRevision);
    draft = notes.finishSave(draft, pending.attempt, result);
    assert.equal(draft.content, 'unsaved');
    assert.equal(draft.expectedRevision, 1);
    assert.equal(draft.status, mode);
    if (mode === 'unknown') assert.equal(notes.beginSave(draft).attempt, null, 'unknown must not blindly retry');
  }
  const repo = new repoModule.FixtureRepository();
  let draft = notes.editDraft(notes.openDraft((await repo.getWorkspace('notebook:synthetic')).notes[0]), 'first');
  const pending = notes.beginSave(draft);
  assert.equal(notes.beginSave(pending.draft).attempt, null);
  draft = notes.editDraft(pending.draft, 'newer');
  const result = await repo.saveNote(draft.noteId, 'first', 1);
  draft = notes.finishSave(draft, pending.attempt, result);
  assert.equal(draft.content, 'newer');
  assert.equal(draft.expectedRevision, 2);
  assert.equal(draft.status, 'dirty');
  assert.deepEqual(notes.finishSave(draft, pending.attempt, result), draft);
  assert.equal((await repo.saveNote(draft.noteId, 'overwrite', 1)).kind, 'conflict');
});
test('same action and resume keep idempotency identity; mismatched payload rejected', async () => {
  assert.equal(typeof ops.beginOutline, 'function');
  const first = ops.beginOutline(null, request, 'key-1');
  assert.equal(ops.beginOutline(first, request, 'new-key'), first);
  const repo = new repoModule.FixtureRepository();
  const result = await repo.submitOutline(first.request, first.idempotencyKey);
  const received = ops.receiveSubmission(first, result);
  const resumed = ops.resumeOperation(received, await repo.getJob(received.receipt.job_id));
  assert.equal(resumed.idempotencyKey, 'key-1');
  assert.equal(ops.beginOutline(resumed, request, 'key-2'), resumed);
  assert.deepEqual(await repo.submitOutline(request, 'key-1'), result);
  await assert.rejects(repo.submitOutline({...request,message:'different'}, 'key-1'), /identity/i);
});
test('unknown submission is not automatically retried and raw job states grant no replay', async () => {
  assert.equal(typeof ops.beginOutline, 'function');
  const repo = new repoModule.FixtureRepository({submitMode:'unknown'});
  const operation = ops.beginOutline(null, request, 'unknown-key');
  const unknown = ops.receiveSubmission(operation, await repo.submitOutline(request, 'unknown-key'));
  assert.equal(unknown.status, 'unknown');
  assert.equal(ops.beginOutline(unknown, request, 'replacement'), unknown);
  const history = {job_id:'old',state:'future_state',restored_history:true,replay_allowed:false, result:{opaque:null}};
  assert.throws(() => ops.beginOutline(null, request, 'replay', history), /histor/i);
  assert.equal(ops.canReplay(history), false);
  const current = {job_id:'current',notebook_id:'notebook:synthetic',operation:'chat',state:'future_state',extension:null};
  const received = ops.receiveSubmission(operation,{kind:'receipt',receipt:{job_id:'current',turn_id:'t',state:'future_state'},message:''});
  assert.deepEqual(ops.resumeOperation(received,current).job,current);
  assert.equal(ops.canReplay(current),false);
  assert.deepEqual(ops.resumeOperation(received,{...current,job_id:'stale'}),received);
});
test('core has local-only imports and no network/storage/timer dependencies', () => {
  const files = readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.ts'));
  assert.ok(files.length > 0);
  for (const path of files) {
    const source = readFileSync(new URL(path,root),'utf8');
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|setTimeout|setInterval)\b/);
    for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)) assert.match(match[2],/^\.\.?\//);
  }
});
test('save retains existing note metadata and extensions; invalid requests fail closed', async () => {
  const base = JSON.parse(readFileSync(new URL('../../../contracts/v1/fixtures/workspace.json', import.meta.url)));
  Object.assign(base.notes[0],{citations:[{future:'citation'}],scope_snapshot:{future:null},created_at:'2025-01-01T00:00:00+00:00',future:{retained:true}});
  const repo=new repoModule.FixtureRepository({workspace:base});
  const result=await repo.saveNote(base.notes[0].id,'updated',1);
  assert.deepEqual(result.note.citations,base.notes[0].citations);
  assert.deepEqual(result.note.scope_snapshot,base.notes[0].scope_snapshot);
  assert.equal(result.note.created_at,base.notes[0].created_at);
  assert.deepEqual(result.note.future,{retained:true});
  await assert.rejects(repo.getWorkspace('absent'));
  await assert.rejects(repo.getJob('absent'));
  await assert.rejects(repo.saveNote('absent','x',1));
  await assert.rejects(repo.saveNote(base.notes[0].id,'x',null));
  await assert.rejects(repo.submitOutline({...request,engine:'invented'},'invalid-engine'));
  await assert.rejects(repo.submitOutline({...request,source_version_ids:Array(21).fill('x')},'invalid-sources'));
});
test('loaded historical jobs remain readable but never become executable', async () => {
  const base = JSON.parse(readFileSync(new URL('../../../contracts/v1/fixtures/workspace.json', import.meta.url)));
  const historical={job_id:'history',state:'future',restored_history:true,replay_allowed:false,result:null,extension:{opaque:true}};
  base.jobs.push(historical);
  const repo=new repoModule.FixtureRepository({workspace:base});
  assert.deepEqual(await repo.getJob('history'),historical);
  assert.throws(()=>ops.beginOutline(null,request,'replay',historical),/Historical/);
});
test('new actions reserve retained job/turn identities without shadowing history', async () => {
  const base = JSON.parse(readFileSync(new URL('../../../contracts/v1/fixtures/workspace.json', import.meta.url)));
  const historical = {job_id:'fixture-job:1',turn_id:'fixture-turn:1',state:'historical_state',restored_history:true,replay_allowed:false,result:{retained:true}};
  const current = {job_id:'fixture-job:2',turn_id:'fixture-turn:2',notebook_id:base.notebook.id,operation:'chat',state:'future_state'};
  base.jobs.push(historical,current);
  base.turns.push({id:'fixture-turn:3'},{turn_id:'fixture-turn:4'});
  base.legacy_history.push({opaque:{job_id:'fixture-job:5',turn_id:'fixture-turn:5'}});
  const repo = new repoModule.FixtureRepository({workspace:base});
  const seen = new Set(['fixture-job:1','fixture-job:2','fixture-job:5','fixture-turn:1','fixture-turn:2','fixture-turn:3','fixture-turn:4','fixture-turn:5']);
  for (const key of ['new-a','new-b','new-c']) {
    const result = await repo.submitOutline(request,key);
    for (const id of [result.receipt.job_id,result.receipt.turn_id]) {
      assert.equal(seen.has(id),false,'allocated identity must be new: '+id);
      seen.add(id);
    }
    assert.deepEqual(await repo.submitOutline(request,key),result);
    assert.deepEqual(await repo.getJob(historical.job_id),historical);
    assert.deepEqual(await repo.getJob(current.job_id),current);
    assert.throws(()=>ops.beginOutline(null,request,'replay',historical),/Historical/);
  }
  const loaded=await repo.getWorkspace(base.notebook.id);
  assert.equal(new Set(loaded.jobs.map(job=>job.job_id)).size,loaded.jobs.length);
  assert.deepEqual(loaded.turns,base.turns);
  assert.deepEqual(loaded.legacy_history,base.legacy_history);
});
test('reopened/reset draft ignores old success/error even with identical text and serial', async () => {
  for (const freshText of ['new','old']) {
    for (const staleKind of ['saved','error','unknown','conflict']) {
      const oldRepo=new repoModule.FixtureRepository();
      const original=(await oldRepo.getWorkspace('notebook:synthetic')).notes[0];
      const old=notes.beginSave(notes.editDraft(notes.openDraft(original),'old'));
      const oldResult=await oldRepo.saveNote(original.id,'old',1);
      const newRepo=new repoModule.FixtureRepository();
      const fresh=notes.beginSave(notes.editDraft(notes.openDraft(original),freshText));
      assert.equal(old.attempt.serial,fresh.attempt.serial);
      const stale=staleKind==='saved' ? oldResult : staleKind==='conflict' ? {kind:'conflict',detail:{code:'NOTE_REVISION_CONFLICT',current_revision:9}} : {kind:staleKind};
      const unaffected=notes.finishSave(fresh.draft,old.attempt,stale);
      assert.equal(unaffected,fresh.draft,'stale completion must be an exact no-op');
      assert.equal(unaffected.pending,fresh.attempt);
      assert.equal(unaffected.expectedRevision,1);
      assert.equal(unaffected.content,freshText);
      const freshResult=await newRepo.saveNote(original.id,freshText,1);
      const settled=notes.finishSave(unaffected,fresh.attempt,freshResult);
      assert.equal(settled.status,'saved');
      assert.equal(settled.expectedRevision,2);
      assert.equal(settled.pending,undefined);
      assert.equal(settled.content,freshText);
    }
  }
});
