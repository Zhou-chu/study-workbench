/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { usePathname } from 'next/navigation'
import { AppSidebar } from './AppSidebar'
import { useSidebarStore } from '@/lib/stores/sidebar-store'

// Mock Tooltip components to avoid Radix UI async issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('AppSidebar', () => {
  afterEach(() => {
    vi.mocked(usePathname).mockReturnValue('')
  })

  it('keeps administration behind one settings destination', () => {
    vi.mocked(usePathname).mockReturnValue('/settings/models')
    const { container } = render(<AppSidebar />)
    expect(container.querySelector('a[href="/settings"]')).toHaveAttribute('aria-current', 'page')
    for (const href of ['/settings/models', '/transformations', '/advanced']) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull()
    }
    expect(screen.queryByText('common.theme')).not.toBeInTheDocument()
    expect(screen.queryByText('common.language')).not.toBeInTheDocument()
  })

  it('opens full settings separately while a study notebook is mounted', () => {
    vi.mocked(usePathname).mockReturnValue('/notebooks/notebook%3A1/study')
    render(<AppSidebar />)
    expect(screen.getByRole('link', { name: 'navigation.settings' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'navigation.settings' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders correctly when expanded', () => {
    render(<AppSidebar />)

    // With mocked t() returning keys, check for translation key strings
    expect(screen.getByText('workbench.title')).toBeDefined()
    expect(screen.getByText('navigation.sources')).toBeDefined()
    expect(screen.getByText('navigation.notebooks')).toBeDefined()
  })

  it('keeps sign out accessible without exposing setup controls', () => {
    render(<AppSidebar />)
    expect(screen.getByRole('button', { name: 'common.signOut' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'navigation.settings' })).toBeInTheDocument()
  })

  it('toggles collapse state when clicking handle', () => {
    const toggleCollapse = vi.fn()
    vi.mocked(useSidebarStore).mockReturnValue({
      isCollapsed: false,
      toggleCollapse,
    } as any)

    render(<AppSidebar />)

    fireEvent.click(screen.getByTestId('sidebar-toggle'))

    expect(toggleCollapse).toHaveBeenCalled()
  })

  it('shows collapsed view when isCollapsed is true', () => {
    vi.mocked(useSidebarStore).mockReturnValue({
      isCollapsed: true,
      toggleCollapse: vi.fn(),
    } as any)

    render(<AppSidebar />)

    // In collapsed mode, app name shouldn't be visible (as text)
    expect(screen.queryByText('workbench.title')).toBeNull()
  })
})
