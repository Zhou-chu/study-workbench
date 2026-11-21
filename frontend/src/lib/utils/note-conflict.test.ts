import { describe, expect, it } from 'vitest'
import { noteWriteProblem, canRetryNoteWrite } from './note-conflict'
import { RequestNotDispatchedError } from '@/lib/api/browser-transport'
describe('known note rejection versus an uncertain dispatched save', () => {
  it('permits only explicit retry for locally branded pre-dispatch rejection', () => {
    expect(noteWriteProblem(new RequestNotDispatchedError('authentication')).kind).toBe('not-sent')
    expect(canRetryNoteWrite(noteWriteProblem(new RequestNotDispatchedError('configuration')))).toBe(true)
    expect(noteWriteProblem({ name: 'RequestNotDispatchedError', code: 'REQUEST_NOT_DISPATCHED' }).kind).toBe('unknown')
  })
  it.each(['AUTH_REQUIRED', 'ACCESS_EXPIRED', 'AUTH_PENDING'])('keeps typed401 %s rejected, not unsent or uncertain, and allows a manual retry', code => {
    const problem = noteWriteProblem({ response: { status: 401, data: { error: { code } } } })
    expect(problem.kind).toBe('auth-rejected'); expect(canRetryNoteWrite(problem)).toBe(true)
  })
  it.each([new Error('lost acknowledgement'), { response: { status: 503 } }, { response: { status: 401, data: '<html>ingress</html>' } }, { response: { status: 409, data: { detail: { code: 'NOTE_REVISION_CONFLICT', current_revision: 4 } } } }])('retains reconciliation for other failures', error => {
    expect(canRetryNoteWrite(noteWriteProblem(error))).toBe(false)
  })
})
