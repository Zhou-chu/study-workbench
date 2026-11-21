import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
vi.mock('@/lib/hooks/use-notebooks', () => ({ useNotebookDeletePreview: () => ({ data: { note_count: 0, shared_source_count: 0, exclusive_source_count: 0 } }), useDeleteNotebook: () => ({ isPending: false, mutateAsync: vi.fn() }) }))
it('uses semantic destructive foreground for the notebook confirmation override', () => {
  render(<NotebookDeleteDialog open onOpenChange={vi.fn()} notebookId="synthetic" notebookName="Synthetic" />)
  expect(screen.getByRole('button', { name: 'common.delete' })).toHaveClass('bg-destructive', 'text-destructive-foreground')
})
