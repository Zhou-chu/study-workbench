import test from 'node:test';
import assert from 'node:assert/strict';
import { FixtureSession } from '../src/session/FixtureSession.ts';
import { FixtureRepository } from '../src/fixture/FixtureRepository.ts';
const id = 'notebook:synthetic', noteId = 'note:synthetic';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
async function ready(repo = new FixtureRepository()) { const s = new FixtureSession(() => repo); await s.loadList(); await s.openWorkspace(id); s.openNote(noteId); return s; }
test('session drafts survive workspace navigation and preserve edit during exact-attempt save', async () => {
 const repo = new FixtureRepository(), d = deferred(); let calls = 0;
 const save = repo.saveNote.bind(repo); repo.saveNote = (...args) => { calls++; return d.promise.then(() => save(...args)); };
 const s = await ready(repo); s.editNote(noteId, 'first'); const pending = s.saveNote(noteId);
 const attempt = s.getSnapshot().drafts[noteId].pending;
 s.editNote(noteId, 'later'); assert.equal(s.getSnapshot().drafts[noteId].pending, attempt);
 await s.openWorkspace(id); s.openNote(noteId); await s.saveNote(noteId); assert.equal(calls, 1);
 d.resolve(); await pending; assert.equal(s.getSnapshot().drafts[noteId].content, 'later'); assert.equal(s.getSnapshot().drafts[noteId].status, 'dirty');
 await s.saveNote(noteId); await s.saveNote(noteId); assert.equal(calls, 2);
});
test('unknown saves cannot retry even after editing and errors do not lose text', async () => {
 for (const mode of ['unknown','conflict','error']) {
  const s = await ready(new FixtureRepository({saveMode:mode})); s.editNote(noteId,'mine'); await s.saveNote(noteId);
  assert.equal(s.getSnapshot().drafts[noteId].status, mode); assert.equal(s.getSnapshot().drafts[noteId].expectedRevision,1);
  if(mode==='unknown') { s.editNote(noteId,'still mine'); await s.saveNote(noteId); assert.equal(s.getSnapshot().drafts[noteId].serial,1); }
 }
});
test('reset isolates outstanding saves from fresh same-identity draft', async () => {
 const old = new FixtureRepository(), d = deferred(); old.saveNote = () => d.promise;
 let n = 0; const s = new FixtureSession(() => n++ === 0 ? old : new FixtureRepository());
 await s.openWorkspace(id); s.openNote(noteId); s.editNote(noteId,'old'); const pending = s.saveNote(noteId);
 s.reset(); await s.openWorkspace(id); s.openNote(noteId); s.editNote(noteId,'new');
 d.resolve({kind:'unknown'}); await pending; assert.equal(s.getSnapshot().drafts[noteId].status,'dirty'); assert.equal(s.getSnapshot().drafts[noteId].content,'new');
});
test('late workspace and list responses cannot replace newer or reset state', async () => {
 const repo = new FixtureRepository(), d = deferred(), original = repo.getWorkspace.bind(repo);
 repo.getWorkspace = key => key==='old' ? d.promise : original(key);
 const s = new FixtureSession(() => repo), pending = s.openWorkspace('old'); await s.openWorkspace(id);
 d.resolve({...await original(id),notebook:{id:'old',name:'old'}}); await pending; assert.equal(s.getSnapshot().workspace.data.notebook.id,id);
 const list = deferred(); repo.listNotebooks = () => list.promise; const p = s.loadList(); s.reset(); list.resolve([{id:'old',name:'old'}]); await p;
 assert.equal(s.getSnapshot().list.status,'idle');
});
test('outline duplicate and unknown actions never resubmit; resume only reads receipt', async () => {
 for (const submitMode of ['normal','unknown','error']) {
  const repo = new FixtureRepository({submitMode}); let submissions=0,reads=0;
  const submit = repo.submitOutline.bind(repo), get = repo.getJob.bind(repo);
  repo.submitOutline = (...a) => {submissions++; return submit(...a)}; repo.getJob = (...a) => {reads++; return get(...a)};
  const s = await ready(repo); await Promise.all([s.submitOutline(id),s.submitOutline(id)]); await s.openWorkspace(id); await s.submitOutline(id);
  assert.equal(submissions,1); const op = s.getSnapshot().operations[id]; await s.resumeOutline(id);
  assert.equal(reads,submitMode==='normal'?1:0); assert.equal(s.getSnapshot().operations[id].idempotencyKey,op.idempotencyKey);
  if(submitMode==='normal') assert.equal(s.getSnapshot().operations[id].job.state,'queued');
 }
});
test('missing note text remains missing and load failures are visible', async () => {
 const repo = new FixtureRepository(); const w = await repo.getWorkspace(id); delete w.notes[0].content;
 const s = await ready(new FixtureRepository({workspace:w})); await s.saveNote(noteId); assert.equal(s.getSnapshot().drafts[noteId].content,undefined);
 await s.openWorkspace('missing'); assert.equal(s.getSnapshot().workspace.status,'error');
});
test('thrown mutation errors remain unknown, never retryable certainty', async () => {
 const repo = new FixtureRepository(); let saves=0,submissions=0;
 repo.saveNote = async () => {saves++; throw new Error('lost reply')};
 repo.submitOutline = async () => {submissions++; throw new Error('lost reply')};
 const s = await ready(repo); s.editNote(noteId,'retained'); await s.saveNote(noteId); await s.saveNote(noteId);
 await s.submitOutline(id); await s.submitOutline(id);
 assert.equal(s.getSnapshot().drafts[noteId].status,'unknown'); assert.equal(s.getSnapshot().operations[id].status,'unknown');
 assert.equal(saves,1); assert.equal(submissions,1);
});
test('reset fences late outline submission and resume without changing new operations', async () => {
 const old = new FixtureRepository(), submitted = deferred(); old.submitOutline = () => submitted.promise;
 let count=0; const s = new FixtureSession(() => count++===0?old:new FixtureRepository());
 await s.openWorkspace(id); const p = s.submitOutline(id); s.reset(); await s.openWorkspace(id); await s.submitOutline(id);
 const current = s.getSnapshot().operations[id]; submitted.resolve({kind:'unknown'}); await p;
 assert.equal(s.getSnapshot().operations[id], current);
 const repo = new FixtureRepository(), resumed = deferred(); repo.getJob = () => resumed.promise;
 let n=0; const r = new FixtureSession(() => n++===0?repo:new FixtureRepository());
 await r.openWorkspace(id); await r.submitOutline(id); const pending = r.resumeOutline(id); r.reset();
 resumed.resolve({job_id:'fixture-job:1',state:'queued'}); await pending;
 assert.deepEqual(r.getSnapshot().operations,{}); assert.deepEqual(r.getSnapshot().resumes,{});
});
