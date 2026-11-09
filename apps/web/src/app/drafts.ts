import {createConfigurationStore,type ConfigurationDraft} from '../features/settings/configuration-store';
import {createAdvancedStore,type AdvancedDraft} from '../features/settings/advanced-store';
import { createSettingsStore, type SettingsDraft } from '../features/settings/settings-store';
import { createLibraryStore, type LibraryDraft } from '../features/library/library-store';
import { createStudioStore } from '../features/studio/studio-store';
import { createTurnRuntime } from '../features/chat/turn-runtime';
import { createSourceOperations } from '../features/sources/source-operations';
import { navigationDecision, freezeDispatchContext, canDispatch, type DispatchContext, type EditorModel } from '@study/domain';
export type DraftId = Readonly<{
    epoch: number;
    notebookId: string;
    editorSession: string;
}>;
export type DraftState = Readonly<{
    id: DraftId;
    editor?: EditorModel;
    question?: string;
    questionRevision?: number;
    file?: File | null;
    retired: boolean;
    creation?: NotebookCreationDraft;
}>;
/** Local creation namespace, never a server notebook ID or server idempotency key. */
export type NotebookCreationDraft = Readonly<{
    context: DispatchContext;
    name: string;
    description: string;
    status: 'editing' | 'pending' | 'unknown' | 'not-sent' | 'succeeded';
    notebookId?: string;
}>;
export type NotebookCreationEntry = DraftState & {
    creation: NotebookCreationDraft;
};
export type NotebookCreationSnapshot = Readonly<{
    active: NotebookCreationEntry | undefined;
    retained: readonly NotebookCreationEntry[];
}>;
const key = (id: DraftId) => JSON.stringify([id.epoch, id.notebookId, id.editorSession]);
export function createDraftRegistry() {
    const drafts = new Map<string, DraftState>();
    const retired = new Set<number>();
    const privateClears = new Map<number, Set<() => void>>();
    const listeners = new Set<() => void>();
    let activeCreation: DraftId | null = null;
    let creationSnapshot: NotebookCreationSnapshot = Object.freeze({ active: undefined, retained: [] });
    const creationEntry = (id: DraftId | null): NotebookCreationEntry | undefined => {
        const draft = id ? drafts.get(key(id)) : undefined;
        return draft?.creation ? draft as NotebookCreationEntry : undefined;
    };
    const notify = () => {
        const active = creationEntry(activeCreation);
        const retained = [...drafts.values()].filter((draft): draft is NotebookCreationEntry => !!draft.creation && draft !== active && draft.creation.status !== 'succeeded');
        creationSnapshot = Object.freeze({ active, retained: Object.freeze(retained) });
        listeners.forEach(fn => fn());
    };
    const library = createLibraryStore(notify);
    const settings = createSettingsStore(notify);
    const advanced = createAdvancedStore(notify);
    const configuration = createConfigurationStore(notify);
    const sources = createSourceOperations(notify);
    const turns = createTurnRuntime(notify);
    const studio = createStudioStore(notify);
    const startCreation = (context: DispatchContext) => {
        const id: DraftId = Object.freeze({ epoch: context.epoch, notebookId: '@notebook-creation', editorSession: crypto.randomUUID() });
        activeCreation = id;
        drafts.set(key(id), Object.freeze({ id, retired: false, creation: Object.freeze({ context: freezeDispatchContext(context), name: '', description: '', status: 'editing' as const }) }));
        notify();
        return id;
    };
    return { sources, turns, studio, library, settings, advanced, configuration,
        registerPrivateClear(epoch: number, clear: () => void) {
            if (retired.has(epoch)) { try { clear(); } catch { /* Continue other participants. */ } return () => {}; }
            const callbacks=privateClears.get(epoch) ?? new Set<() => void>(); callbacks.add(clear); privateClears.set(epoch,callbacks);
            return () => { callbacks.delete(clear); if (!callbacks.size) privateClears.delete(epoch); };
        }, clearQuestion(id: DraftId, revision: number) {
            const draft=drafts.get(key(id));
            if (!draft || draft.retired || retired.has(id.epoch) || draft.questionRevision !== revision) return;
            drafts.set(key(id),Object.freeze({...draft,question:'',questionRevision:revision+1})); notify();
        }, get: (id: DraftId) => drafts.get(key(id)), isRetired: (id: DraftId) => retired.has(id.epoch), update(id: DraftId, patch: Partial<Pick<DraftState, 'editor' | 'question' | 'file'>>) {
            if (retired.has(id.epoch) || patch.editor && patch.editor.notebookId !== id.notebookId)
                return;
            drafts.set(key(id), Object.freeze({ ...drafts.get(key(id)), ...patch, ...(patch.question !== undefined ? {questionRevision:(drafts.get(key(id))?.questionRevision ?? 0)+1} : {}), id: Object.freeze({ ...id }), retired: false }));
            notify();
        },
        getNotebookCreationSnapshot: () => creationSnapshot,
        openNotebookCreation(context: DispatchContext) {
            const existing = creationEntry(activeCreation);
            if (existing && existing.creation.status !== 'succeeded')
                return existing.id;
            return context.ready ? startCreation(context) : null;
        },
        startFreshNotebookCreation(context: DispatchContext) {
            const old = creationEntry(activeCreation);
            if (!old || !context.ready || old.id.epoch === context.epoch)
                return null;
            drafts.set(key(old.id), Object.freeze({ ...old, retired: true, creation: Object.freeze({ ...old.creation, status: old.creation.status === 'pending' ? 'unknown' as const : old.creation.status }) }));
            return startCreation(context);
        },
        editNotebookCreation(id: DraftId, input: {
            name?: string;
            description?: string;
        }) {
            const old = creationEntry(id);
            if (!old || old.retired || retired.has(id.epoch) || !['editing', 'not-sent'].includes(old.creation.status))
                return;
            drafts.set(key(id), Object.freeze({ ...old, creation: Object.freeze({ ...old.creation, ...input }) }));
            notify();
        },
        beginNotebookCreation(id: DraftId, current: DispatchContext | null) {
            const old = creationEntry(id);
            if (!old || old.retired || retired.has(id.epoch) || !['editing', 'not-sent'].includes(old.creation.status) || !old.creation.name.trim() || !canDispatch(old.creation.context, current))
                return null;
            const value = Object.freeze({ ...old.creation, status: 'pending' as const });
            drafts.set(key(id), Object.freeze({ ...old, creation: value }));
            notify();
            return value;
        },
        settleNotebookCreation(id: DraftId, outcome: 'unknown' | 'not-sent' | {
            notebookId: string;
        }, current: DispatchContext | null) {
            const old = creationEntry(id);
            if (!old || old.creation.status !== 'pending')
                return;
            const status = old.retired || retired.has(id.epoch) || !canDispatch(old.creation.context, current) || typeof outcome === 'object' && !outcome.notebookId.trim() ? 'unknown' : typeof outcome === 'string' ? outcome : 'succeeded';
            const result = typeof outcome === 'object' && status === 'succeeded' ? { notebookId: outcome.notebookId } : {};
            drafts.set(key(id), Object.freeze({ ...old, creation: Object.freeze({ ...old.creation, ...result, status }) }));
            notify();
        }, retireContext(epoch: number) {
            retired.add(epoch);
            const callbacks=privateClears.get(epoch); privateClears.delete(epoch);
            callbacks?.forEach(clear => { try { clear(); } catch { /* One private field must not block another. */ } });
            settings.retire(epoch);
            advanced.retire(epoch);
            configuration.retire(epoch);
            library.retire(epoch);
            sources.retire(epoch);
            turns.retire(epoch);
            studio.retire(epoch);
            for (const [k, draft] of drafts)
                if (draft.id.epoch === epoch)
                    drafts.set(k, Object.freeze({ ...draft, retired: true, ...(draft.creation ? { creation: Object.freeze({ ...draft.creation, status: draft.creation.status === 'pending' ? 'unknown' as const : draft.creation.status }) } : {}) }));
            notify();
        },
        hasUnsaved: () => configuration.hasUnsaved() || advanced.hasUnsaved() || settings.hasUnsaved() || library.hasUnsaved() || studio.hasUnsaved() || turns.hasPending() || sources.hasUnsaved() || [...drafts.values()].some(d => !!(d.editor?.dirty || d.editor?.pending || d.question || d.file || d.creation && d.creation.status !== 'succeeded' && (d.creation.name || d.creation.description || ['pending', 'unknown'].includes(d.creation.status)))),
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}
export type DraftRegistry = ReturnType<typeof createDraftRegistry>;
export type NavigationIntent = Readonly<{
    destination: string;
    opener?: HTMLElement | null;
}>;
export type NavigationDecision = 'allow' | 'confirm' | 'blocked' | 'retain';
type NotebookCapture = Readonly<{
    decision: Exclude<NavigationDecision, 'allow'>;
    id: DraftId;
    revision: number | undefined;
    draft: DraftState;
    activation: number;
    intent: NavigationIntent;
}>;
type ResourceDraft = LibraryDraft | SettingsDraft | AdvancedDraft | ConfigurationDraft;
type ResourceCapture = Readonly<{decision: Exclude<NavigationDecision, 'allow'>; resourceId: string; resourceDraft: ResourceDraft; resourceDrafts: readonly ResourceDraft[]; focusedResourceId: string | null; notebookDraft: DraftState | undefined; activation: number; intent: NavigationIntent}>;
type Capture = NotebookCapture | ResourceCapture;
export function createNavigationController(registry: DraftRegistry) {
    let active: DraftId | null = null;
    let resourceActive: string | null = null;
    const resourceOwners = new Set<string>();
    const resourceLeases = new Map<string, Set<symbol>>();
    let activation = 0;
    let capture: Capture | null = null;
    let status: 'confirm' | 'blocked' | 'retain' | null = null;
    const listeners = new Set<() => void>();
    let snapshot: Readonly<{
        status: 'confirm' | 'blocked' | 'retain' | null;
        capture: Capture | null;
    }> = { status: null, capture: null };
    const notify = () => { snapshot = Object.freeze({ status, capture }); listeners.forEach(fn => fn()); };
    const activate = (id: DraftId | null) => {
        if (resourceActive === null && (active && id ? key(active) === key(id) : active === id))
            return;
        resourceActive = null;
        active = id ? Object.freeze({ ...id }) : null;
        activation++;
        capture = null;
        status = null;
        notify();
    };
    const activateResource = (id: string | null) => {
        if (resourceActive === id && (id !== null || resourceOwners.size === 0)) return;
        resourceActive = id;
        if (id) resourceOwners.add(id); else resourceOwners.clear();
        activation++; capture = null; status = null; notify();
    };
    const deactivateResource = (id: string) => {
        if (!resourceOwners.delete(id)) return;
        if (resourceActive === id) resourceActive = [...resourceOwners].at(-1) ?? null;
        activation++; capture = null; status = null; notify();
    };
    const resourceRows = () => [...resourceOwners].flatMap(id => {const row=(registry.library.get(id) ?? registry.settings.get(id) ?? registry.advanced.get(id) ?? registry.configuration.get(id));return row?[row]:[];});
    const resourceDecision = (rows: readonly ResourceDraft[]): NavigationDecision => {
        // Source-origin Studio saves still block navigation when no notebook pane is mounted.
        const notebook = decision(active ? registry.get(active) : undefined);
        if (notebook === 'blocked') return 'blocked';
        if (notebook === 'retain' || rows.some(r=>['pending','accepted','unknown'].includes(r.status))) return 'retain';
        return notebook === 'confirm' || rows.some(r=>r.dirty) ? 'confirm' : 'allow';
    };
    const decision = (draft: DraftState | undefined): NavigationDecision => {
        if (registry.studio.blocked(active?.notebookId)) return 'blocked';
        if (active && (registry.sources.pending(active.notebookId) || registry.turns.hasPending(active.notebookId))) return 'blocked';
        const editorBlocked = !!draft?.editor?.pending || !!draft?.editor && ['unknown', 'conflict', 'rejected'].includes(draft.editor.saveResult);
        // F26: creation alone may continue only after explicit retention, never by generic discard.
        if (!editorBlocked && draft?.creation && ['pending', 'unknown'].includes(draft.creation.status))
            return 'retain';
        return navigationDecision({ targetChanged: true,
            dirty: registry.studio.dirty(active?.notebookId) || !!(draft?.editor?.dirty || draft?.question || draft?.file || draft?.creation && draft.creation.status !== 'succeeded' && (draft.creation.name || draft.creation.description)),
            saving: !!draft?.editor?.pending || draft?.creation?.status === 'pending',
            unknown: !!draft?.editor && ['unknown', 'conflict', 'rejected'].includes(draft.editor.saveResult) || draft?.creation?.status === 'unknown' });
    };
    return { registry, getSnapshot: () => snapshot, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        activate, activateResource,
        deactivateResource,
        holdResource(id: string) {
            const lease = Symbol(id), leases = resourceLeases.get(id) ?? new Set<symbol>();
            leases.add(lease); resourceLeases.set(id, leases);
            const row = (registry.library.get(id) ?? registry.settings.get(id) ?? registry.advanced.get(id) ?? registry.configuration.get(id));
            if (row && (row.dirty || ['pending','accepted','unknown'].includes(row.status)) && !resourceOwners.has(id)) {
                resourceOwners.add(id); activation++; capture=null; status=null; notify();
            }
            return () => {
                leases.delete(lease);
                if (!leases.size) {resourceLeases.delete(id);deactivateResource(id);}
            };
        },
        deactivate(id: DraftId) {
            if (active && key(active) === key(id))
                activate(null);
        },
        requestNavigation(intent: NavigationIntent): NavigationDecision {
            const rows = resourceRows();
            if (rows.length) {
                const row = rows.find(r=>r.id===resourceActive) ?? rows[0]!, result = resourceDecision(rows);
                capture = result !== 'allow' ? Object.freeze({decision: result, resourceId: row.id, resourceDraft: row, resourceDrafts: Object.freeze(rows), focusedResourceId: resourceActive, notebookDraft: active ? registry.get(active) : undefined, activation, intent: Object.freeze({...intent})}) : null;
                status = result === 'allow' ? null : result; notify(); return result;
            }
            const draft = active ? registry.get(active) : undefined;
            const result = decision(draft);
            capture = active && draft && result !== 'allow' ? Object.freeze({ decision: result, id: active, revision: draft.editor?.revision, draft, activation, intent: Object.freeze({ ...intent }) }) : null;
            status = result === 'allow' ? null : result;
            notify();
            return result;
        }, confirm(expected: Capture | null = capture): NavigationIntent | null {
            if (expected !== capture)
                return null;
            const original = capture;
            capture = null;
            status = null;
            notify();
            if (original && 'resourceId' in original) {
                const rows = resourceRows();
                if (resourceActive !== original.focusedResourceId || activation !== original.activation || rows.length !== original.resourceDrafts.length || rows.some((r,i)=>r!==original.resourceDrafts[i]) || original.notebookDraft !== (active ? registry.get(active) : undefined) || !['confirm','retain'].includes(original.decision) || resourceDecision(rows) !== original.decision) return null;
                return original.intent;
            }
            if (!original || !active || activation !== original.activation || key(active) !== key(original.id))
                return null;
            const draft = registry.get(active);
            if (draft !== original.draft || draft.editor?.revision !== original.revision || !['confirm', 'retain'].includes(original.decision) || decision(draft) !== original.decision)
                return null;
            return original.intent;
        }, cancel(expected: Capture | null = capture) {
            if (expected !== capture)
                return;
            const opener = capture?.intent.opener;
            capture = null;
            status = null;
            notify();
            queueMicrotask(() => opener?.focus());
        }, };
}
export type NavigationController = ReturnType<typeof createNavigationController>;
