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
describe.each([['card', NotebookCard], ['row', NotebookRow]] as const)('%s study entry', (_name, Component) => {
  it('provides a direct keyboard-accessible workbench link without triggering legacy navigation', () => {
    render(<Component notebook={notebook} />)
    const link = screen.getByRole('link', { name: 'workbench.open' })
    expect(link).toHaveAttribute('href', '/notebooks/notebook%3Aone/study')
    link.focus()
    expect(link).toHaveFocus()
    // Keep jsdom from navigating; propagation must still be stopped by the component.
    link.addEventListener('click', event => event.preventDefault())
    fireEvent.click(link)
    expect(push).not.toHaveBeenCalled()
  })
})
