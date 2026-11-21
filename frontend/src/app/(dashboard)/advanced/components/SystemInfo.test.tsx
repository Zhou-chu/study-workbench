import { act, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SystemInfo } from './SystemInfo'
import { getConfig } from '@/lib/config'

vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))
beforeEach(() => { vi.mocked(getConfig).mockReset() })

it('handles a configuration rejection internally and leaves loading state', async () => {
  const error = new Error('fixture unavailable')
  vi.mocked(getConfig).mockRejectedValue(error)
  const observed = vi.spyOn(console, 'error') // Observe, do not silence diagnostics.
  try {
    await act(async () => { render(<SystemInfo />) })
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(screen.getAllByText('advanced.unknown')).toHaveLength(2)
    expect(observed).toHaveBeenCalledWith('Failed to load config:', error)
  } finally { observed.mockRestore() }
})

it('a rejected config read after unmount is still caught, not leaked', async () => {
  let reject!: (reason: Error) => void
  vi.mocked(getConfig).mockReturnValue(new Promise((_, fail) => { reject = fail }))
  const error = new Error('late fixture failure')
  const observed = vi.spyOn(console, 'error')
  try {
    const view = render(<SystemInfo />)
    view.unmount()
    await act(async () => reject(error))
    expect(observed).toHaveBeenCalledWith('Failed to load config:', error)
  } finally { observed.mockRestore() }
})
