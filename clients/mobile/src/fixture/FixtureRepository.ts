import { copy } from '../domain/contracts.ts';
import type { Job, Opaque, OutlineRequest, SaveResult, SubmissionResult, Workspace } from '../domain/contracts.ts';
import { publicWorkspace } from './publicWorkspace.ts';
export const DEMO_BANNER = '演示数据 · 未连接服务';
export const SAVED_MESSAGE = '已保存在本次演示中（重启后重置）';
export const QUEUED_MESSAGE = '演示任务排队中';
export interface FixtureOptions { workspace?:Workspace; saveMode?:'normal'|'conflict'|'unknown'|'error'; submitMode?:'normal'|'unknown'|'error' }
function canonical(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value !== null && typeof value === 'object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'undefined';
}
function record(value:unknown):value is Opaque {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function metadata(note:Opaque):{citations:Opaque[];scope_snapshot:Opaque;created_at:string} {
  const citations = note.citations === undefined ? [] : note.citations;
  const scope = note.scope_snapshot === undefined ? {} : note.scope_snapshot;
  const created = note.created_at === undefined ? '2026-01-01T00:00:00+00:00' : note.created_at;
  if (!Array.isArray(citations) || !citations.every(record) || !record(scope) || typeof created !== 'string') throw new Error('Unsupported fixture note metadata');
  return {citations,scope_snapshot:scope,created_at:created};
}
export class FixtureRepository {
  private workspace:Workspace;
  private options:FixtureOptions;
  private submissions = new Map<string,{payload:string;result:SubmissionResult}>();
  private jobs = new Map<string,Job>();
  private reservedIdentities = new Set<string>();
  private nextIdentity = 1;
  constructor(options:FixtureOptions = {}) {
    this.options=copy(options);
    this.workspace=copy(options.workspace ?? publicWorkspace);
    // Retained records are opaque, so conservatively reserve every string,
    // including nested legacy references rather than guessing their field names.
    this.reserveRetainedStrings(this.workspace);
  }
  private reserveRetainedStrings(value:unknown):void {
    if (typeof value === 'string') {
      this.reservedIdentities.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(item=>this.reserveRetainedStrings(item));
    } else if (record(value)) {
      Object.values(value).forEach(item=>this.reserveRetainedStrings(item));
    }
  }
  private allocateReceipt():{job_id:string;turn_id:string;state:string} {
    for (;;) {
      const index=this.nextIdentity++;
      const job_id='fixture-job:'+index;
      const turn_id='fixture-turn:'+index;
      if (this.reservedIdentities.has(job_id) || this.reservedIdentities.has(turn_id)) continue;
      this.reservedIdentities.add(job_id);
      this.reservedIdentities.add(turn_id);
      return {job_id,turn_id,state:'queued'};
    }
  }
  // This index and the text asset below are fixture-local, NOT public API DTOs.
  async listNotebooks():Promise<{id:string;name:string}[]> {
    return [{id:this.workspace.notebook.id,name:this.workspace.notebook.name}];
  }
  async getWorkspace(notebookId:string):Promise<Workspace> {
    if (notebookId !== this.workspace.notebook.id) throw new Error('Fixture notebook not found');
    return copy(this.workspace);
  }
  getPublicText():{kind:'public-synthetic-text';label:string;text:string} {
    return {kind:'public-synthetic-text',label:'公开合成文本 · 非 PDF · 不属于服务端资料版本',text:'This is a public synthetic study example. A seed needs water and light to grow.'};
  }
  async saveNote(noteId:string,content:string,expectedRevision:number):Promise<SaveResult> {
    const note=this.workspace.notes.find(item=>item.id===noteId);
    if (!note) throw new Error('Fixture note not found');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Expected revision required');
    if (typeof content !== 'string') throw new Error('Explicit draft content required');
    if (expectedRevision !== note.revision || this.options.saveMode === 'conflict') return {kind:'conflict',detail:{code:'NOTE_REVISION_CONFLICT',current_revision:note.revision}};
    if (this.options.saveMode === 'unknown' || this.options.saveMode === 'error') return {kind:this.options.saveMode};
    if (!Number.isSafeInteger(note.revision+1)) throw new Error('Revision out of range');
    const retained=metadata(note);
    const updated={...note,content,revision:note.revision+1};
    this.workspace.notes=this.workspace.notes.map(item=>item.id===noteId ? updated:item);
    return {kind:'saved',message:SAVED_MESSAGE,note:copy({...updated,note_id:noteId,notebook_id:this.workspace.notebook.id,
      ...retained,updated_at:'2026-01-01T00:00:00+00:00'})};
  }
  async submitOutline(request:OutlineRequest,idempotencyKey:string):Promise<SubmissionResult> {
    if ((request.engine !== 'independent' && request.engine !== 'notebooklm') ||
      (request.selection_origin !== undefined && request.selection_origin !== 'local' && request.selection_origin !== 'remote') ||
      [request.source_version_ids,request.remote_source_ids].some(ids=>ids !== undefined && (!Array.isArray(ids) || ids.length>20 || ids.some(id=>typeof id !== 'string')))) throw new Error('Invalid fixture outline request');
    if (request.task !== 'outline' || request.notebook_id !== this.workspace.notebook.id || !request.message.length || request.message.length>50000 || !idempotencyKey.length || idempotencyKey.length>200) throw new Error('Invalid fixture outline request');
    const payload=canonical(request), previous=this.submissions.get(idempotencyKey);
    if (previous) {
      if (previous.payload !== payload) throw new Error('Idempotency identity payload mismatch');
      return copy(previous.result);
    }
    const receipt=this.allocateReceipt();
    const result:SubmissionResult=this.options.submitMode === 'unknown' || this.options.submitMode === 'error'
      ? {kind:this.options.submitMode} : {kind:'receipt',receipt,message:QUEUED_MESSAGE};
    this.submissions.set(idempotencyKey,{payload,result:copy(result)});
    if (result.kind === 'receipt') {
      const job:Job={...receipt,notebook_id:request.notebook_id,operation:'chat',submission_state:'not_submitted',idempotency_key:idempotencyKey,request_snapshot:{...copy(request),idempotency_key:idempotencyKey}};
      this.jobs.set(job.job_id,job);
      this.workspace.jobs.push(copy(job));
    }
    return copy(result);
  }
  async getJob(jobId:string):Promise<Job> {
    const retained=this.workspace.jobs.find(item=>item.job_id===jobId);
    const job=this.jobs.get(jobId) ?? (retained && typeof retained.job_id === 'string' && typeof retained.state === 'string' ? retained as Job : undefined);
    if (!job) throw new Error('Fixture job not found');
    return copy(job);
  }
}
