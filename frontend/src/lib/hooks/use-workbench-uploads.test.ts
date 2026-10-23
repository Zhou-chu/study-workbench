import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { workbenchApi } from '@/lib/api/workbench'
import { useWorkbenchUploads } from './use-workbench-uploads'
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { upload: vi.fn() } }))
const files = (file: File) => [file] as unknown as FileList
beforeEach(() => vi.resetAllMocks())
it('blocks duplicate clicks and re-selection while pending; releases accepted files', async () => {
  let resolve!: (value: never) => void
  vi.mocked(workbenchApi.upload).mockImplementation(() => new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  const file = new File(['hi'], 'a.txt')
  let upload!: Promise<void>
  act(() => { upload = result.current.upload(files(file), 'source:original') })
  const id = result.current.uploads[0].id
  await act(async () => {
    await result.current.retryUpload(id)
    await result.current.upload(files(file), 'source:original')
    result.current.dismissUpload(id)
  })
  expect(result.current.uploads).toHaveLength(1)
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({} as never); await upload })
  expect(result.current.uploads[0].state).toBe('uploadAccepted')
  await act(async () => { await result.current.retryUpload(id) })
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
})
it.each([413, 500, undefined])('distinguishes rejection from uncertain outcomes (%s) and forgets dismissed files', async status => {
  vi.mocked(workbenchApi.upload).mockRejectedValue({ isAxiosError: true, response: status ? { status, data: { detail: 'Too large' } } : undefined })
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  await act(async () => { await result.current.upload(files(new File(['hi'], 'a.txt'))) })
  const item = result.current.uploads[0]
  expect(item.state).toBe(status === 413 ? 'uploadFailed' : 'uploadUncertain')
  expect(item.error).toBe(status === 413 ? 'Too large' : null)
  act(() => result.current.dismissUpload(item.id))
  expect(result.current.uploads).toHaveLength(0)
  await act(async () => { await result.current.retryUpload(item.id) })
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
})
it('forgets pending files on unmount and ignores late accepted responses', async () => {
  let resolve!: (value: never) => void
  vi.mocked(workbenchApi.upload).mockImplementation(() => new Promise(done => { resolve = done }))
  const accepted = vi.fn()
  const { result, unmount } = renderHook(() => useWorkbenchUploads('nb', accepted))
  let upload!: Promise<void>
  act(() => { upload = result.current.upload(files(new File(['hi'], 'a.txt'))) })
  const { retryUpload, uploads } = result.current
  unmount()
  await act(async () => { resolve({} as never); await upload; await retryUpload(uploads[0].id) })
  expect(accepted).not.toHaveBeenCalled()
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
})
it('clears recovery rows when switching notebooks and never retries into the new target', async () => {
  vi.mocked(workbenchApi.upload).mockRejectedValue(new Error('response lost'))
  const { result, rerender } = renderHook(({ notebookId }) => useWorkbenchUploads(notebookId, vi.fn()), { initialProps: { notebookId: 'nb:a' } })
  await act(async () => { await result.current.upload(files(new File(['hi'], 'a.txt')), 'source:a') })
  const id = result.current.uploads[0].id
  rerender({ notebookId: 'nb:b' })
  expect(result.current.uploads).toHaveLength(0)
  await act(async () => { await result.current.retryUpload(id) })
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
})

const commitUnknownDetail = { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: false, message: 'private /storage/source.pdf token=secret', source_id: 'source:1', source_version_id: 'sv_unknown' }
it.each([400, 401, 409, 422, 500, 503])('blocks an explicit unsafe outcome regardless of HTTP status (%s)', async status => {
  vi.mocked(workbenchApi.upload).mockRejectedValue({ isAxiosError: true, response: { status, data: { detail: commitUnknownDetail } } })
  const accepted = vi.fn()
  const { result } = renderHook(() => useWorkbenchUploads('nb', accepted))
  const file = new File(['keep'], 'a.txt')
  const lateRetry = result.current.retryUpload
  await act(async () => { await result.current.upload(files(file), 'source:original') })
  const item = result.current.uploads[0]
  expect(item).toMatchObject({ state: 'uploadBlocked', error: null, problem: 'commit-unknown' })
  await act(async () => {
    await result.current.retryUpload(item.id)
    await lateRetry(item.id)
    result.current.dismissUpload(item.id)
    await result.current.upload(files(file), 'source:original')
  })
  expect(result.current.uploads).toHaveLength(1)
  expect(result.current.uploads[0]).toEqual(item)
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
  expect(vi.mocked(workbenchApi.upload).mock.calls[0][1]).toBe(file)
  expect(accepted).not.toHaveBeenCalled()
})
it.each([
  { code: 'UPLOAD_COMMIT_UNKNOWN' },
  { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: true },
  { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: 'false' },
  { code: 'FUTURE_WRITE_OUTCOME', retry_safe: false },
  { code: 'FUTURE_WRITE_OUTCOME', retry_safe: true },
  { code: null, retry_safe: false },
  { retry_safe: false },
  { message: 'private /storage/source.pdf token=secret' },
  [], [null], null, 42, false,
  [{ type: 'missing', loc: [null], msg: 'private token' }],
  [{ type: 'missing', loc: [{}], msg: 'private token' }],
  [{ type: 'missing', loc: ['body', 0.5], msg: 'private token' }],
  [{ type: 'missing', loc: ['body', 'file'], msg: 'private token', retry_safe: false }],
])('fails closed for malformed or unknown structured detail: %j', async detail => {
  vi.mocked(workbenchApi.upload).mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { detail } } })
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  await act(async () => { await result.current.upload(files(new File(['hi'], 'a.txt'))) })
  const item = result.current.uploads[0]
  expect(item).toMatchObject({ state: 'uploadBlocked', error: null, problem: 'unrecognized-detail' })
  await act(async () => { await result.current.retryUpload(item.id) })
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
})
it('keeps a blocked file independent from intentional uploads of other files and targets', async () => {
  vi.mocked(workbenchApi.upload).mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: { detail: commitUnknownDetail } } }).mockResolvedValue({ source_id: 'source:2', source_version_id: 'sv_other', job_id: 'job:other' })
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  const file = new File(['hi'], 'a.txt')
  await act(async () => { await result.current.upload(files(file), 'source:original') })
  await act(async () => {
    await result.current.upload(files(new File(['other'], 'b.txt')), 'source:original')
    await result.current.upload(files(file), 'source:other')
  })
  expect(result.current.uploads.map(item => item.state)).toEqual(['uploadBlocked', 'uploadAccepted', 'uploadAccepted'])
  expect(workbenchApi.upload).toHaveBeenCalledTimes(3)
})
it('preserves explicit transport-loss replay and well-formed validation rejection behavior', async () => {
  vi.mocked(workbenchApi.upload).mockRejectedValueOnce(new Error('response lost')).mockRejectedValueOnce({ isAxiosError: true, response: { status: 422, data: { detail: [{ type: 'missing', loc: ['body', 'file'], msg: 'Field required' }] } } }).mockResolvedValue({ source_id: 'source:1', source_version_id: 'sv_1', job_id: 'job:1' })
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  const file = new File(['hi'], 'a.txt')
  await act(async () => { await result.current.upload(files(file)) })
  const id = result.current.uploads[0].id
  expect(result.current.uploads[0].state).toBe('uploadUncertain')
  await act(async () => { await result.current.retryUpload(id) })
  expect(result.current.uploads[0].state).toBe('uploadFailed')
  await act(async () => { await result.current.retryUpload(id) })
  expect(result.current.uploads[0].state).toBe('uploadAccepted')
  expect(vi.mocked(workbenchApi.upload).mock.calls.every(call => call[1] === file && call[2] === id)).toBe(true)
})

it.each([
  { error: commitUnknownDetail },
  { detail: 'Generic failure', error: commitUnknownDetail },
  { detail: [{ type: 'missing', loc: ['body', 'file'], msg: 'Field required' }], error: commitUnknownDetail },
  { ...commitUnknownDetail, detail: 'Generic failure' },
  { detail: 'Generic failure', error: { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: true, message: 'private token' } },
  { detail: 'Generic failure', error: { code: 'UPLOAD_COMMIT_UNKNOWN', message: 'private token' } },
  { detail: 'Generic failure', error: { code: 'FUTURE_OUTCOME', retry_safe: false, message: 'private token' } },
])('never downgrades explicit unsafe markers through another error envelope: %j', async data => {
  vi.mocked(workbenchApi.upload).mockRejectedValue({ isAxiosError: true, response: { status: 422, data } })
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  await act(async () => { await result.current.upload(files(new File(['hi'], 'a.txt'))) })
  const item = result.current.uploads[0]
  expect(item).toMatchObject({ state: 'uploadBlocked', error: null })
  await act(async () => { await result.current.retryUpload(item.id) })
  expect(workbenchApi.upload).toHaveBeenCalledTimes(1)
})
it('ignores missing or malformed identity/URL hints rather than treating them as proof or navigation', async () => {
  vi.mocked(workbenchApi.upload).mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { detail: { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: false, source_id: { url: 'https://private.invalid/' }, source_version_id: '', message: 'https://private.invalid/?token=secret', retry_url: 'https://private.invalid/retry' } } } })
  const accepted = vi.fn()
  const { result } = renderHook(() => useWorkbenchUploads('nb', accepted))
  await act(async () => { await result.current.upload(files(new File(['hi'], 'a.txt'))) })
  expect(result.current.uploads[0]).toMatchObject({ state: 'uploadBlocked', error: null, problem: 'commit-unknown' })
  expect(JSON.stringify(result.current.uploads)).not.toContain('private.invalid')
  expect(accepted).not.toHaveBeenCalled()
})
it('does not reinterpret an unrelated auth error envelope as the upload contract', async () => {
  vi.mocked(workbenchApi.upload).mockRejectedValue({ isAxiosError: true, response: { status: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'Sign in' } } } })
  const { result } = renderHook(() => useWorkbenchUploads('nb', vi.fn()))
  await act(async () => { await result.current.upload(files(new File(['hi'], 'a.txt'))) })
  expect(result.current.uploads[0]).toMatchObject({ state: 'uploadFailed', error: 'Sign in' })
})
