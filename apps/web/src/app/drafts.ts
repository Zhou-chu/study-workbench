import { navigationDecision, type EditorModel } from '@study/domain';
export type DraftId = Readonly<{
    epoch: number;
    notebookId: string;
    editorSession: string;
}>;
export type DraftState = Readonly<{
    id: DraftId;
    editor?: EditorModel;
    question?: string;
    file?: File | null;
    retired: boolean;
}>;
const key = (id: DraftId) => JSON.stringify([id.epoch, id.notebookId, id.editorSession]);
export function createDraftRegistry() {
    const drafts = new Map<string, DraftState>();
    const retired = new Set<number>();
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(fn => fn());
    return { get: (id: DraftId) => drafts.get(key(id)), isRetired: (id: DraftId) => retired.has(id.epoch), update(id: DraftId, patch: Partial<Pick<DraftState, 'editor' | 'question' | 'file'>>) {
            if (retired.has(id.epoch) || patch.editor && patch.editor.notebookId !== id.notebookId)
                return;
            drafts.set(key(id), Object.freeze({ ...drafts.get(key(id)), ...patch, id: Object.freeze({ ...id }), retired: false }));
            notify();
        }, retireContext(epoch: number) { retired.add(epoch); for (const [k, draft] of drafts)
            if (draft.id.epoch === epoch)
                drafts.set(k, Object.freeze({ ...draft, retired: true })); notify(); },
        hasUnsaved: () => [...drafts.values()].some(d => !!(d.editor?.dirty || d.editor?.pending || d.question || d.file)),
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}
export type DraftRegistry = ReturnType<typeof createDraftRegistry>;
export type NavigationIntent = Readonly<{
    destination: string;
    opener?: HTMLElement | null;
}>;
type Capture = Readonly<{
    id: DraftId;
    revision: number | undefined;
    draft: DraftState;
    activation: number;
    intent: NavigationIntent;
}>;
export function createNavigationController(registry: DraftRegistry) {
    let active: DraftId | null = null;
    let activation = 0;
    let capture: Capture | null = null;
    let status: 'confirm' | 'blocked' | null = null;
    const listeners = new Set<() => void>();
    let snapshot: Readonly<{
        status: 'confirm' | 'blocked' | null;
        capture: Capture | null;
    }> = { status: null, capture: null };
    const notify = () => { snapshot = Object.freeze({ status, capture }); listeners.forEach(fn => fn()); };
    const decision = (draft: DraftState | undefined) => navigationDecision({ targetChanged: true, dirty: !!(draft?.editor?.dirty || draft?.question || draft?.file), saving: !!draft?.editor?.pending, unknown: !!draft?.editor && ['unknown', 'conflict', 'rejected'].includes(draft.editor.saveResult) });
    return { registry, getSnapshot: () => snapshot, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        activate(id: DraftId | null) { if ((active && id ? key(active) === key(id) : active === id))
            return; active = id ? Object.freeze({ ...id }) : null; activation++; capture = null; status = null; notify(); },
        requestNavigation(intent: NavigationIntent): 'allow' | 'confirm' | 'blocked' {
            const draft = active ? registry.get(active) : undefined;
            const result = decision(draft);
            capture = active && draft && result !== 'allow' ? Object.freeze({ id: active, revision: draft.editor?.revision, draft, activation, intent: Object.freeze({ ...intent }) }) : null;
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
            if (!original || !active || activation !== original.activation || key(active) !== key(original.id))
                return null;
            const draft = registry.get(active);
            if (draft !== original.draft || draft.editor?.revision !== original.revision || decision(draft) !== 'confirm')
                return null;
            return original.intent;
        }, cancel(expected: Capture | null = capture) { if (expected !== capture)
            return; const opener = capture?.intent.opener; capture = null; status = null; notify(); queueMicrotask(() => opener?.focus()); }, };
}
export type NavigationController = ReturnType<typeof createNavigationController>;
