import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteResponse } from '@/lib/types/api'
import { NotesColumn } from './NotesColumn'

interface MockNoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: NoteResponse
}

vi.mock('./NoteEditorDialog', () => ({
  NoteEditorDialog: ({
    open,
    onOpenChange,
    notebookId,
    note,
  }: MockNoteEditorDialogProps) => (
    <div
      data-testid="note-editor-dialog"
      data-open={String(open)}
      data-notebook-id={notebookId}
      data-note-id={note?.id ?? ''}
    >
      <button onClick={() => onOpenChange(false)}>close editor</button>
    </div>
  ),
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useDeleteNote: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/stores/notebook-columns-store', () => ({
  useNotebookColumnsStore: () => ({
    notesCollapsed: false,
    toggleNotes: vi.fn(),
  }),
}))

const notebookId = 'notebook:123'
const existingNote: NoteResponse = {
  revision: 1,
  id: 'note:456',
  title: 'Existing note',
  content: 'Existing note content',
  note_type: 'human',
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

function renderNotes(notes: NoteResponse[]) {
  render(
    <NotesColumn
      notes={notes}
      isLoading={false}
      notebookId={notebookId}
    />
  )
  return screen.getByTestId('note-editor-dialog')
}

describe('NotesColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens, closes, and reopens the editor in create mode with loaded notes', () => {
    const editor = renderNotes([existingNote])

    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-notebook-id', notebookId)
    expect(editor).toHaveAttribute('data-note-id', '')

    fireEvent.click(screen.getByText('close editor'))
    expect(editor).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('common.writeNote'))
    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('opens the editor in create mode when the notes list is empty', () => {
    const editor = renderNotes([])

    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-notebook-id', notebookId)
    expect(editor).toHaveAttribute('data-note-id', '')
  })

  it('clears the selected note before opening the editor in create mode', () => {
    const editor = renderNotes([existingNote])

    fireEvent.click(screen.getByText(existingNote.title!))
    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', existingNote.id)

    fireEvent.click(screen.getByText('close editor'))
    fireEvent.click(screen.getByText('common.writeNote'))

    expect(editor).toHaveAttribute('data-open', 'true')
    expect(editor).toHaveAttribute('data-note-id', '')
  })
})

describe('existing note native selection', () => {
  it('offers a focusable native button and synthetic detail-zero activation', () => {
    const editor = renderNotes([existingNote])
    const open = screen.getByRole('button', { name: existingNote.title! })
    expect(open.tagName).toBe('BUTTON')
    open.focus()
    expect(open).toHaveFocus()
    expect(open).toHaveAttribute('type', 'button')
    fireEvent.click(open, { detail: 0 })
    expect(editor).toHaveAttribute('data-note-id', existingNote.id)
    expect(editor).toHaveAttribute('data-open', 'true')
  })
})

describe('note secondary controls', () => {
  it('opens delete menu by keyboard and cancels without opening editor', async () => {
    const editor = renderNotes([existingNote])
    const menu = screen.getByRole('button', { name: 'notebooks.deleteNote' })
    menu.focus()
    fireEvent.keyDown(menu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'notebooks.deleteNote' }))
    expect(editor).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(editor).toHaveAttribute('data-open', 'false')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
  it('changes context independently and keeps controls outside selection button', () => {
    const change = vi.fn()
    const { container } = render(<NotesColumn notes={[existingNote]} isLoading={false} notebookId={notebookId}
      contextSelections={{ [existingNote.id]: 'off' }} onContextModeChange={change} />)
    const control = container.querySelector('svg.lucide-eye-off')?.closest('button')
    expect(control).not.toBeNull()
    fireEvent.click(control!)
    expect(change).toHaveBeenCalledExactlyOnceWith(existingNote.id, 'full')
    expect(screen.getByTestId('note-editor-dialog')).toHaveAttribute('data-open', 'false')
    expect(container.querySelector('button button')).toBeNull()
  })
  it('gives untitled notes a nonempty translated selection name', () => {
    renderNotes([{ ...existingNote, title: '' }])
    expect(screen.getByRole('button', { name: 'sources.untitledNote' })).toBeInTheDocument()
  })
})
