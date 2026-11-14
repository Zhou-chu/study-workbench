import { describe, expect, it } from 'vitest'
import { classifyAuthFailure, classifyIngressResponse, readBoundedAuthError } from './ingress.js'
import { protectedApiPath } from './endpoint-policy.js'

const artifact = '/personal/artifacts/artifact%3Aone/download'
const html = (disposition?: string, status = 200, location?: string) => new Response('document', { status, headers: { 'content-type': 'text/html', ...(disposition === undefined ? {} : { 'content-disposition': disposition }), ...(location ? { location } : {}) } })
describe('ingress trust boundaries', () => {
  it.each([
    [401, 'AUTH_PENDING', 'pending'], [503, 'AUTH_UNAVAILABLE', 'unavailable'],
    [429, 'AUTH_BUSY', 'unavailable'], [401, 'REFRESH_REJECTED', 'reauth-required'],
    [500, 'AUTH_BUSY', null], [200, 'AUTH_REQUIRED', null],
  ])('classifies exact auth status/code %s %s', (status, code, expected) => {
    expect(classifyAuthFailure(status as number, { error: { code } })).toBe(expected)
  })
  it.each([null, [], 'html', { error: null }, { error: 'AUTH_REQUIRED' }, { error: {} }])('treats malformed 401 body as unavailable %j', body => {
    expect(classifyAuthFailure(401, body)).toBe('unavailable')
    expect(classifyAuthFailure(500, body)).toBeNull()
  })
  it.each(['attachment', 'attachment; filename="report.html"', 'ATTACHMENT; filename=report.html; size=12', "attachment; filename*=UTF-8''%E4%B8%AD.html", 'attachment; filename="quoted\\\"name.html"'])('allows valid artifact attachment syntax %s', disposition => {
    expect(classifyIngressResponse(html(disposition), artifact)).toBeNull()
    expect(classifyIngressResponse(html(disposition, 206), artifact)).toBeNull()
  })
  it.each([undefined, 'inline', 'attachmentx', 'attachment;', 'attachment; filename', 'attachment; filename=a; FILENAME=b', "attachment; filename*=iso-8859-1''a", "attachment; filename*=UTF-8''%ZZ", "attachment; filename*=UTF-8''%FF"])('refuses malformed attachment syntax %s', disposition => {
    expect(classifyIngressResponse(html(disposition), artifact)).toBe('ingress-unavailable')
  })
  it('never uses attachment syntax to authorize login HTML or an error/redirect', () => {
    expect(classifyIngressResponse(html('attachment', 401), artifact)).toBe('ingress-unavailable')
    expect(classifyIngressResponse(html('attachment', 200, '/login'), artifact)).toBe('ingress-unavailable')
    expect(classifyIngressResponse(html('attachment'), '/notebooks')).toBe('ingress-unavailable')
  })
  it.each(['/search/ask?q=x', '/personal/jobs/job/events?cursor=2', '/sources/source/chat/sessions/session/messages'])('allows SSE only on a streaming route %s', path => {
    expect(classifyIngressResponse(new Response('event', { headers: { 'content-type': 'text/event-stream' } }), path)).toBeNull()
  })
  it('does not accept an untyped normal response or arbitrary SSE', () => {
    expect(classifyIngressResponse(new Response(null), '/notebooks')).toBe('unexpected-response')
    expect(classifyIngressResponse(new Response('event', { headers: { 'content-type': 'text/event-stream' } }), '/notebooks')).toBe('unexpected-response')
  })
  it('ignores non-JSON, missing body, malformed UTF8 and invalid JSON auth evidence', async () => {
    expect(await readBoundedAuthError(new Response('html'))).toBeNull()
    expect(await readBoundedAuthError(new Response(null, { headers: { 'content-type': 'application/json' } }))).toBeNull()
    expect(await readBoundedAuthError(new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }))).toBeNull()
    expect(await readBoundedAuthError(new Response('{', { headers: { 'content-type': 'application/json' } }))).toBeNull()
  })
  it('bounds auth evidence at 8192 bytes without consuming the original response', async () => {
    const exact = JSON.stringify('x'.repeat(8190))
    const response = new Response(exact, { headers: { 'content-type': 'application/problem+json' } })
    expect(await readBoundedAuthError(response)).toBe('x'.repeat(8190))
    expect(await response.text()).toBe(exact)
    const oversized = new Response(JSON.stringify('x'.repeat(8191)), { headers: { 'content-type': 'application/json' } })
    expect(await readBoundedAuthError(oversized)).toBeNull()
    expect((await oversized.text()).length).toBe(8193)
  })
})
describe('protected path decoding boundaries', () => {
  it.each(['/', '/api', '/%00', '/%5csecret', '/%252525252e%252525252e/secret', '/%ZZ', '/a/%2e%2e/b'])('rejects unsafe normalized path %s', path => {
    expect(() => protectedApiPath(path)).toThrow('Request was not sent')
  })
  it('normalizes only the explicit API prefix and preserves the query', () => {
    expect(protectedApiPath('/api/notebooks?q=a%20b')).toBe('/notebooks?q=a%20b')
  })
})
