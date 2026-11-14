import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/lib/stores/auth-store'
import DashboardLayout from '@/app/(dashboard)/layout'
import { SessionRecovery } from './SessionRecovery'
import { LoginForm } from './LoginForm'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('@/lib/hooks/use-auth', () => ({ useAuth: () => useAuthStore(), safeReturnPath: (path: string | null) => path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/notebooks' }))
vi.mock('@/lib/hooks/use-version-check', () => ({ useVersionCheck: () => {} }))
vi.mock('@/lib/hooks/use-create-dialogs', () => ({ CreateDialogsProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/providers/ModalProvider', () => ({ ModalProvider: () => null }))
vi.mock('@/components/common/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => ({ authMode: 'device_sessions', apiUrl: '', version: 'fixture', buildTime: '2026-10-21' })) }))
const initial = useAuthStore.getState()
let unmounted = 0
function Draft() {
  const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null)
  useEffect(() => () => { unmounted++ }, [])
  return <><input aria-label="Private draft" value={text} onChange={e => setText(e.target.value)} /><input type="file" aria-label="Selected file" onChange={e => setFile(e.target.files?.[0] || null)} /><span data-testid="file-name">{file?.name}</span></>
}
beforeEach(() => { vi.clearAllMocks(); unmounted = 0; useAuthStore.setState({ ...initial, phase: 'authenticated', isAuthenticated: true, isLoading: false, hasHydrated: true, authRequired: true, mode: 'device_sessions' }); sessionStorage.clear() })
describe('mounted session recovery', () => {
  it.each(['reauth-required', 'unavailable', 'pending', 'refresh-needed', 'anonymous'] as const)('keeps the exact editor and File alive through %s and re-login', async phase => {
    render(<DashboardLayout><Draft /></DashboardLayout>)
    const draft = screen.getByLabelText('Private draft'); const fileInput = screen.getByLabelText('Selected file') as HTMLInputElement
    const file = new File(['private'], 'unsent.pdf')
    fireEvent.change(draft, { target: { value: 'Unsubmitted work' } }); fireEvent.change(fileInput, { target: { files: [file] } })
    await act(async () => useAuthStore.setState({ phase, isAuthenticated: false }))
    expect(screen.getByLabelText('Private draft')).toBe(draft)
    expect(draft).toHaveValue('Unsubmitted work'); expect(fileInput.files?.[0]).toBe(file)
    expect(unmounted).toBe(0); expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled()
    expect(screen.getByTestId('session-recovery')).toHaveTextContent('auth.draftsPreserved')
    expect(draft.closest('[inert]')).toBeNull()
    fireEvent.change(draft, { target: { value: 'Still editing offline' } })
    await act(async () => useAuthStore.setState({ phase: 'authenticated', isAuthenticated: true }))
    expect(screen.getByLabelText('Private draft')).toBe(draft)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(unmounted).toBe(0)
  })
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
  it('cold unauthenticated entry may navigate to login before mounting private content', async () => {
    useAuthStore.setState({ phase: 'anonymous', isAuthenticated: false })
    render(<DashboardLayout><Draft /></DashboardLayout>)
    expect(screen.queryByLabelText('Private draft')).not.toBeInTheDocument()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
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

it.each(['disabled-fieldset', 'nonfocusable'])('focus recovery skips a %s target and allows a readonly copy field', async mode => {
  render(<><Dialog open><DialogContent><DialogTitle>Retained editor</DialogTitle><DialogDescription>Draft</DialogDescription><fieldset data-testid="fieldset"><input aria-label="former input" /></fieldset><div tabIndex={0} data-testid="former-div">Draft preview</div><textarea aria-label="copy draft" readOnly value="Retained text" /></DialogContent></Dialog><SessionRecovery /></>)
  const target = mode === 'disabled-fieldset' ? screen.getByLabelText('former input') : screen.getByTestId('former-div')
  act(() => target.focus())
  await act(async () => useAuthStore.setState({ phase: 'reauth-required', isAuthenticated: false }))
  fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))
  const password = screen.getByLabelText('auth.passwordPlaceholder')
  await waitFor(() => expect(password).toHaveFocus())
  ;(screen.getByTestId('fieldset') as HTMLFieldSetElement).disabled = true
  screen.getByTestId('former-div').removeAttribute('tabindex')
  await act(async () => useAuthStore.setState({ isLoading: true }))
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
  await waitFor(() => expect(screen.queryByLabelText('auth.passwordPlaceholder')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByLabelText('copy draft')).toHaveFocus())
})
