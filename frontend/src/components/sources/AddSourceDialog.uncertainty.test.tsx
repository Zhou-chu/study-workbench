import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AddSourceDialog } from './AddSourceDialog'
import { toast } from 'sonner'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('@/lib/hooks/use-sources', () => ({ useCreateSource: () => ({ mutateAsync, isPending: false }) }))
vi.mock('@/lib/hooks/use-notebooks', () => ({ useNotebooks: () => ({ data: [] }) }))
vi.mock('@/lib/hooks/use-transformations', () => ({ useTransformations: () => ({ data: [] }) }))
vi.mock('@/lib/hooks/use-settings', () => ({ useSettings: () => ({ data: undefined }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('./steps/SourceTypeStep', () => ({
  SourceTypeStep: ({ register }: { register: (name: string) => object }) => <>
    <select aria-label="type" {...register('type')}><option value="link">link</option><option value="text">text</option></select>
    <textarea aria-label="urls" {...register('url')} />
  </>,
  parseAndValidateUrls: (value: string) => ({ valid: value.split('\n').filter(Boolean), invalid: [] }),
}))
vi.mock('./steps/NotebooksStep', () => ({ NotebooksStep: () => null }))
vi.mock('./steps/ProcessingStep', () => ({ ProcessingStep: () => null }))

describe('source creation uncertainty', () => {
  it('stops the batch without summary failure/success and retains inputs on close and reopen', async () => {
    mutateAsync.mockRejectedValue({ response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'private-secret',
    } } } })
    const close = vi.fn()
    const view = render(<AddSourceDialog open onOpenChange={close} />)
    const urls = 'https://example.test/one\nhttps://example.test/two'
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'link' } })
    fireEvent.change(screen.getByLabelText('urls'), { target: { value: urls } })
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
    await screen.findByText('commandSubmission.warning')
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('urls')).toHaveValue(urls)
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    view.rerender(<AddSourceDialog open={false} onOpenChange={close} />)
    view.rerender(<AddSourceDialog open onOpenChange={close} />)
    expect(screen.getByLabelText('urls')).toHaveValue(urls)
    expect(screen.getByText('commandSubmission.warning')).toBeInTheDocument()
  })
  it('retains the draft when closed before a delayed uncertainty response', async () => {
    mutateAsync.mockClear()
    let reject!: (error: unknown) => void
    mutateAsync.mockReturnValue(new Promise((_, rejectPromise) => { reject = rejectPromise }))
    const close = vi.fn()
    const view = render(<AddSourceDialog open onOpenChange={close} />)
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'link' } })
    fireEvent.change(screen.getByLabelText('urls'), { target: { value: 'https://example.test/retained' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    view.rerender(<AddSourceDialog open={false} onOpenChange={close} />)
    await act(async () => reject({ response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false,
    } } } }))
    view.rerender(<AddSourceDialog open onOpenChange={close} />)
    expect(screen.getByLabelText('urls')).toHaveValue('https://example.test/retained')
    expect(screen.getByText('commandSubmission.warning')).toBeInTheDocument()
  })

})
