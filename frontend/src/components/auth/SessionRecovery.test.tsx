import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/lib/stores/auth-store'
import { SessionRecovery } from './SessionRecovery'
import { LoginForm } from './LoginForm'
const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('@/lib/hooks/use-auth', () => ({ useAuth: () => useAuthStore(), safeReturnPath: (path: string | null) => path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/notebooks' }))
vi.mock('@/lib/hooks/use-version-check', () => ({ useVersionCheck: () => {} }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => ({ authMode: 'device_sessions', apiUrl: '', version: 'fixture', buildTime: '2026-10-21' })) }))
const initial = useAuthStore.getState()
beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ ...initial, phase: 'authenticated', isAuthenticated: true, isLoading: false, hasHydrated: true, authRequired: true, mode: 'device_sessions' }); sessionStorage.clear() })
describe('mounted session recovery', () => {
  it.each([
    ['pending', 'auth.finishingSignIn'], ['refresh-needed', 'auth.sessionCheckTitle'],
    ['reauth-required', 'auth.reauthenticateTitle'], ['unavailable', 'auth.connectionPausedTitle'],
  ] as const)('explains %s without calling it a wrong password', (phase, key) => {
    useAuthStore.setState({ phase, isAuthenticated: false })
    render(<SessionRecovery />)
    expect(screen.getByTestId('session-recovery')).toHaveTextContent(key)
  })
  it('clears the in-place password after a failed attempt without navigating or resubmitting work', async () => {
    const login = vi.fn(async () => false)
    useAuthStore.setState({ phase: 'reauth-required', isAuthenticated: false, login })
    render(<SessionRecovery />)
    fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))
    fireEvent.change(screen.getByLabelText('auth.passwordPlaceholder'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('auth.passwordPlaceholder')).toHaveValue(''))
    expect(push).not.toHaveBeenCalled()
  })
  it('refresh-needed has an explicit refresh and unavailable checks status instead of rotating again', async () => {
    const refresh = vi.fn(async () => false); const bootstrap = vi.fn(async () => false)
    useAuthStore.setState({ phase: 'refresh-needed', isAuthenticated: false, refresh, bootstrap })
    render(<SessionRecovery />)
    fireEvent.click(screen.getByRole('button', { name: 'auth.resumeSession' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => useAuthStore.setState({ phase: 'unavailable' }))
    fireEvent.click(screen.getByRole('button', { name: 'auth.checkConnection' }))
    expect(bootstrap).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('shows honest local sign-out and unconfirmed server revocation', () => {
    useAuthStore.setState({ phase: 'anonymous', isAuthenticated: false, signedOutLocally: true, serverRevocation: 'unconfirmed', localSignoutConfirmed: true })
    render(<SessionRecovery />)
    expect(screen.getByRole('dialog')).toHaveTextContent('auth.remoteRevocationUnconfirmed')
    expect(screen.getByRole('dialog')).toHaveTextContent('auth.signedOutTitle')
  })
  it('unacknowledged local retirement stays locked and offers Retry sign-out, not a false success', () => {
    const signoutLocal = vi.fn(async () => false)
    useAuthStore.setState({ phase: 'anonymous', isAuthenticated: false, signedOutLocally: true, localSignoutConfirmed: false, serverRevocation: 'unconfirmed', signoutLocal })
    render(<SessionRecovery />)
    expect(screen.getByRole('dialog')).toHaveTextContent('auth.signoutUnconfirmed')
    fireEvent.click(screen.getByRole('button', { name: 'auth.retrySignout' }))
    expect(signoutLocal).toHaveBeenCalledTimes(1)
  })
  it('cold login clears the password after each attempt', async () => {
    const login = vi.fn(async () => false)
    useAuthStore.setState({ phase: 'anonymous', isAuthenticated: false, login })
    render(<LoginForm />)
    const input = await screen.findByPlaceholderText('auth.passwordPlaceholder')
    fireEvent.change(input, { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(login).toHaveBeenCalledTimes(1)
  })
})

it('an unavailable sign-in after explicit sign-out keeps an actionable locked recovery dialog', () => {
  useAuthStore.setState({ phase: 'unavailable', isAuthenticated: false, signedOutLocally: true, error: 'auth.serviceUnavailable', serverRevocation: 'unconfirmed', localSignoutConfirmed: false })
  render(<SessionRecovery />)
  expect(screen.getByRole('dialog')).toHaveTextContent('auth.serviceUnavailable')
  expect(screen.getByRole('button', { name: 'auth.retrySignout' })).toBeEnabled()
  expect(screen.getByLabelText('auth.passwordPlaceholder')).toBeEnabled()
})

it.each(['pending', 'unavailable'] as const)('a locked accepted login offers safe %s confirmation without another password submission', phase => {
  const bootstrap = vi.fn(async () => false); const login = vi.fn(async () => false)
  useAuthStore.setState({ phase, signedOutLocally: true, isAuthenticated: false, bootstrap, login, session: { session_id: 'pending-fixture', access_expires_at: '2030-01-01T00:15:00Z', refresh_expires_at: '2030-01-31T00:00:00Z', generation: 0 } })
  render(<SessionRecovery />)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.queryByLabelText('auth.passwordPlaceholder')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: phase === 'pending' ? 'auth.finishSignIn' : 'auth.checkConnection' }))
  expect(bootstrap).toHaveBeenCalledTimes(1); expect(login).not.toHaveBeenCalled()
})
