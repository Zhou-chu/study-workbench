import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { NotebookResponse } from '@/lib/types/api'
import { NotebookRow } from './NotebookRow'

const { push, mutate } = vi.hoisted(() => ({ push: vi.fn(), mutate: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))
vi.mock('@/lib/hooks/use-notebooks', () => ({ useUpdateNotebook: () => ({ mutate }) }))
vi.mock('./NotebookDeleteDialog', () => ({ NotebookDeleteDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="delete confirmation" /> : null }))
const notebook = { id: 'notebook:with space', name: 'Research', description: 'Readable description', source_count: 3, note_count: 2, updated: '2026-01-01', archived: false } as NotebookResponse
beforeEach(() => vi.clearAllMocks())

it('makes the whole primary content a native link instead of mouse-only routing', () => {
  render(<NotebookRow notebook={notebook} />)
  const description = screen.getByText('Readable description')
  const link = description.closest('a')
  expect(link).not.toBeNull()
  expect(link).toHaveAttribute('href', '/notebooks/notebook%3Awith%20space/study')
  expect(link).toContainElement(screen.getByText('Research'))
  expect(link).toContainElement(screen.getByText('3'))
  expect(link).not.toContainElement(screen.getByRole('button', { name: 'common.actions' }))
  if (!link) throw new Error('Primary link missing')
  const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
  let interceptedByApp = true
  // Observe application handling before suppressing jsdom's unsupported navigation.
  document.addEventListener('click', event => {
    interceptedByApp = event.defaultPrevented
    event.preventDefault()
  }, { once: true })
  link.dispatchEvent(modified)
  expect(interceptedByApp).toBe(false)
  expect(push).not.toHaveBeenCalled()
})

it('keeps keyboard focus on native navigation and menu controls without nested controls', async () => {
  render(<NotebookRow notebook={notebook} />)
  const link = screen.getByRole('link', { name: 'Research' })
  link.focus()
  expect(link).toHaveFocus()
  expect(link.tabIndex).toBe(0)
  expect(link.querySelector('button,a')).toBeNull()
  const menu = screen.getByRole('button', { name: 'common.actions' })
  menu.focus()
  expect(menu).toHaveFocus()
})

it('keeps archive and delete independent of navigation', async () => {
  render(<NotebookRow notebook={notebook} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'common.actions' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('menuitem', { name: 'notebooks.archive' }))
  expect(mutate).toHaveBeenCalledWith({ id: notebook.id, data: { archived: true } })
  expect(push).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('button', { name: 'common.actions' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('menuitem', { name: 'common.delete' }))
  expect(screen.getByRole('dialog', { name: 'delete confirmation' })).toBeInTheDocument()
  expect(push).not.toHaveBeenCalled()
})
