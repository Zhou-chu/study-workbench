import { isRecord } from '@study/contracts';
import { RequestNotDispatchedError } from '@study/web-transport';
export type Transformation = Readonly<{
    id: string;
    name: string;
    title: string;
    description: string;
    prompt: string;
    apply_default: boolean;
    model_id: string | null;
    created: string;
    updated: string;
}>;
export type TransformationFields = Readonly<Pick<Transformation, 'name' | 'title' | 'description' | 'prompt' | 'apply_default' | 'model_id'>>;
export type TransformationPatch = Readonly<Partial<Omit<TransformationFields, 'description'>> & {
    description?: string | null;
}>;
export type TransformationOutput = Readonly<{
    output: string;
    transformation_id: string;
    model_id: string | null;
}>;
export type ExecuteTransformation = Readonly<{
    transformation_id: string;
    input_text: string;
    model_id: string;
}>;
export const transformationKeys = ['name', 'title', 'description', 'prompt', 'apply_default', 'model_id'] as const;
const record = (v: unknown) => { if (!isRecord(v))
    throw Error('Invalid transformation response'); return v; };
const text = (v: unknown) => { if (typeof v !== 'string')
    throw Error('Invalid transformation text'); return v; };
export const transformationId = (v: unknown) => { const s = text(v); if (!s.trim() || s.length > 500 || /[\\/\u0000-\u001f]/.test(s))
    throw Error('Invalid transformation identity'); return s; };
export function parseTransformation(v: unknown): Transformation {
    const r = record(v);
    if (typeof r.apply_default !== 'boolean')
        throw Error('Invalid transformation flag');
    return Object.freeze({ id: transformationId(r.id), name: text(r.name), title: text(r.title), description: text(r.description), prompt: text(r.prompt), apply_default: r.apply_default, model_id: r.model_id === undefined || r.model_id === null ? null : transformationId(r.model_id), created: text(r.created), updated: text(r.updated) });
}
export function parseTransformations(v: unknown) {
    if (!Array.isArray(v))
        throw Error('Invalid transformations list');
    const result = v.map(parseTransformation);
    if (new Set(result.map(r => r.id)).size !== result.length)
        throw Error('Duplicate transformation identity');
    return Object.freeze(result);
}
export function parseTransformationInstructions(v: unknown) { return text(record(v).transformation_instructions); }
export function transformationBody(input: TransformationPatch, create = false): TransformationPatch {
    const keys = Object.keys(input);
    if (!keys.length || keys.some(k => !transformationKeys.includes(k as typeof transformationKeys[number])) || create && transformationKeys.some(k => !Object.hasOwn(input, k)))
        throw new RequestNotDispatchedError('configuration');
    for (const k of keys as (typeof transformationKeys[number])[]) {
        const value = input[k];
        if (k === 'apply_default' ? typeof value !== 'boolean' : k === 'model_id' ? value !== null && (typeof value !== 'string' || !value.trim()) : k === 'description' ? typeof value !== 'string' && (create || value !== null) : typeof value !== 'string' || !value.trim())
            throw new RequestNotDispatchedError('configuration');
    }
    if (input.model_id !== undefined && input.model_id !== null)
        transformationId(input.model_id);
    return Object.freeze({ ...input });
}
export function matchTransformation(value: unknown, input: TransformationPatch, id?: string) {
    const r = parseTransformation(value);
    if (id !== undefined && r.id !== id || transformationKeys.some(k => Object.hasOwn(input, k) && r[k] !== (k === 'description' && input[k] === null ? '' : input[k])))
        throw Error('Unconfirmed transformation save');
    return r;
}
export function parseTransformationOutput(v: unknown, original: ExecuteTransformation): TransformationOutput {
    const r = record(v), output = text(r.output), model_id = r.model_id === null || r.model_id === undefined ? null : transformationId(r.model_id);
    if (r.transformation_id !== original.transformation_id || model_id !== null && model_id !== original.model_id || !output.trim())
        throw Error('Unmatched transformation output');
    return Object.freeze({ output, transformation_id: original.transformation_id, model_id });
}
