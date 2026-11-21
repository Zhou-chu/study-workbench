import { describe, expect, it, vi } from 'vitest'
import { parseCommandSubmissionUnknown, runCommandSubmission } from './command-submission'
import { resources } from '@/lib/locales'

const unknown = { response: { status: 409, data: { detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'private-secret', resource_id: 'source:one', resource_type: 'source' } } } }
describe('command submission uncertainty', () => {
  it('accepts only the structured contract and excludes unsafe text and fake job identity', () => {
    expect(parseCommandSubmissionUnknown(unknown)).toEqual({ resource_id: 'source:one', resource_type: 'source' })
    for (const value of [null, 'COMMAND_SUBMISSION_UNKNOWN', { response: { status: 500, data: unknown.response.data } }, { response: { status: 409, data: { detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: true } } } }]) expect(parseCommandSubmissionUnknown(value)).toBeNull()
  })
  it('latches across callers and requires an explicit new-attempt acknowledgment', async () => {
    const send = vi.fn().mockRejectedValueOnce(unknown).mockResolvedValue('accepted')
    await expect(runCommandSubmission('test:unknown', send, 'cost acknowledgment')).rejects.toBe(unknown)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await expect(runCommandSubmission('test:unknown', send, 'cost acknowledgment')).rejects.toBeDefined()
    expect(send).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    expect(await runCommandSubmission('test:unknown', send, 'cost acknowledgment')).toBe('accepted')
    expect(confirm).toHaveBeenCalledWith('cost acknowledgment')
    confirm.mockRestore()
  })
  it('gates retry of a retained source without inventing a command identity', async () => {
    await expect(runCommandSubmission('source:create', async () => { throw unknown }, 'ack')).rejects.toBe(unknown)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const retry = vi.fn()
    await expect(runCommandSubmission('source:retry:source:one', retry, 'ack')).rejects.toBeDefined()
    expect(retry).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
  it('does not latch definite rejection', async () => {
    const send = vi.fn().mockRejectedValueOnce({ response: { status: 422 } }).mockResolvedValue('ok')
    await expect(runCommandSubmission('test:validation', send, 'ack')).rejects.toBeDefined()
    expect(await runCommandSubmission('test:validation', send, 'ack')).toBe('ok')
  })
  it('has every warning and acknowledgment in all 14 locales', () => {
    expect(Object.keys(resources)).toHaveLength(14)
    for (const locale of Object.values(resources)) {
      for (const key of ['title', 'warning', 'newAttemptConfirm', 'sessionOnly', 'observing', 'newAttemptError']) {
        expect((locale.translation as unknown as { commandSubmission: Record<string,string> }).commandSubmission[key]).toBeTruthy()
      }
    }
  })
})
