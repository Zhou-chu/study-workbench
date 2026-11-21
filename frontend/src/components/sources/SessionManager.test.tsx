import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from './SessionManager'

vi.mock('@/lib/hooks/use-models', () => ({ useModels: () => ({ data: [] }) }))
const session = { id: 'session:one', title: 'First conversation', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' }
function setup() {
  const select = vi.fn(), update = vi.fn(), remove = vi.fn()
  render(<SessionManager sessions={[session]} currentSessionId={session.id}
    onCreateSession={vi.fn()} onSelectSession={select} onUpdateSession={update}
    onDeleteSession={remove} loadingSessions={false} />)
  return { select, update, remove }
}
describe('SessionManager native selection', () => {
  it('exposes selected native button with focus and synthetic detail-zero click', () => {
    const { select } = setup()
    const button = screen.getByRole('button', { name: session.title })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button, { detail: 0 })
    expect(select).toHaveBeenCalledExactlyOnceWith(session.id)
  })
  it('edits with Enter and cancels with Escape without selecting', () => {
    const { select, update } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const input = screen.getByDisplayValue(session.title)
    fireEvent.change(input, { target: { value: '  Revised  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(update).toHaveBeenCalledExactlyOnceWith(session.id, 'Revised')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.change(screen.getByDisplayValue(session.title), { target: { value: 'Discard' } })
    fireEvent.keyDown(screen.getByDisplayValue('Discard'), { key: 'Escape' })
    expect(screen.queryByDisplayValue('Discard')).not.toBeInTheDocument()
    expect(update).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
  })
  it('cancels deletion without selecting or deleting', () => {
    const { select, remove } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'chat.deleteSession' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(select).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('IME composition boundaries', () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])('does not save or cancel composing edit: %j', composition => {
    const { update } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const input = screen.getByDisplayValue(session.title)
    fireEvent.change(input, { target: { value: '中文标题' } })
    fireEvent.keyDown(input, { key: 'Enter', ...composition })
    expect(update).not.toHaveBeenCalled()
    expect(input).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape', ...composition })
    expect(input).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 })
    expect(update).toHaveBeenCalledExactlyOnceWith(session.id, '中文标题')
  })
  it.each([{ isComposing: true }, { keyCode: 229 }])('does not create during composition: %j', composition => {
    const create = vi.fn()
    const { container } = render(<SessionManager sessions={[]} currentSessionId={null}
      onCreateSession={create} onSelectSession={vi.fn()} onUpdateSession={vi.fn()}
      onDeleteSession={vi.fn()} loadingSessions={false} />)
    fireEvent.click(container.querySelector('svg.lucide-plus')!.closest('button')!)
    const input = screen.getByPlaceholderText('chat.sessionTitlePlaceholder')
    fireEvent.change(input, { target: { value: '中文会话' } })
    fireEvent.keyDown(input, { key: 'Enter', ...composition })
    fireEvent.keyDown(input, { key: 'Escape', ...composition })
    expect(create).not.toHaveBeenCalled()
    expect(input).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 })
    expect(create).toHaveBeenCalledExactlyOnceWith('中文会话')
  })
})
