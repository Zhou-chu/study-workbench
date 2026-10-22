import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { AddSourceDialog } from './AddSourceDialog'
import { runCommandSubmission } from '@/lib/utils/command-submission'

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

it('keeps the unresolved batch draft after an acknowledged new attempt is definitely rejected', async () => {
  const send = vi.fn()
    .mockRejectedValueOnce({ response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false,
    } } } })
    .mockRejectedValue({ response: { status: 422 } })
  mutateAsync.mockImplementation(() => runCommandSubmission('source:create', send, 'commandSubmission.newAttemptConfirm'))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const close = vi.fn()
  const view = render(<AddSourceDialog open onOpenChange={close} />)
  const urls = 'https://example.test/one\nhttps://example.test/two'
  fireEvent.change(screen.getByLabelText('type'), { target: { value: 'link' } })
  fireEvent.change(screen.getByLabelText('urls'), { target: { value: urls } })
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
  await screen.findByText('commandSubmission.warning')
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(3))
  view.rerender(<AddSourceDialog open={false} onOpenChange={close} />)
  view.rerender(<AddSourceDialog open onOpenChange={close} />)
  expect(toast.error).toHaveBeenCalledWith('sources.batchFailed', { description: 'commandSubmission.newAttemptError' })
  expect(confirm).toHaveBeenCalledWith('commandSubmission.newAttemptConfirm')
  expect(screen.getByText('commandSubmission.warning')).toBeInTheDocument()
  expect(screen.getByLabelText('urls')).toHaveValue(urls)
  confirm.mockRestore()
})
