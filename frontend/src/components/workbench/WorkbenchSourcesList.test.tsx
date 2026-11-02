import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WorkbenchSourcesList } from './WorkbenchSourcesList'

it('renders missing version dates and disables versions without an identity', () => {
  const onRead = vi.fn(), onSelectionChange = vi.fn()
  render(<WorkbenchSourcesList notebookId="notebook:synthetic" sources={[{ source_id: 'source:synthetic', title: 'Synthetic', versions: [{ source_version_id: 'sv_known', original_status: 'available' }, { created_at: '2026-10-24', original_status: 'available' }] as never }]} selectedVersionIds={[]} onRead={onRead} onSelectionChange={onSelectionChange} onUpload={vi.fn()} />)
  const boxes = screen.getAllByRole('checkbox')
  expect(boxes[0]).toBeEnabled()
  expect(boxes[1]).toBeDisabled()
  expect(screen.getAllByText('workbench.unavailable').length).toBeGreaterThan(0)
  const readers = screen.getAllByRole('button', { name: 'workbench.read' })
  expect(readers[1]).toBeDisabled()
  fireEvent.click(readers[1]); fireEvent.click(boxes[1])
  expect(onRead).not.toHaveBeenCalled()
  expect(onSelectionChange).not.toHaveBeenCalled()
  fireEvent.click(readers[0]); fireEvent.click(boxes[0])
  expect(onRead).toHaveBeenCalledWith('sv_known')
  expect(onSelectionChange).toHaveBeenCalledWith(['sv_known'])
})

it.each(['status', 'extraction_status'])('treats inherited object keys in opaque %s as unavailable', field => {
  render(<WorkbenchSourcesList notebookId="notebook:synthetic" sources={[{ source_id: 'source:synthetic', title: 'Synthetic', versions: ['toString', '__proto__', 'constructor'].map((status, index) => ({ source_version_id: `sv_${index}`, created_at: '2026-10-24', original_status: 'available', [field]: status })) }]} selectedVersionIds={[]} onRead={vi.fn()} onSelectionChange={vi.fn()} onUpload={vi.fn()} />)
  expect(screen.getAllByText('workbench.unavailable')).toHaveLength(3)
  expect(screen.getAllByRole('checkbox')).toHaveLength(3)
})

it('shows recoverable empty status and hint without disabling selected checkboxes', () => {
  render(<WorkbenchSourcesList notebookId="notebook:synthetic" sources={[{ source_id: 'source:synthetic', title: 'Empty file', versions: [{ source_version_id: 'empty-version', status: 'empty', extraction_status: 'ready', original_status: 'available' }] }]} selectedVersionIds={['empty-version']} onRead={vi.fn()} onSelectionChange={vi.fn()} onUpload={vi.fn()} />)
  expect(screen.getByText('workbench.states.empty')).toBeVisible()
  expect(screen.getByText('workbench.emptySourceHint')).toBeVisible()
  expect(screen.getByRole('checkbox')).toBeChecked(); expect(screen.getByRole('checkbox')).toBeEnabled()
  expect(screen.queryByText('workbench.states.ready')).not.toBeInTheDocument()
})
it('keeps future statuses unavailable rather than authorizing extraction fallback', () => {
  render(<WorkbenchSourcesList notebookId="notebook:synthetic" sources={[{ source_id: 'source:synthetic', title: 'Future file', versions: [{ source_version_id: 'future-version', status: 'future-status', extraction_status: 'ready', original_status: 'available', created_at: '2026-10-24' }] }]} selectedVersionIds={['future-version']} onRead={vi.fn()} onSelectionChange={vi.fn()} onUpload={vi.fn()} />)
  expect(screen.getByText('workbench.unavailable')).toBeVisible()
  expect(screen.queryByText('workbench.states.ready')).not.toBeInTheDocument()
})
