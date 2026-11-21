import { isRecord } from '@study/contracts';
export type NativeParent = {
    kind: 'notebook';
    notebookId: string;
} | {
    kind: 'source';
    sourceId: string;
};
export type ContextConfig = {
    sources: Record<string, 'not in' | 'insights' | 'full content'>;
    notes: Record<string, 'not in' | 'full content'>;
};
export type NativeMessage = {
    provisional?: boolean;
    id: string;
    type: string;
    content: string;
    timestamp?: string | null;
};
export type Indicators = {
    sources: string[];
    insights: string[];
    notes: string[];
};
export type NativeSession = {
    id: string;
    title: string;
    created: string;
    updated: string;
    model_override?: string | null;
    message_count?: number | null;
    notebook_id?: string | null;
    source_id?: string;
    messages?: NativeMessage[];
    context_indicators?: Indicators | null;
};
export const parentId = (p: NativeParent) => p.kind === 'notebook' ? p.notebookId : p.sourceId;
export const parentKey = (p: NativeParent) => JSON.stringify([p.kind, parentId(p)]);
const invalid = (): never => { throw new Error('Invalid native chat response'); };
const text = (v: unknown): string => typeof v === 'string' ? v : invalid();
const ident = (v: unknown) => { const s = text(v); return s.trim() && !/[\\/\u0000-\u001f]/.test(s) ? s : invalid(); };
export function messages(v: unknown): NativeMessage[] { if (!Array.isArray(v))
    return invalid(); return v.map(v => { if (!isRecord(v))
    return invalid(); return { id: ident(v.id), type: text(v.type), content: text(v.content), ...(v.timestamp === undefined ? {} : { timestamp: v.timestamp === null ? null : text(v.timestamp) }) }; }); }
export function indicators(v: unknown): Indicators { if (!isRecord(v))
    return invalid(); const a = (v: unknown) => Array.isArray(v) ? v.map(text) : invalid(); return { sources: a(v.sources), insights: a(v.insights), notes: a(v.notes) }; }
export function session(v: unknown, p: NativeParent, expected?: string, detail = false): NativeSession {
    if (!isRecord(v))
        return invalid();
    const r: NativeSession = { id: ident(v.id), title: text(v.title), created: text(v.created), updated: text(v.updated) };
    if (expected && r.id !== expected)
        return invalid();
    if (p.kind === 'notebook')
        r.notebook_id = v.notebook_id == null ? null : ident(v.notebook_id);
    else {
        r.source_id = ident(v.source_id);
        if (r.source_id !== p.sourceId)
            return invalid();
    }
    if (v.model_override !== undefined)
        r.model_override = v.model_override === null ? null : text(v.model_override);
    if (v.message_count !== undefined) {
        if (v.message_count !== null && (!Number.isSafeInteger(v.message_count) || Number(v.message_count) < 0))
            return invalid();
        r.message_count = v.message_count as number | null;
    }
    if (detail)
        r.messages = messages(v.messages);
    if (v.context_indicators !== undefined)
        r.context_indicators = v.context_indicators === null ? null : indicators(v.context_indicators);
    return r;
}
export const ownsSession = (p: NativeParent, s: NativeSession) => p.kind === 'notebook' ? s.notebook_id === p.notebookId : s.source_id === p.sourceId;
export const emptyContext = (): ContextConfig => ({ sources: {}, notes: {} });
