import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import Link from 'next/link'

vi.mock('./AppSidebar', () => ({ AppSidebar: () => <nav aria-label="sidebar"><Link href="/notebooks" onClick={event => event.preventDefault()}>Notebooks</Link></nav> }))
vi.mock('./SetupBanner', () => ({ SetupBanner: () => null }))

describe('AppShell responsive navigation', () => {
  it('does not reserve sidebar width below the desktop breakpoint', () => {
    render(<AppShell><p>Workbench content</p></AppShell>)
    expect(screen.getByRole('navigation', { name: 'sidebar' }).parentElement).toHaveClass('hidden', 'lg:block', 'shrink-0')
    expect(screen.getByRole('main')).toHaveClass('min-w-0', 'flex-1')
    expect(screen.getByRole('button', { name: 'workbench.navigation' })).toHaveAttribute('aria-expanded', 'false')
  })
  it('opens accessible mobile navigation and closes it after following a link', () => {
    render(<AppShell><p>Workbench content</p></AppShell>)
    const trigger = screen.getByRole('button', { name: 'workbench.navigation' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'workbench.navigation' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(dialog).getByRole('link', { name: 'Notebooks' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
  it('provides an accessible close button without changing the desktop sidebar', () => {
    render(<AppShell><p>Workbench content</p></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'workbench.navigation' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'sidebar' })).toBeInTheDocument()
  })
})
