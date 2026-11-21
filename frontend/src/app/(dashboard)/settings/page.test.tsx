import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './page'
import { useWebSearchStatus } from '@/lib/hooks/use-web-discovery'
vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('./components/SettingsForm', () => ({ SettingsForm: () => <p>Content processing form</p> }))
vi.mock('@/lib/hooks/use-web-discovery', () => ({ useWebSearchStatus: vi.fn() }))
vi.mock('@/lib/hooks/use-settings', () => ({ useSettings: () => ({ refetch: vi.fn() }) }))
describe('Settings hub', () => {
  beforeEach(() => { vi.mocked(useWebSearchStatus).mockReturnValue({ data: { state: 'configuration_required', access_mode: 'api_key' }, refetch: vi.fn() } as never) })
  it('groups preferences and retains every administration destination', () => {
    render(<SettingsPage />)
    expect(screen.getByText('learningWorkspace.preferences')).toBeInTheDocument()
    expect(screen.getByText('common.theme')).toBeInTheDocument()
    expect(screen.getByText('common.language')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'navigation.models' })).toHaveAttribute('href', '/settings/models')
    expect(screen.getByRole('link', { name: 'navigation.transformations' })).toHaveAttribute('href', '/transformations')
    expect(screen.getByRole('link', { name: 'navigation.advanced' })).toHaveAttribute('href', '/advanced')
    expect(screen.getByText('Content processing form')).toBeInTheDocument()
    expect(screen.getByText('webDiscovery.configurationHelp')).toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.trialMode')).not.toBeInTheDocument()
  })
  it('discloses opted-in keyless trial limits without suggesting API-key charges', () => {
    vi.mocked(useWebSearchStatus).mockReturnValue({ data: { state: 'ready', access_mode: 'keyless_trial' }, refetch: vi.fn() } as never)
    render(<SettingsPage />)
    expect(screen.getByText('webDiscovery.trialMode')).toBeInTheDocument()
    expect(screen.getByText('webDiscovery.trialQuota')).toBeInTheDocument()
    expect(screen.getByText('webDiscovery.trialPrivacy')).toBeInTheDocument()
    expect(screen.getByText('learningWorkspace.webSearchReady')).toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.privacyNotice')).not.toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.configurationHelp')).not.toBeInTheDocument()
  })
  it('keeps API-key mode and its charge disclosure distinct from keyless trial', () => {
    vi.mocked(useWebSearchStatus).mockReturnValue({ data: { state: 'ready', access_mode: 'api_key' }, refetch: vi.fn() } as never)
    render(<SettingsPage />)
    expect(screen.getByText('webDiscovery.privacyNotice')).toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.trialMode')).not.toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.trialQuota')).not.toBeInTheDocument()
  })
  it('does not present stale trial configuration as available after a status failure', () => {
    vi.mocked(useWebSearchStatus).mockReturnValue({ data: { state: 'ready', access_mode: 'keyless_trial' }, isError: true, refetch: vi.fn() } as never)
    render(<SettingsPage />)
    expect(screen.getByText('webDiscovery.statusUnavailable')).toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.trialMode')).not.toBeInTheDocument()
    expect(screen.queryByText('learningWorkspace.webSearchReady')).not.toBeInTheDocument()
    expect(screen.queryByText('webDiscovery.configurationHelp')).not.toBeInTheDocument()
  })

})
