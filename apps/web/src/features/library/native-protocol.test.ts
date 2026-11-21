import { expect, it, vi } from 'vitest';
import { readSourceStream } from './source-chat-stream';
import { session, messages, indicators, ownsSession } from '../../data/native-chat';
import { nativeSession, sourceSession, stream } from '../../test/classic-fixtures';
it.each([undefined, null])('preserves omitted/null native metadata %s without inventing timestamps or model defaults', value => {
    const parsed = session({ ...nativeSession, model_override: value, message_count: value, messages: [{ id: 'msg_0', type: 'unknown', content: 'Opaque', timestamp: value }] }, { kind: 'notebook', notebookId: 'n' }, nativeSession.id, true);
    expect(parsed.model_override).toBe(value);
    expect(parsed.message_count).toBe(value);
    expect(parsed.messages?.[0]?.timestamp).toBe(value);
});
it('rejects malformed native identities, foreign source parents and unsupported event structures', () => {
    expect(() => session({ ...sourceSession, source_id: 'source:other' }, { kind: 'source', sourceId: 'source:alpha:full' }, sourceSession.id)).toThrow();
    expect(ownsSession({ kind: 'notebook', notebookId: 'n' }, session({ ...nativeSession, notebook_id: null }, { kind: 'notebook', notebookId: 'n' }))).toBe(false);
    for (const value of [null, {}, [{ id: null, type: 'ai', content: 'x' }], [{ id: 'a/b', type: 'ai', content: 'x' }], [{ id: 'one', type: 'ai', content: 42 }]])
        expect(() => messages(value)).toThrow();
    expect(() => indicators({ sources: null, notes: [], insights: [] })).toThrow();
});
it.each([new Response(null, { headers: { 'content-type': 'text/event-stream' } }), new Response('data: {}\n\n', { headers: { 'content-type': 'text/html' } }), stream({ type: 'future' }), stream({ type: 'ai_message', content: 5 }), stream({ type: 'ai_message', content: 'x', timestamp: 42 }, { type: 'complete' }), stream({ type: 'context_indicators', data: { sources: [], notes: null, insights: [] } })])('fails closed on malformed source producer response', async (response) => {
    await expect(readSourceStream(response, new AbortController().signal, () => { })).rejects.toThrow();
});
it('does not read or accept later events after explicit complete and cancels the reader', async () => {
    const cancel = vi.fn(), seen: unknown[] = [];
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"complete"}\n\ndata: {"type":"ai_message","content":"late"}\n\n')); }, cancel }), { headers: { 'content-type': 'text/event-stream' } });
    await readSourceStream(response, new AbortController().signal, e => seen.push(e));
    expect(seen).toEqual([{ type: 'complete' }]);
    expect(cancel).toHaveBeenCalledOnce();
});
