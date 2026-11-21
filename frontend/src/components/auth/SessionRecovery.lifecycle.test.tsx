import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/lib/stores/auth-store'
import DashboardLayout from '@/app/(dashboard)/layout'
import { SessionRecovery } from './SessionRecovery'
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
  it('cold unauthenticated entry may navigate to login before mounting private content', async () => {
    useAuthStore.setState({ phase: 'anonymous', isAuthenticated: false })
    render(<DashboardLayout><Draft /></DashboardLayout>)
    expect(screen.queryByLabelText('Private draft')).not.toBeInTheDocument()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })
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
