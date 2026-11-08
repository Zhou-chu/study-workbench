import { json } from './notebook-fixtures';
import { libraryServer } from './library-harness';
export const nativeSession = { id: 'chat_session:one:full', title: 'Native one', notebook_id: 'n', created: '2026-11-08', updated: '2026-11-08', message_count: 0, model_override: null };
export const sourceSession = { id: 'chat_session:source:full', title: 'Source one', source_id: 'source:alpha:full', created: '2026-11-08', updated: '2026-11-08', message_count: 0, model_override: null };
export const nativeMessages = [{ id: 'human:1', type: 'human', content: 'Question', timestamp: null }, { id: 'ai:1', type: 'ai', content: 'Whole answer', timestamp: null }];
export const classicNote = { id: 'note:one:full', revision: 1, title: 'Notebook note', content: 'Note text', note_type: 'human', created: '2026-11-08', updated: '2026-11-08' };
export const stream = (...events: unknown[]) => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
export function classicServer(custom?: (r: Request) => Response | undefined | Promise<Response | undefined>, workspace?: () => Response) {
    let completed = false;
    return libraryServer(async (r) => {
        const result = await custom?.(r);
        if (result !== undefined)
            return result;
        const p = decodeURIComponent(new URL(r.url).pathname);
        if (p === '/api/notes')
            return json(r.method === 'POST' ? { ...classicNote, title: 'Generated title', note_type: 'ai' } : [classicNote]);
        if (p === '/api/notes/' + classicNote.id)
            return json(classicNote);
        if (p === '/api/models')
            return json([{ id: 'model:chosen', name: 'Chosen language model', type: 'language', provider: 'synthetic' }]);
        if (p === '/api/models/defaults')
            return json({ default_chat_model: null });
        if (p === '/api/chat/context')
            return json({ context: { sources: [], notes: [] }, token_count: 0, char_count: 0 });
        if (p === '/api/chat/execute') {
            completed = true;
            return json({ session_id: nativeSession.id, messages: nativeMessages });
        }
        if (p === '/api/chat/sessions')
            return json(r.method === 'POST' ? nativeSession : [nativeSession]);
        if (p === '/api/chat/sessions/' + nativeSession.id)
            return json(r.method === 'DELETE' ? { success: true, message: 'Session deleted successfully' } : { ...nativeSession, messages: completed ? nativeMessages : [], ...(r.method === 'PUT' ? await r.clone().json() : {}) });
        if (p === '/api/sources/source:alpha:full/chat/sessions')
            return json(r.method === 'POST' ? sourceSession : [sourceSession]);
        if (p === '/api/sources/source:alpha:full/chat/sessions/' + sourceSession.id)
            return json(r.method === 'DELETE' ? { success: true, message: 'Source chat session deleted successfully' } : { ...sourceSession, messages: completed ? nativeMessages : [], context_indicators: null, ...(r.method === 'PUT' ? await r.clone().json() : {}) });
        if (p.endsWith('/messages')) {
            completed = true;
            return stream({ type: 'user_message', content: 'Question', timestamp: null }, { type: 'ai_message', content: 'Whole answer', timestamp: null }, { type: 'complete' });
        }
        return undefined;
    }, workspace);
}
