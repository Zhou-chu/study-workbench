import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchSourcesList } from './WorkbenchSourcesList'

const sources = [{ source_id: 's1', title: 'Source title', versions: [{ source_version_id: 'v1', created_at: '2026-10-28', original_status: 'available' }] }]
function setup() {
  const onRead = vi.fn(), onSelectionChange = vi.fn()
  const view = render(<div data-workbench-controls><WorkbenchSourcesList notebookId="n1" sources={sources} selectedVersionIds={[]} onRead={onRead} onSelectionChange={onSelectionChange} onUpload={vi.fn()} /></div>)
  return { ...view, onRead, onSelectionChange }
}

describe('authored workspace touch constraints (not browser geometry)', () => {
  it('keeps the full selection label clickable without triggering Read', () => {
    const { onRead, onSelectionChange } = setup()
    const date = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date('2026-10-28T00:00:00Z'))
    fireEvent.click(screen.getByText(date))
    expect(onSelectionChange).toHaveBeenCalledWith(['v1'])
    expect(onRead).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.read' }))
    expect(onRead).toHaveBeenCalledWith('v1')
    expect(onSelectionChange).toHaveBeenCalledTimes(1)
  })
})
