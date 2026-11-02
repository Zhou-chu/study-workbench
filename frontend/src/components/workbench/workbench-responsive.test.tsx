import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchSourcesList } from './WorkbenchSourcesList'
import { workbenchRules, lengthPixels } from '@/test/workbench-css'

const sources = [{ source_id: 's1', title: 'Source title', versions: [{ source_version_id: 'v1', created_at: '2026-10-28', original_status: 'available' }] }]
function setup() {
  const onRead = vi.fn(), onSelectionChange = vi.fn()
  const view = render(<div data-workbench-controls><WorkbenchSourcesList notebookId="n1" sources={sources} selectedVersionIds={[]} onRead={onRead} onSelectionChange={onSelectionChange} onUpload={vi.fn()} /></div>)
  return { ...view, onRead, onSelectionChange }
}

describe('authored workspace touch constraints (not browser geometry)', () => {
  it.each([[360, false], [390, false], [640, false], [768, true], [1440, true]] as const)('gives independent source labels/read/details 44px targets at %s/coarse=%s', (width, coarse) => {
    setup()
    const checkbox = screen.getByRole('checkbox')
    const label = checkbox.closest('label')!
    const read = screen.getByRole('button', { name: 'workbench.read' })
    const summary = screen.getByText('learningWorkspace.sourceDetails')
    const upload = screen.getByText('workbench.uploadVersion')
    for (const target of [label, read, summary, upload]) {
      const rule = workbenchRules(target, width, coarse)
      expect(lengthPixels(rule['min-height'], 300), target.outerHTML).toBeGreaterThanOrEqual(44)
      expect(lengthPixels(rule['min-width'], 300), target.outerHTML).toBeGreaterThanOrEqual(44)
    }
    expect(label.contains(read)).toBe(false)
  })
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
  it('does not impose workspace phone sizing on fine-pointer desktop or unrelated controls', () => {
    setup()
    const read = screen.getByRole('button', { name: 'workbench.read' })
    expect(workbenchRules(read, 1440)['min-height']).toBeUndefined()
    const unrelated = document.createElement('button')
    document.body.append(unrelated)
    expect(workbenchRules(unrelated, 390)['min-height']).toBeUndefined()
    unrelated.remove()
  })
})
