import { fireEvent, render, screen, within } from '@testing-library/react'
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

it('shows three same-day versions with UTC seconds and distinct prefixes, with an exact ID disclosure per row', () => {
  const onRead = vi.fn(), onSelectionChange = vi.fn()
  const ids = ['abcdefgh1-full', 'abcdefgh2-full', 'abcdefgh3-full']
  const dates = ['2026-11-02T09:00:01Z', '2026-11-02T10:00:01Z', '2026-11-02T10:00:01Z']
  render(<WorkbenchSourcesList notebookId="synthetic" sources={[{ source_id: 's1', title: 'Same-day source', versions: ids.map((source_version_id, index) => ({ source_version_id, created_at: dates[index], status: 'ready', original_status: 'available' })) }]} selectedVersionIds={[]} onRead={onRead} onSelectionChange={onSelectionChange} onUpload={vi.fn()} />)
  const format = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })
  const checkboxes = screen.getAllByRole('checkbox')
  for (const [index, id] of ids.entries()) {
    const label = checkboxes[index].closest('label')!
    expect(within(label).getByText(id.slice(0, 9))).toBeVisible()
    expect(within(label).getByText(format.format(new Date(dates[index])))).toBeVisible()
    const disclosure = screen.getByText(id).closest('details')!
    expect(disclosure).not.toBeNull()
    expect(disclosure.querySelector('summary')).not.toBeNull()
    fireEvent.click(disclosure.querySelector('summary')!)
    const fullId = within(disclosure).getByText(id)
    expect(fullId).toBeVisible()
    expect(fullId).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    expect(fullId).not.toHaveClass('truncate')
    fireEvent.click(checkboxes[index])
    expect(onSelectionChange).toHaveBeenLastCalledWith([id])
    fireEvent.click(screen.getAllByRole('button', { name: 'workbench.read' })[index])
    expect(onRead).toHaveBeenLastCalledWith(id)
  }
})

it('keeps invalid wire dates unavailable rather than rendering or inventing a timestamp', () => {
  const { container } = render(<WorkbenchSourcesList notebookId="synthetic" sources={[{ source_id: 's1', title: 'Invalid dates', versions: ['2026-02-30', 'not-a-date', '2026-11-02T25:00:00Z'].map((created_at, index) => ({ source_version_id: `version-${index}`, created_at, status: 'ready', original_status: 'available' })) }]} selectedVersionIds={[]} onRead={vi.fn()} onSelectionChange={vi.fn()} onUpload={vi.fn()} />)
  expect(container.querySelectorAll('time')).toHaveLength(0)
  for (const checkbox of screen.getAllByRole('checkbox')) expect(within(checkbox.closest('label')!).getByText('workbench.unavailable')).toBeVisible()
})
