import { ownsSession, parentKey, type NativeParent, type NativeSession, type NativeMessage, type Indicators, type ContextConfig } from '../../data/native-chat';
import { canDispatch, freezeDispatchContext, type DispatchContext } from '@study/domain';
export type LibraryOwner = {
    kind: 'global';
} | {
    kind: 'source';
    sourceId: string;
} | {
    kind: 'notebook';
    notebookId: string;
} | {
    kind: 'session';
    parent: {
        kind: 'source';
        sourceId: string;
    } | {
        kind: 'notebook';
        notebookId: string;
    };
    sessionId: string;
} | {
    kind: 'profile';
    profileType: 'episode' | 'speaker';
    profileId: string;
};
export type ImportInput = {
    kind: 'import';
    type: 'link' | 'upload' | 'text';
    title: string;
    text: string;
    urls: string;
    files: readonly File[];
    notebooks: readonly string[];
    transformations: readonly string[];
    embed: boolean;
    step: number;
};
export type MetadataInput = {
    kind: 'metadata';
    sourceId: string;
    title: string;
    topics: string;
};
export type AssociationInput = {
    kind: 'associations';
    sourceId: string;
    original: readonly string[];
    selected: readonly string[];
};
export type ExistingInput = {
    kind: 'existing';
    notebookId: string;
    selected: readonly string[];
    query: string;
};
export type ActionInput = {
    kind: 'action';
    action: 'delete' | 'unlink' | 'retry' | 'embed' | 'insight' | 'delete-insight';
    sourceId: string;
    notebookId?: string;
    insightId?: string;
    transformationId?: string;
};
export type NativeChatInput = {
    kind: 'native-chat';
    parent: NativeParent;
    sessionId: string | null;
    message: string;
    model: string | null;
    title: string;
};
export type NativeSessionInput = {
    kind: 'native-session';
    parent: NativeParent;
    sessionId: string | null;
    action: 'create' | 'rename' | 'model' | 'delete';
    title?: string;
    model?: string | null;
};
export type ClassicContextInput = {
    kind: 'classic-context';
    parent: NativeParent;
    config: ContextConfig;
};
export type NativeState = {
    inspection?: NativeSession;
    confirmed?: {
        sessionId: string;
        messages: NativeMessage[];
        token: LibraryToken;
    };
    session?: NativeSession;
    messages?: NativeMessage[];
    indicators?: Indicators | null;
    readSequence?: number;
    checked?: NativeMessage[];
};
export type LibraryInput = ImportInput | MetadataInput | AssociationInput | ExistingInput | ActionInput | NativeChatInput | NativeSessionInput | ClassicContextInput;
export type LibraryStatus = 'editing' | 'pending' | 'accepted' | 'succeeded' | 'failed' | 'unknown' | 'not-sent' | 'rejected';
export type ItemReceipt = Readonly<{
    state: 'accepted' | 'rejected' | 'unknown' | 'not-sent';
    resourceId?: string;
    commandId?: string;
    targetId?: string;
}>;
export type LibraryToken = Readonly<{
    id: string;
    attempt: number;
    revision: number;
    context: DispatchContext;
    generation: number;
}>;
export type LibraryDraft = Readonly<{
    id: string;
    owner: LibraryOwner;
    context: DispatchContext;
    generation: number;
    revision: number;
    input: LibraryInput;
    status: LibraryStatus;
    retired: boolean;
    dirty: boolean;
    attempt: number;
    token: LibraryToken | null;
    receipts: readonly ItemReceipt[];
    commandId?: string;
    observation?: string;
    stopRequested: boolean;
    native?: NativeState;
}>;
function freeze<T>(v: T): T {
    if (v && typeof v === 'object' && !(v instanceof Blob)) {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
    }
    return v;
}
const ownerKey = (v: LibraryOwner): string => {
    switch (v.kind) {
        case 'global': return JSON.stringify([v.kind]);
        case 'source': return JSON.stringify([v.kind, v.sourceId]);
        case 'notebook': return JSON.stringify([v.kind, v.notebookId]);
        case 'session': return JSON.stringify([v.kind, ownerKey(v.parent), v.sessionId]);
        case 'profile': return JSON.stringify([v.kind, v.profileType, v.profileId]);
    }
};
export const libraryDraftLocked = (r: LibraryDraft) => r.retired || ['pending', 'accepted', 'unknown', 'failed', 'succeeded'].includes(r.status);
export function createLibraryStore(onChange: () => void) {
    const records = new Map<string, LibraryDraft>();
    const nativeSelections = new Map<string, string | null>();
    const deletedSessions = new Set<string>();
    const notebookOrigins = new Map<string, {
        sourceId: string;
        notebookId: string;
        context: DispatchContext;
        generation: number;
    }>();
    const retiredEpochs = new Set<number>();
    const superseded = new Set<string>(); // Selection metadata only; retained records are never rewritten for recovery.
    const listeners = new Set<() => void>();
    let snapshot: readonly LibraryDraft[] = Object.freeze([]);
    const emit = () => { snapshot = Object.freeze([...records.values()]); listeners.forEach(f => f()); onChange(); };
    const set = (r: LibraryDraft) => { records.set(r.id, freeze(r)); emit(); };
    const current = (r: LibraryDraft, c: DispatchContext | null, g: number) => !r.retired && !superseded.has(r.id) && !retiredEpochs.has(r.context.epoch) && canDispatch(r.context, c) && r.generation === g;
    const definitelyUnsent = (r: LibraryDraft) => ['editing', 'not-sent', 'rejected'].includes(r.status) && !r.receipts.some(x => x.state === 'accepted' || x.state === 'unknown');
    const canFresh = (r: LibraryDraft, c: DispatchContext | null, g: number) => !!c?.ready && !superseded.has(r.id) && !retiredEpochs.has(c.epoch) && !current(r, c, g) && definitelyUnsent(r);
    const sameInput = (a: LibraryInput, b: LibraryInput) => a.kind === b.kind && (a.kind !== 'native-session' || b.kind === 'native-session' && a.action === b.action && a.sessionId === b.sessionId) && (a.kind !== 'action' || b.kind === 'action' && a.action === b.action && a.sourceId === b.sourceId && a.notebookId === b.notebookId && a.insightId === b.insightId);
    const match = (r: LibraryDraft | undefined, t: LibraryToken) => !!r && r.token === t;
    return {
        get: (id: string) => records.get(id), getSnapshot: () => snapshot, subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
        current, canFresh, isSuperseded: (id: string) => superseded.has(id),
        rememberNotebookSource(sourceId: string, notebookId: string, c: DispatchContext, g: number) {
            const id = crypto.randomUUID();
            notebookOrigins.set(id, { sourceId, notebookId, context: freezeDispatchContext(c), generation: g });
            return id;
        },
        sourceNotebookOrigin(id: unknown, sourceId: string, c: DispatchContext | null, g: number) { const r = typeof id === 'string' ? notebookOrigins.get(id) : undefined; return r && r.sourceId === sourceId && canDispatch(r.context, c) && r.generation === g && !retiredEpochs.has(r.context.epoch) ? r.notebookId : undefined; },
        nativeDeleted(p: NativeParent, sid: string) { return deletedSessions.has(parentKey(p) + sid); },
        deleteNative(p: NativeParent, sid: string) {
            deletedSessions.add(parentKey(p) + sid);
            if (nativeSelections.get(parentKey(p)) === sid)
                nativeSelections.set(parentKey(p), null);
            emit();
        },
        nativeSelection(p: NativeParent) { return nativeSelections.get(parentKey(p)) ?? null; },
        selectNative(p: NativeParent, sid: string | null) { nativeSelections.set(parentKey(p), sid); emit(); },
        nativeRead(id: string, c: DispatchContext | null, g: number) {
            const r = records.get(id);
            if (!r || !current(r, c, g))
                return null;
            const sequence = (r.native?.readSequence ?? 0) + 1;
            set({ ...r, native: { ...r.native, readSequence: sequence } });
            return { sequence, revision: r.revision };
        },
        nativeHydrate(id: string, read: {
            sequence: number;
            revision: number;
        }, value: NativeSession, c: DispatchContext | null, g: number) {
            const r = records.get(id);
            if (!r || r.input.kind !== 'native-chat' || (r.input.sessionId ?? r.native?.session?.id) !== value.id || !current(r, c, g) || r.native?.readSequence !== read.sequence || r.revision !== read.revision || r.status === 'pending')
                return;
            if (!ownsSession(r.input.parent, value)) {
                if (r.input.parent.kind === 'notebook' && value.notebook_id === null)
                    set({ ...r, native: { ...r.native, inspection: value } });
                return;
            }
            const verifiedState = { ...r.native };
            delete verifiedState.inspection;
            if (r.status === 'unknown') {
                set({ ...r, native: { ...verifiedState, checked: value.messages ?? [] } });
                return;
            }
            const baseline = r.native?.confirmed;
            const incoming = value.messages ?? [];
            const kept = baseline?.sessionId === value.id && incoming.length < baseline.messages.length ? r.native?.messages ?? baseline.messages : incoming;
            set({ ...r, native: { ...verifiedState, session: value, messages: kept, indicators: value.context_indicators ?? null } });
        },
        nativeOutput(id: string, t: LibraryToken, patch: NativeState, c: DispatchContext | null, g: number) {
            const r = records.get(id);
            if (!r || !match(r, t) || !current(r, c, g) || r.status !== 'pending' || r.stopRequested)
                return;
            set({ ...r, native: { ...r.native, ...patch, readSequence: (r.native?.readSequence ?? 0) + 1 } });
        },
        nativeReceipt(id: string, t: LibraryToken, value: NativeSession) {
            const r = records.get(id);
            if (r && match(r, t) && ['pending', 'unknown'].includes(r.status))
                set({ ...r, native: { ...r.native, session: value } });
        },
        stopNative(id: string) {
            const r = records.get(id);
            if (r?.input.kind === 'native-chat' && r.status === 'pending')
                set({ ...r, status: 'unknown', stopRequested: true });
        },
        open(owner: LibraryOwner, input: LibraryInput, c: DispatchContext, g: number) {
            const existing = [...records.values()].reverse().find(r => !superseded.has(r.id) && ownerKey(r.owner) === ownerKey(owner) && sameInput(r.input, input) && !['succeeded', 'failed'].includes(r.status));
            if (existing) {
                const pristine = existing.status === 'editing' && !existing.dirty && existing.attempt === 0 && existing.receipts.length === 0;
                const nativeRetry = input.kind === 'native-session' && current(existing, c, g) && ['not-sent', 'rejected'].includes(existing.status) && definitelyUnsent(existing);
                if (!nativeRetry && (!pristine || !canFresh(existing, c, g)))
                    return existing.id;
                // Explicit native retries get a new owner/token; the prior captured attempt is immutable.
                superseded.add(existing.id);
            }
            const id = crypto.randomUUID();
            // A successor editor carries completion evidence, not a claim that its later GET is fresh.
            const predecessor = input.kind === 'native-chat' && input.sessionId ? [...records.values()].reverse().find(r => r.input.kind === 'native-chat' && parentKey(r.input.parent) === parentKey(input.parent) && r.status === 'succeeded' && current(r, c, g) && r.native?.confirmed?.sessionId === input.sessionId) : undefined;
            const native = predecessor?.native ? { ...predecessor.native, readSequence: 0 } : undefined;
            set({ ...(native ? { native } : {}), id, owner: { ...owner }, context: freezeDispatchContext(c), generation: g, revision: 0, input: { ...input }, status: 'editing', retired: retiredEpochs.has(c.epoch), dirty: input.kind === 'import' && !!(input.title || input.text || input.urls || input.files.length), attempt: 0, token: null, receipts: [], stopRequested: false });
            return id;
        },
        fresh(id: string, input: LibraryInput, c: DispatchContext, g: number) {
            const r = records.get(id);
            if (!r || !canFresh(r, c, g) || !sameInput(r.input, input))
                return null;
            superseded.add(r.id);
            return this.open(r.owner, input, c, g);
        },
        edit(id: string, patch: Partial<LibraryInput>) {
            const r = records.get(id);
            if (!r || superseded.has(id) || libraryDraftLocked(r))
                return;
            set({ ...r, input: { ...r.input, ...patch, kind: r.input.kind } as LibraryInput, revision: r.revision + 1, dirty: true, status: 'editing' });
        },
        reset(id: string, input: LibraryInput) {
            const r = records.get(id);
            if (!r || superseded.has(id) || libraryDraftLocked(r) || r.input.kind !== input.kind)
                return;
            set({ ...r, input, status: 'editing', dirty: false, revision: r.revision + 1 });
        },
        begin(id: string, c: DispatchContext | null, g: number) {
            const r = records.get(id);
            if (!r || !current(r, c, g) || !['editing', 'not-sent', 'rejected'].includes(r.status))
                return null;
            const token = Object.freeze({ id, attempt: r.attempt + 1, revision: r.revision, context: r.context, generation: g });
            const row = { ...r, token, status: 'pending' as const, attempt: token.attempt, stopRequested: false };
            set(row);
            return records.get(id)!;
        },
        item(id: string, t: LibraryToken, index: number, receipt: ItemReceipt, c: DispatchContext | null, g: number) {
            const r = records.get(id);
            if (!match(r, t) || !r || !['pending', 'unknown'].includes(r.status) || index !== r.receipts.length)
                return;
            set({ ...r, receipts: [...r.receipts, r.status !== 'unknown' && current(r, c, g) ? receipt : { ...receipt, state: 'unknown' }] });
        },
        finish(id: string, t: LibraryToken, status: LibraryStatus, c: DispatchContext | null, g: number, commandId?: string) {
            const r = records.get(id);
            if (!match(r, t) || !r || !['pending', 'accepted', 'unknown'].includes(r.status))
                return;
            const next = r.status !== 'unknown' && current(r, c, g) ? status : 'unknown';
            const confirmed = next === 'succeeded' && r.input.kind === 'native-chat' && r.native?.session && ownsSession(r.input.parent, r.native.session) ? { sessionId: r.native.session.id, messages: r.native.messages ?? [], token: t } : undefined;
            set({ ...r, ...(confirmed ? { native: { ...r.native, confirmed } } : {}), status: next, dirty: !['succeeded', 'failed'].includes(next), ...(commandId ? { commandId } : {}), ...(next === 'accepted' ? { observation: 'pending' } : {}) });
        },
        observe(id: string, t: LibraryToken, status: string, c: DispatchContext | null, g: number) {
            const r = records.get(id);
            if (!r || !match(r, t) || !current(r, c, g) || r.status !== 'accepted')
                return;
            const next = status === 'completed' ? 'succeeded' : ['failed', 'canceled', 'cancelled', 'error'].includes(status) ? 'failed' : ['queued', 'running', 'pending', 'new'].includes(status) ? 'accepted' : 'unknown';
            set({ ...r, observation: status, status: next, dirty: !['succeeded', 'failed'].includes(next) });
        },
        stop(id: string) {
            const r = records.get(id);
            if (r && ['pending', 'accepted'].includes(r.status))
                set({ ...r, stopRequested: true });
        },
        retire(epoch: number) {
            retiredEpochs.add(epoch);
            for (const r of records.values())
                if (r.context.epoch === epoch)
                    records.set(r.id, freeze({ ...r, retired: true, status: ['pending', 'accepted'].includes(r.status) ? 'unknown' : r.status }));
            emit();
        },
        refreshFences(c: DispatchContext | null, g: number) {
            let changed = false;
            for (const r of records.values())
                if (['pending', 'accepted'].includes(r.status) && !current(r, c, g)) {
                    records.set(r.id, freeze({ ...r, status: 'unknown' }));
                    changed = true;
                }
            if (changed)
                emit();
        },
        hasUnsaved: () => [...records.values()].some(r => r.dirty || ['pending', 'accepted', 'unknown'].includes(r.status))
    };
}
export type LibraryStore = ReturnType<typeof createLibraryStore>;
