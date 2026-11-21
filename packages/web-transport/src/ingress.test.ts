import { expect, it } from 'vitest';
import { classifyIngressResponse } from './ingress.js';
const sse = () => new Response('data: {"type":"complete"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
it('admits only the actual source native message stream path', () => {
    expect(classifyIngressResponse(sse(), '/sources/source%3Aalpha%3Afull/chat/sessions/chat_session%3Aone/messages')).toBeNull();
    for (const path of ['/chat/execute', '/chat/sessions/c/messages', '/sources/s/messages', '/sources/s/chat/sessions/c/messages/other', '/other/sources/s/chat/sessions/c/messages'])
        expect(classifyIngressResponse(sse(), path)).toBe('unexpected-response');
});
it('keeps source stream HTML and redirects unavailable', () => {
    expect(classifyIngressResponse(new Response('<html>', { headers: { 'content-type': 'text/html' } }), '/sources/s/chat/sessions/c/messages')).toBe('ingress-unavailable');
    expect(classifyIngressResponse(new Response(null, { status: 302, headers: { location: '/login' } }), '/sources/s/chat/sessions/c/messages')).toBe('ingress-unavailable');
});

it('admits only the exact Ask stream, keeping neighboring paths closed', () => {
 expect(classifyIngressResponse(sse(), '/search/ask')).toBeNull();
 expect(classifyIngressResponse(sse(), '/search/ask?q=x')).toBeNull();
 for (const path of ['/search','/search/ask/simple','/search/ask/','/other/search/ask','/search/asking']) expect(classifyIngressResponse(sse(),path)).toBe('unexpected-response');
 expect(classifyIngressResponse(new Response('<html>',{headers:{'content-type':'text/html'}}),'/search/ask')).toBe('ingress-unavailable');
});
