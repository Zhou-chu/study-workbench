import type { Workspace } from '../domain/contracts.ts';
import { beginSave, editDraft, finishSave, openDraft } from '../domain/notes.ts';
import type { NoteDraft } from '../domain/notes.ts';
import { beginOutline, receiveSubmission, resumeOperation } from '../domain/operations.ts';
import type { OutlineOperation } from '../domain/operations.ts';
import { FixtureRepository } from '../fixture/FixtureRepository.ts';

export type Load<T> = { status: 'idle' | 'loading' | 'error' | 'ready'; data?: T };
export interface SessionSnapshot {
  epoch: number;
  list: Load<{ id: string; name: string }[]>;
  workspace: Load<Workspace>;
  notebookId?: string;
  drafts: Readonly<Record<string, NoteDraft>>;
  operations: Readonly<Record<string, OutlineOperation>>;
  resumes: Readonly<Record<string, 'loading' | 'error' | 'ready'>>;
}
export type Repository = Pick<FixtureRepository, 'listNotebooks' | 'getWorkspace' | 'getPublicText' | 'saveNote' | 'submitOutline' | 'getJob'>;

/** One owner per mounted app, never per route or width. Not persistent storage. */
export class FixtureSession {
  private repository: Repository;
  private factory: () => Repository;
  private listeners = new Set<() => void>();
  private workspaceTicket = 0;
  private listTicket = 0;
  private state: SessionSnapshot = this.initial(0);

  constructor(factory: () => Repository = () => new FixtureRepository()) {
    this.factory = factory;
    this.repository = factory();
  }
  private initial(epoch: number): SessionSnapshot {
    return { epoch, list: { status: 'idle' }, workspace: { status: 'idle' }, drafts: {}, operations: {}, resumes: {} };
  }
  getSnapshot = (): SessionSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<SessionSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  reset(): void {
    this.repository = this.factory();
    this.workspaceTicket++;
    this.listTicket++;
    this.state = this.initial(this.state.epoch + 1);
    this.listeners.forEach(listener => listener());
  }
  getPublicText(): ReturnType<Repository['getPublicText']> { return this.repository.getPublicText(); }
  async loadList(): Promise<void> {
    const ticket = ++this.listTicket;
    this.update({ list: { status: 'loading' } });
    try {
      const data = await this.repository.listNotebooks();
      if (ticket === this.listTicket) this.update({ list: { status: 'ready', data } });
    } catch {
      if (ticket === this.listTicket) this.update({ list: { status: 'error' } });
    }
  }
  async openWorkspace(notebookId: string): Promise<void> {
    const ticket = ++this.workspaceTicket;
    this.update({ notebookId, workspace: { status: 'loading' } });
    try {
      const data = await this.repository.getWorkspace(notebookId);
      if (ticket !== this.workspaceTicket) return;
      this.update({ workspace: data.notebook.id === notebookId ? { status: 'ready', data } : { status: 'error' } });
    } catch {
      if (ticket === this.workspaceTicket) this.update({ workspace: { status: 'error' } });
    }
  }
  openNote(noteId: string): void {
    if (this.state.drafts[noteId]) return;
    const note = this.state.workspace.data?.notes.find(item => item.id === noteId);
    if (note) this.updateDraft(noteId, openDraft(note));
  }
  private updateDraft(noteId: string, draft: NoteDraft): void {
    // Shallow only: pending is the exact beginSave capability object.
    this.update({ drafts: { ...this.state.drafts, [noteId]: draft } });
  }
  editNote(noteId: string, content: string): void {
    const draft = this.state.drafts[noteId];
    if (draft) this.updateDraft(noteId, editDraft(draft, content));
  }
  async saveNote(noteId: string): Promise<void> {
    const draft = this.state.drafts[noteId];
    if (!draft || (draft.status !== 'dirty' && draft.status !== 'error')) return;
    const { draft: saving, attempt } = beginSave(draft);
    if (!attempt) return;
    const epoch = this.state.epoch, repository = this.repository;
    this.updateDraft(noteId, saving);
    let result;
    try { result = await repository.saveNote(attempt.noteId, attempt.content, attempt.expectedRevision); }
    catch { result = { kind: 'unknown' } as const; }
    const current = this.state.drafts[noteId];
    if (this.state.epoch !== epoch || !current) return;
    this.updateDraft(noteId, finishSave(current, attempt, result));
  }
  async submitOutline(notebookId: string): Promise<void> {
    if (this.state.operations[notebookId] || this.state.workspace.data?.notebook.id !== notebookId) return;
    const operation = beginOutline(null, {
      notebook_id: notebookId, engine: 'independent', task: 'outline',
      message: '演示大纲请求（不调用模型，不产生内容）',
    }, `demo-outline:${this.state.epoch}:${notebookId}`);
    const epoch = this.state.epoch, repository = this.repository;
    this.update({ operations: { ...this.state.operations, [notebookId]: operation } });
    let result;
    try { result = await repository.submitOutline(operation.request, operation.idempotencyKey); }
    catch { result = { kind: 'unknown' } as const; }
    if (epoch !== this.state.epoch || this.state.operations[notebookId] !== operation) return;
    this.update({ operations: { ...this.state.operations, [notebookId]: receiveSubmission(operation, result) } });
  }
  async resumeOutline(notebookId: string): Promise<void> {
    const operation = this.state.operations[notebookId];
    if (!operation?.receipt || this.state.resumes[notebookId] === 'loading') return;
    const epoch = this.state.epoch, repository = this.repository;
    this.update({ resumes: { ...this.state.resumes, [notebookId]: 'loading' } });
    try {
      const job = await repository.getJob(operation.receipt.job_id);
      if (epoch !== this.state.epoch || this.state.operations[notebookId] !== operation) return;
      this.update({
        operations: { ...this.state.operations, [notebookId]: resumeOperation(operation, job) },
        resumes: { ...this.state.resumes, [notebookId]: job.job_id === operation.receipt.job_id ? 'ready' : 'error' },
      });
    } catch {
      if (epoch === this.state.epoch && this.state.operations[notebookId] === operation) {
        this.update({ resumes: { ...this.state.resumes, [notebookId]: 'error' } });
      }
    }
  }
}
