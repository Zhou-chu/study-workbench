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
