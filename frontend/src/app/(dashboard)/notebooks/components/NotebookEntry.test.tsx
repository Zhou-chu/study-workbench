import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotebookResponse } from '@/lib/types/api'
import { NotebookCard } from './NotebookCard'
import { NotebookRow } from './NotebookRow'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/hooks/use-notebooks', () => ({ useUpdateNotebook: () => ({ mutate: vi.fn() }) }))
vi.mock('./NotebookDeleteDialog', () => ({ NotebookDeleteDialog: () => null }))
const notebook: NotebookResponse = {
  id: 'notebook:one', name: 'Course notes', description: 'Read and study', archived: false,
  created: '2026-01-01T00:00:00Z', updated: '2026-01-02T00:00:00Z', source_count: 1, note_count: 0,
}
beforeEach(() => push.mockReset())
describe.each([['card', NotebookCard, 'workbench.open'], ['row', NotebookRow, notebook.name]] as const)('%s study entry', (_name, Component, accessibleName) => {
  it('provides a direct keyboard-accessible workbench link without triggering legacy navigation', () => {
    render(<Component notebook={notebook} />)
    const link = screen.getByRole('link', { name: accessibleName })
    expect(link).toHaveAttribute('href', '/notebooks/notebook%3Aone/study')
    expect(link.tagName).toBe('A')
    expect(link).toHaveProperty('tabIndex', 0)
    link.focus()
    expect(link).toHaveFocus()
    // Prevent jsdom navigation; a card link must not also trigger its wrapper router.
    link.addEventListener('click', event => event.preventDefault())
    fireEvent.click(link)
    expect(push).not.toHaveBeenCalled()
    // A native keyboard-activated anchor emits a zero-detail click. This is a
    // DOM handler regression, not a browser assertion that jsdom synthesizes Enter.
    fireEvent.click(link, { detail: 0 })
    expect(push).not.toHaveBeenCalled()
  })

  it('keeps the entire notebook identity in one encoded path segment, not a query or fragment', () => {
    const id = 'notebook:course/notes?source=other#section'
    render(<Component notebook={{ ...notebook, id }} />)
    const link = screen.getByRole('link', { name: accessibleName })
    expect(link).toHaveAttribute('href', '/notebooks/notebook%3Acourse%2Fnotes%3Fsource%3Dother%23section/study')
    const target = new URL(link.getAttribute('href')!, 'https://example.test')
    expect(target.search).toBe('')
    expect(target.hash).toBe('')
    expect(decodeURIComponent(target.pathname.split('/')[2])).toBe(id)
  })
})

it('uses the row title and visible workbench hint as one link, with actions outside it', () => {
  render(<NotebookRow notebook={notebook} />)
  const link = screen.getByRole('link', { name: notebook.name })
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(link).toContainElement(screen.getByText('workbench.open'))
  expect(link).toContainElement(screen.getByText(notebook.name))
  const actions = screen.getByRole('button', { name: 'common.actions' })
  expect(link).not.toContainElement(actions)
  actions.focus()
  expect(actions).toHaveFocus()
  fireEvent.click(actions)
  expect(push).not.toHaveBeenCalled()
})
