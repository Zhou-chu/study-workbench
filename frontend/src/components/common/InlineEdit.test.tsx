import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { InlineEdit } from './InlineEdit'

function edit(onSave = vi.fn()) {
  render(<InlineEdit value="Original" onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Original' }))
  const input = screen.getByRole('textbox')
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: 'Changed' } })
  return input
}

it('submits once when Enter and blur happen before React commits saving state', async () => {
  let done!: () => void
  const save = vi.fn(() => new Promise<void>(resolve => { done = resolve }))
  const input = edit(save)
  act(() => { fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input) })
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith('Changed')
  await act(async () => done())
})

it('does not submit cancelled text when Escape and blur happen in the same batch', () => {
  const save = vi.fn()
  const input = edit(save)
  act(() => { fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.blur(input) })
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Original' })).toHaveFocus()
})

it('does not submit Enter used to confirm IME composition', () => {
  const save = vi.fn()
  const input = edit(save)
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
  expect(save).not.toHaveBeenCalled()
  expect(input).toHaveValue('Changed')
})


it('rolls a failed save back to the latest parent value, not a stale captured value', async () => {
  let reject!: (reason: Error) => void
  const save = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  const view = render(<InlineEdit value="Original" onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Original' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  view.rerender(<InlineEdit value="Fresh server value" onSave={save} />)
  await act(async () => reject(new Error('Rejected')))
  expect(screen.getByRole('textbox')).toHaveValue('Fresh server value')
  expect(screen.getByRole('textbox')).not.toBeDisabled()
})

it('handles a rejected save and permits one explicit retry without a leaked rejection', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Rejected')).mockResolvedValueOnce(undefined)
  const input = edit(save)
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  expect(input).toHaveValue('Original')
  expect(input).not.toBeDisabled()
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: 'Retry' } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  expect(save.mock.calls).toEqual([['Changed'], ['Retry']])
  expect(screen.getByRole('button')).toHaveFocus()
})

it('retains multiline Enter and submits trimmed text on blur without stealing focus', async () => {
  let done!: () => void
  const save = vi.fn(() => new Promise<void>(resolve => { done = resolve }))
  render(<><InlineEdit value="Original" multiline onSave={save} /><button>Next action</button></>)
  fireEvent.click(screen.getByRole('button', { name: 'Original' }))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '  first\nsecond  ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(save).not.toHaveBeenCalled()
  act(() => { screen.getByRole('button', { name: 'Next action' }).focus() })
  expect(save).toHaveBeenCalledWith('first\nsecond')
  await act(async () => done())
  expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
})

it('does not let an unmounted save acknowledgement close or alter a replacement editor', async () => {
  let done!: () => void
  const save = vi.fn(() => new Promise<void>(resolve => { done = resolve }))
  const view = render(<InlineEdit key="old" value="Old" onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Old' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Old draft' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  view.rerender(<InlineEdit key="new" value="New" onSave={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'New' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New draft' } })
  await act(async () => done())
  expect(screen.getByRole('textbox')).toHaveValue('New draft')
  expect(screen.getByRole('textbox')).toHaveFocus()
})

it('closes an unchanged edit without saving', () => {
  const save = vi.fn()
  render(<InlineEdit value="Original" onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Original' }))
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Original' })).toHaveFocus()
})


it('does not reclaim focus when the user leaves during an Enter-triggered save', async () => {
  let done!: () => void
  const save = vi.fn(() => new Promise<void>(resolve => { done = resolve }))
  render(<><InlineEdit value="Original" onSave={save} /><button>Next action</button></>)
  fireEvent.click(screen.getByRole('button', { name: 'Original' }))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Changed' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  act(() => { screen.getByRole('button', { name: 'Next action' }).focus() })
  await act(async () => done())
  expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus()
})
