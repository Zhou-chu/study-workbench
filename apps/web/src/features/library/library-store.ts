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
export type LibraryInput = ImportInput | MetadataInput | AssociationInput | ExistingInput | ActionInput;
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
    superseded?: boolean;
    dirty: boolean;
    attempt: number;
    token: LibraryToken | null;
    receipts: readonly ItemReceipt[];
    commandId?: string;
    observation?: string;
    stopRequested: boolean;
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
    const listeners = new Set<() => void>();
    let snapshot: readonly LibraryDraft[] = Object.freeze([]);
    const emit = () => { snapshot = Object.freeze([...records.values()]); listeners.forEach(f => f()); onChange(); };
    const set = (r: LibraryDraft) => { records.set(r.id, freeze(r)); emit(); };
    const current = (r: LibraryDraft, c: DispatchContext | null, g: number) => !r.retired && canDispatch(r.context, c) && r.generation === g;
    const match = (r: LibraryDraft | undefined, t: LibraryToken) => !!r && r.token === t;
    return {
        get: (id: string) => records.get(id), getSnapshot: () => snapshot, subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
        current,
        open(owner: LibraryOwner, input: LibraryInput, c: DispatchContext, g: number) {
            const existing = [...records.values()].find(r => !r.superseded && ownerKey(r.owner) === ownerKey(owner) && r.input.kind === input.kind && (input.kind !== 'action' || r.input.kind === 'action' && r.input.action === input.action && r.input.sourceId === input.sourceId && r.input.notebookId === input.notebookId && r.input.insightId === input.insightId) && !['succeeded', 'failed'].includes(r.status));
            if (existing)
                return existing.id;
            const id = crypto.randomUUID();
            set({ id, owner: { ...owner }, context: freezeDispatchContext(c), generation: g, revision: 0, input: { ...input }, status: 'editing', retired: false, dirty: input.kind === 'import' && !!(input.title || input.text || input.urls || input.files.length), attempt: 0, token: null, receipts: [], stopRequested: false });
            return id;
        },
        fresh(id: string, input: LibraryInput, c: DispatchContext, g: number) {
            const r = records.get(id);
            if (!r || !c.ready || current(r, c, g) || !['editing', 'not-sent', 'rejected'].includes(r.status) || r.receipts.some(x => x.state === 'accepted' || x.state === 'unknown') || input.kind !== r.input.kind)
                return null;
            set({ ...r, retired: true, superseded: true });
            return this.open(r.owner, input, c, g);
        },
        edit(id: string, patch: Partial<LibraryInput>) {
            const r = records.get(id);
            if (!r || libraryDraftLocked(r))
                return;
            set({ ...r, input: { ...r.input, ...patch, kind: r.input.kind } as LibraryInput, revision: r.revision + 1, dirty: true, status: 'editing' });
        },
        reset(id: string, input: LibraryInput) {
            const r = records.get(id);
            if (!r || libraryDraftLocked(r) || r.input.kind !== input.kind)
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
            set({ ...r, status: next, dirty: !['succeeded', 'failed'].includes(next), ...(commandId ? { commandId } : {}), ...(next === 'accepted' ? { observation: 'pending' } : {}) });
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
