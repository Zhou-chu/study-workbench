import { canDispatch, freezeDispatchContext, type DispatchContext } from '@study/domain';
import type { Model } from '../../data/configuration-contracts';
import { transformationKeys, type Transformation, type TransformationFields, type TransformationPatch, type TransformationOutput, type ExecuteTransformation } from '../../data/transformation-contracts';
export type ModelsCapture = Readonly<{
    ownerId: string;
    metadataRevision: number;
    sourceRevision: number;
    model: Model;
}>;
type ReadState = Readonly<{
    phase: 'loading' | 'ready' | 'error';
    revision: number;
}>;
export type TransformationEditor = Readonly<{
    id: string;
    target: string | null;
    baseline: TransformationFields | null;
    fields: TransformationFields;
    revision: number;
    open: boolean;
    read: ReadState | null;
}>;
export type TransformationIntent = Readonly<{
    kind: 'instructions';
    value: string;
}> | Readonly<{
    kind: 'create';
    editorId: string;
    input: TransformationFields;
}> | Readonly<{
    kind: 'update';
    editorId: string;
    target: string;
    input: TransformationPatch;
}> | Readonly<{
    kind: 'delete';
    target: string;
    title: string;
}> | Readonly<{
    kind: 'execute';
    input: ExecuteTransformation;
    title: string;
}>;
export type TransformationToken = Readonly<{
    id: string;
    ownerId: string;
    resourceId: string;
    target: string;
    context: DispatchContext;
    generation: number;
    providerRevision: number;
    controlRevision: number;
    listRevision: number | null;
    resourceReadRevision: number | null;
    models: ModelsCapture | null;
    intent: TransformationIntent;
}>;
export type TransformationAttempt = Readonly<{
    token: TransformationToken;
    phase: 'pending' | 'confirmed' | 'unknown' | 'not-sent';
    httpStatus?: number;
    output?: TransformationOutput;
}>;
export type TransformationDraft = Readonly<{
    id: string;
    context: DispatchContext;
    retired: boolean;
    dirty: boolean;
    status: 'editing' | 'pending' | 'unknown' | 'succeeded';
    tab: 'list' | 'playground';
    expanded: readonly string[];
    instructionsOpen: boolean;
    list: readonly Transformation[];
    listRead: ReadState | null;
    instructions: Readonly<{
        id: string;
        value: string;
        baseline: string | null;
        revision: number;
        read: ReadState | null;
    }>;
    editor: TransformationEditor | null;
    playground: Readonly<{
        id: string;
        transformationId: string;
        modelId: string;
        input: string;
        revision: number;
    }>;
    attempts: readonly TransformationAttempt[];
}>;
const blankFields = (): TransformationFields => Object.freeze({ name: '', title: '', description: '', prompt: '', apply_default: false, model_id: null });
export const editorDirty = (e: TransformationEditor | null) => !!e && transformationKeys.some(k => e.fields[k] !== (e.baseline ?? blankFields())[k]);
export const editorPatch = (e: TransformationEditor): TransformationPatch => Object.freeze(Object.fromEntries(transformationKeys.filter(k => !e.baseline || e.fields[k] !== e.baseline[k]).map(k => [k, e.fields[k]])));
const fields = (r: Transformation): TransformationFields => Object.freeze(Object.fromEntries(transformationKeys.map(k => [k, r[k]])) as TransformationFields);
export function createTransformationStore(notify: () => void) {
    const rows = new Map<string, TransformationDraft>();
    let selected: string | null = null;
    let snapshot: readonly TransformationDraft[] = Object.freeze([]);
    const put = (r: TransformationDraft) => {
        const pending = r.attempts.some(a => a.phase === 'pending'), unknown = r.attempts.some(a => a.phase === 'unknown');
        rows.set(r.id, Object.freeze({ ...r, dirty: editorDirty(r.editor) || r.instructions.value !== (r.instructions.baseline ?? '') || !!(r.playground.input || r.playground.transformationId || r.playground.modelId), status: pending ? 'pending' : unknown ? 'unknown' : r.attempts.some(a => a.phase === 'confirmed') ? 'succeeded' : 'editing' }));
        snapshot = Object.freeze([...rows.values()]);
        notify();
    };
    const usable = (r: TransformationDraft | undefined, c: DispatchContext | null): r is TransformationDraft => !!r && !r.retired && canDispatch(r.context, c);
    const create = (context: DispatchContext) => {
        const id = 'transformation-draft:' + crypto.randomUUID();
        selected = id;
        put({ id, context: freezeDispatchContext(context), retired: false, dirty: false, status: 'editing', tab: 'list', expanded: [], instructionsOpen: false, list: [], listRead: null,
            instructions: { id: crypto.randomUUID(), value: '', baseline: null, revision: 0, read: null }, editor: null,
            playground: { id: crypto.randomUUID(), transformationId: '', modelId: '', input: '', revision: 0 }, attempts: [] });
        return id;
    };
    const blocked = (r: TransformationDraft, target: string) => [...rows.values()].some(other => canDispatch(other.context, r.context) && other.attempts.some(a => a.token.target === target && ['pending', 'unknown'].includes(a.phase)));
    const revision = (r: TransformationDraft, i: TransformationIntent) => i.kind === 'instructions' ? r.instructions.revision : i.kind === 'create' || i.kind === 'update' ? r.editor?.revision : i.kind === 'execute' ? r.playground.revision : r.listRead?.revision;
    const resource = (r: TransformationDraft, i: TransformationIntent) => i.kind === 'instructions' ? r.instructions.id : i.kind === 'create' || i.kind === 'update' ? r.editor?.id : i.kind === 'execute' ? r.playground.id : r.id;
    return {
        get: (id: string) => rows.get(id), getSnapshot: () => snapshot, selected: () => selected,
        open(c: DispatchContext) { return selected ?? (c.ready ? create(c) : null); },
        select(id: string) { const r = rows.get(id); if (!r)
            return false; selected = id; put(r); return true; },
        fresh(id: string, c: DispatchContext) { if (!rows.get(id)?.retired || !c.ready)
            return null; const live = [...rows.values()].find(r => usable(r, c)); if (live) {
            selected = live.id;
            put(live);
            return live.id;
        } return create(c); },
        view(id: string, patch: Partial<Pick<TransformationDraft, 'tab' | 'expanded' | 'instructionsOpen'>>) { const r = rows.get(id); if (r)
            put({ ...r, ...patch }); },
        instructions(id: string, value: string) { const r = rows.get(id); if (r && !r.retired)
            put({ ...r, instructions: { ...r.instructions, value, revision: r.instructions.revision + 1 } }); },
        playground(id: string, patch: Partial<Pick<TransformationDraft['playground'], 'transformationId' | 'modelId' | 'input'>>) { const r = rows.get(id); if (r && !r.retired)
            put({ ...r, playground: { ...r.playground, ...patch, revision: r.playground.revision + 1 } }); },
        editor(id: string, target: string | null) {
            const r = rows.get(id);
            if (!r || r.retired || r.editor && (editorDirty(r.editor) || blocked(r, r.editor.target ?? 'create')))
                return false;
            put({ ...r, editor: { id: crypto.randomUUID(), target, baseline: null, fields: blankFields(), revision: 0, open: true, read: target === null ? null : { phase: 'loading', revision: 1 } } });
            return true;
        },
        showEditor(id: string, open: boolean) { const r = rows.get(id); if (r?.editor)
            put({ ...r, editor: { ...r.editor, open } }); },
        edit(id: string, patch: Partial<TransformationFields>) { const r = rows.get(id); if (r?.editor && !r.retired)
            put({ ...r, editor: { ...r.editor, fields: Object.freeze({ ...r.editor.fields, ...patch }), revision: r.editor.revision + 1 } }); },
        discardEditor(id: string) { const r = rows.get(id); if (r?.editor && !r.retired && !blocked(r, r.editor.target ?? 'create'))
            put({ ...r, editor: null }); },
        detail(id: string, editorId: string, value: Transformation | null) {
            const r = rows.get(id), e = r?.editor;
            if (!r || r.retired || !e || e.id !== editorId || e.read?.phase !== 'loading')
                return;
            if (value && value.id !== e.target)
                return;
            put({ ...r, editor: { ...e, read: { phase: value ? 'ready' : 'error', revision: e.read.revision }, ...(value && e.revision === 0 ? { baseline: fields(value), fields: fields(value) } : {}) } });
        },
        loading(id: string, name: 'list' | 'instructions') {
            const r = rows.get(id);
            if (!r || r.retired)
                return null;
            const previous = name === 'list' ? r.listRead : r.instructions.read;
            const read: ReadState = { phase: 'loading', revision: (previous?.revision ?? 0) + 1 };
            put(name === 'list' ? { ...r, listRead: read } : { ...r, instructions: { ...r.instructions, read } });
            return Object.freeze({ revision: read.revision, controlRevision: r.instructions.revision });
        },
        publishList(id: string, revision: number, value: readonly Transformation[] | null) { const r = rows.get(id); if (!r || r.retired || r.listRead?.revision !== revision)
            return; put({ ...r, list: value ?? r.list, listRead: { phase: value ? 'ready' : 'error', revision } }); },
        publishInstructions(id: string, read: Readonly<{
            revision: number;
            controlRevision: number;
        }>, value: string | null) {
            const r = rows.get(id);
            if (!r || r.retired || r.instructions.read?.revision !== read.revision)
                return;
            const i = r.instructions, adopt = value !== null && i.revision === read.controlRevision && i.value === (i.baseline ?? '') && !blocked(r, 'instructions');
            put({ ...r, instructions: { ...i, read: { phase: value === null ? 'error' : 'ready', revision: read.revision }, ...(value !== null && !blocked(r, 'instructions') ? { baseline: value } : {}), ...(adopt ? { value } : {}) } });
        },
        locked(id: string, target: string) { const r = rows.get(id); return !r || r.retired || blocked(r, target); },
        capture(id: string, intent: TransformationIntent, c: DispatchContext | null, g: number, p: number, models: ModelsCapture | null): TransformationToken | null {
            const r = rows.get(id);
            if (!usable(r, c))
                return null;
            const target = intent.kind === 'instructions' ? 'instructions' : intent.kind === 'create' ? 'create' : intent.kind === 'execute' ? 'execute' : intent.target;
            const rev = revision(r, intent), rid = resource(r, intent);
            if (blocked(r, target) || rev === undefined || !rid)
                return null;
            // A stale rendered callback must not receive current revisions for old inputs.
            if (intent.kind === 'instructions' && intent.value !== r.instructions.value)
                return null;
            if (intent.kind === 'execute' && (intent.input.transformation_id !== r.playground.transformationId || intent.input.model_id !== r.playground.modelId || intent.input.input_text !== r.playground.input || intent.title !== r.list.find(v => v.id === intent.input.transformation_id)?.title))
                return null;
            if (intent.kind === 'delete' && intent.title !== r.list.find(v => v.id === intent.target)?.title)
                return null;
            if (intent.kind === 'create' && (!r.editor || r.editor.target !== null || transformationKeys.some(k => intent.input[k] !== r.editor!.fields[k])))
                return null;
            if (intent.kind === 'update') {
                if (!r.editor || r.editor.target !== intent.target)
                    return null;
                const expected = editorPatch(r.editor), keys = Object.keys(intent.input);
                if (keys.length !== Object.keys(expected).length || keys.some(k => intent.input[k as keyof TransformationPatch] !== expected[k as keyof TransformationPatch]))
                    return null;
            }
            if ((intent.kind === 'execute' || intent.kind === 'delete') && (r.listRead?.phase !== 'ready' || !r.list.some(v => v.id === (intent.kind === 'execute' ? intent.input.transformation_id : intent.target))))
                return null;
            if (intent.kind === 'instructions' && r.instructions.read?.phase !== 'ready')
                return null;
            if ((intent.kind === 'create' || intent.kind === 'update') && (r.editor?.id !== intent.editorId || intent.kind === 'update' && r.editor.read?.phase !== 'ready'))
                return null;
            if (intent.kind === 'execute' && (!models || models.model.id !== intent.input.model_id || models.model.type !== 'language' || !intent.input.input_text.trim()))
                return null;
            const copied = Object.freeze({ ...intent, ...('input' in intent ? { input: Object.freeze({ ...intent.input }) } : {}) }) as TransformationIntent;
            return Object.freeze({ id: crypto.randomUUID(), ownerId: id, resourceId: rid, target, context: r.context, generation: g, providerRevision: p, controlRevision: rev,
                listRevision: intent.kind === 'execute' || intent.kind === 'delete' ? r.listRead!.revision : null, resourceReadRevision: intent.kind === 'instructions' ? r.instructions.read!.revision : intent.kind === 'update' ? r.editor!.read!.revision : null, models: models ? Object.freeze({ ...models, model: Object.freeze({ ...models.model }) }) : null, intent: copied });
        },
        canBegin(token: TransformationToken, c: DispatchContext | null, g: number, p: number, models: ModelsCapture | null) {
            const r = rows.get(token.ownerId);
            if (!usable(r, c) || selected !== r.id || r.attempts.some(a => a.token.id === token.id) || blocked(r, token.target) || g !== token.generation || p !== token.providerRevision || revision(r, token.intent) !== token.controlRevision || resource(r, token.intent) !== token.resourceId)
                return false;
            if (token.listRevision !== null && (r.listRead?.phase !== 'ready' || r.listRead.revision !== token.listRevision))
                return false;
            if (token.resourceReadRevision !== null) {
                const read = token.intent.kind === 'instructions' ? r.instructions.read : r.editor?.read;
                if (read?.phase !== 'ready' || read.revision !== token.resourceReadRevision) return false;
            }
            if (token.models && (!models || JSON.stringify(token.models) !== JSON.stringify(models)))
                return false;
            return true;
        },
        begin(token: TransformationToken, c: DispatchContext | null, g: number, p: number, models: ModelsCapture | null) { if (!this.canBegin(token, c, g, p, models))
            return false; const r = rows.get(token.ownerId)!; put({ ...r, attempts: Object.freeze([...r.attempts, Object.freeze({ token, phase: 'pending' as const })]) }); return true; },
        settle(token: TransformationToken, phase: TransformationAttempt['phase'], c: DispatchContext | null, g: number, result?: Transformation | string | TransformationOutput, httpStatus?: number) {
            const r = rows.get(token.ownerId);
            if (!r || !r.attempts.some(a => a.token === token && a.phase === 'pending'))
                return false;
            const actual = usable(r, c) && g === token.generation ? phase : 'unknown';
            let instructions = r.instructions, editor = r.editor;
            if (actual === 'confirmed' && token.intent.kind === 'instructions' && typeof result === 'string')
                instructions = { ...instructions, baseline: result, read: { phase: 'ready', revision: (instructions.read?.revision ?? 0) + 1 } };
            if (actual === 'confirmed' && (token.intent.kind === 'create' || token.intent.kind === 'update') && typeof result === 'object' && 'prompt' in result && editor?.id === token.intent.editorId) {
                editor = { ...editor, target: result.id, baseline: fields(result), fields: editor.revision === token.controlRevision ? fields(result) : editor.fields, read: { phase: 'ready', revision: (editor.read?.revision ?? 0) + 1 }, open: editor.revision === token.controlRevision ? false : editor.open };
            }
            const output = actual === 'confirmed' && token.intent.kind === 'execute' && typeof result === 'object' && 'output' in result ? result : undefined;
            put({ ...r, instructions, editor, attempts: Object.freeze(r.attempts.map(a => a.token === token ? Object.freeze({ token, phase: actual, ...(output ? { output } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}) }) : a)) });
            return actual === 'confirmed';
        },
        retire(epoch: number) { for (const r of rows.values())
            if (r.context.epoch === epoch)
                put({ ...r, retired: true, attempts: Object.freeze(r.attempts.map(a => a.phase === 'pending' ? Object.freeze({ ...a, phase: 'unknown' as const }) : a)) }); },
        hasUnsaved: () => [...rows.values()].some(r => r.dirty || ['pending', 'unknown'].includes(r.status))
    };
}
