import { configurationServer, configuredModels } from './configuration-fixtures';
import { json } from './notebook-fixtures';
export const transformationFixture = { id: 'transformation:one', name: 'alpha', title: 'First transformation', description: 'Description', prompt: 'Synthetic prompt', apply_default: true, model_id: 'model:chat', created: '2026-11-09', updated: '2026-11-09' };
export function transformationServer(handler?: (r: Request) => Response | undefined | Promise<Response | undefined>) {
    return configurationServer(async (r) => {
        const custom = await handler?.(r);
        if (custom)
            return custom;
        const p = decodeURIComponent(new URL(r.url).pathname);
        if (p === '/api/transformations/default-prompt')
            return json(r.method === 'PUT' ? await r.clone().json() : { transformation_instructions: 'Global instructions' });
        if (p === '/api/transformations/execute')
            return json({ output: 'Synthetic output', transformation_id: transformationFixture.id, model_id: 'model:chat' });
        if (p === '/api/transformations')
            return json(r.method === 'POST' ? { ...transformationFixture, ...await r.clone().json(), id: 'transformation:new' } : [transformationFixture]);
        if (p === '/api/transformations/' + transformationFixture.id)
            return json(r.method === 'DELETE' ? { message: 'Transformation deleted successfully' } : r.method === 'PUT' ? { ...transformationFixture, ...await r.clone().json() } : transformationFixture);
        if (p === '/api/models')
            return json([...configuredModels, { ...configuredModels[0], id: 'model:future', name: 'Future model', type: 'future' }]);
        return undefined;
    });
}
