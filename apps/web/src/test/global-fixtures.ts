import { libraryServer } from './library-harness';
import { json } from './notebook-fixtures';
export const globalNotebooks = ['alpha', 'beta', 'gamma'].map(k => ({ id: 'notebook:' + k + ':full', name: k[0]!.toUpperCase() + k.slice(1), description: 'Synthetic', archived: false, created: '2026-11-08', updated: '2026-11-08', source_count: 0, note_count: 0 }));
export const askEvents = [
    { type: 'strategy', reasoning: 'Plan carefully', searches: [{ term: 'proof', instructions: 'Read evidence' }] },
    { type: 'answer', content: 'Intermediate one' }, { type: 'answer', content: 'Intermediate two' },
    { type: 'final_answer', content: 'Final answer [source:alpha:full]' },
    { type: 'complete', final_answer: 'Final answer [source:alpha:full]' }
];
export const askStream = (events: unknown[] = askEvents) => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
export function globalServer(handler?: (r: Request) => Response | undefined | Promise<Response | undefined>) {
    return libraryServer(async (r) => {
        const custom = await handler?.(r);
        if (custom !== undefined)
            return custom;
        const p = decodeURIComponent(new URL(r.url).pathname);
        if (p === '/api/notebooks')
            return json(globalNotebooks);
        if (p === '/api/models')
            return json([{ id: 'model:language', name: 'Language', type: 'language' }, { id: 'model:other', name: 'Other', type: 'language' }, { id: 'model:embed', name: 'Embedding', type: 'embedding' }]);
        if (p === '/api/models/defaults')
            return json({ default_chat_model: 'model:language', default_embedding_model: 'model:embed' });
        if (p === '/api/search')
            return json({ results: [{ id: 'source:alpha:full', parent_id: 'source:alpha:full', title: 'Raw source', relevance: 2 }, { id: 'note:one:full', parent_id: 'note:one:full', title: 'Raw note', similarity: .8, matches: [{ content: 'Found passage', similarity: .8 }] }, { id: 'source_insight:one:full', parent_id: 'source:alpha:full', title: 'Raw insight', score: .5 }, { id: 'unknown:full', title: 'Unknown result' }], total_count: 4, search_type: 'text' });
        if (p === '/api/search/ask')
            return askStream();
        if (p === '/api/notes/note:one:full')
            return json({ id: 'note:one:full', title: null, content: 'Detached body', note_type: 'human', revision: 3, created: '2026-11-08', updated: '2026-11-08' });
        if (p === '/api/insights/source_insight:one:full')
            return json({ id: 'source_insight:one:full', source_id: 'source:alpha:full', insight_type: 'Summary', content: 'Insight body', created: null, updated: null });
        if (p === '/api/notes' && r.method === 'POST') {
            const b = await r.clone().json();
            return json({ id: 'note:saved:' + b.notebook_id.split(':')[1], title: b.title, content: b.content, note_type: 'ai', revision: 1, created: '2026-11-08', updated: '2026-11-08', command_id: null });
        }
    });
}
