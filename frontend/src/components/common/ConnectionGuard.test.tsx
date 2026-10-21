import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { expect, it, vi } from 'vitest'
import { ConnectionGuard } from './ConnectionGuard'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { getConfig } from '@/lib/config'
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(), resetConfig: vi.fn() }))
vi.mock('@/components/errors/ConnectionErrorOverlay', () => ({ ConnectionErrorOverlay: ({ onRetry }: { onRetry: () => void }) => <div role="alert"><button onClick={onRetry}>Recheck connection</button></div> }))
it('keeps mounted work through online recheck, an outage, and another check', async () => {
  let unmounted = 0
  function Editor() { const [text, setText] = useState(''); useEffect(() => () => { unmounted++ }, []); return <input aria-label="draft" value={text} onChange={e => setText(e.target.value)} /> }
  vi.mocked(getConfig).mockResolvedValue({ dbStatus: 'online', apiUrl: '' } as never)
  render(<ConnectionGuard><Editor /></ConnectionGuard>)
  const editor = await screen.findByLabelText('draft')
  fireEvent.change(editor, { target: { value: 'Unsent note' } })
  vi.mocked(getConfig).mockRejectedValueOnce(new Error('service outage'))
  await act(async () => window.dispatchEvent(new Event('online')))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('draft')).toBe(editor); expect(unmounted).toBe(0)
  expect(editor.closest('[inert]')).toBeNull()
  let finish!: (value: never) => void
  vi.mocked(getConfig).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByText('auth.checkConnection'))
  expect(screen.getByLabelText('draft')).toBe(editor)
  await act(async () => finish({ dbStatus: 'online', apiUrl: '' } as never))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(editor).toHaveValue('Unsent note'); expect(unmounted).toBe(0)
})

it('keeps connection recovery reachable inside an open editor modal without replacing its draft or File', async () => {
  function Editor() {
    const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null)
    return <Dialog open><DialogContent><DialogTitle>Editor</DialogTitle><DialogDescription>Local draft</DialogDescription>
      <input aria-label="modal draft" value={text} onChange={e => setText(e.target.value)} />
      <input type="file" aria-label="modal file" onChange={e => setFile(e.target.files?.[0] || null)} /><span>{file?.name}</span>
    </DialogContent></Dialog>
  }
  vi.mocked(getConfig).mockResolvedValue({ dbStatus: 'online', apiUrl: '' } as never)
  render(<ConnectionGuard><Editor /></ConnectionGuard>)
  const editor = await screen.findByLabelText('modal draft')
  const fileInput = screen.getByLabelText('modal file') as HTMLInputElement
  const file = new File(['private bytes'], 'unsent.pdf')
  fireEvent.change(editor, { target: { value: 'Retained modal draft' } }); fireEvent.change(fileInput, { target: { files: [file] } })
  vi.mocked(getConfig).mockRejectedValueOnce(new Error('service outage'))
  await act(async () => window.dispatchEvent(new Event('online')))
  const retry = await screen.findByRole('button', { name: 'auth.checkConnection' })
  expect(retry.closest('[role=dialog]')).toBe(screen.getByRole('dialog'))
  expect(screen.getByLabelText('modal draft')).toBe(editor); expect(fileInput.files?.[0]).toBe(file)
  fireEvent.change(editor, { target: { value: 'Still editable' } }); fireEvent.click(retry)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'auth.checkConnection' })).not.toBeInTheDocument())
  expect(editor).toHaveValue('Still editable'); expect(fileInput.files?.[0]).toBe(file)
})

it('a config-only retry stays reachable and restores focus inside the locked signout dialog', async () => {
  const { SessionRecovery } = await import('@/components/auth/SessionRecovery')
  const { useAuthStore } = await import('@/lib/stores/auth-store')
  const bootstrap = vi.fn(async () => false); let unmounted = 0
  function Draft() { useEffect(() => () => { unmounted++ }, []); return <textarea aria-label="retained locked draft" defaultValue="Private draft" /> }
  useAuthStore.setState({ mode: 'device_sessions', hasHydrated: true, isLoading: false, signedOutLocally: false, phase: 'authenticated', isAuthenticated: true, session: null, bootstrap })
  vi.mocked(getConfig).mockResolvedValue({ dbStatus: 'online', apiUrl: '' } as never)
  render(<ConnectionGuard><Draft /><SessionRecovery /></ConnectionGuard>)
  const draft = await screen.findByLabelText('retained locked draft')
  await act(async () => useAuthStore.setState({ signedOutLocally: true, phase: 'anonymous', isAuthenticated: false, serverRevocation: 'unconfirmed', localSignoutConfirmed: true }))
  const dialog = screen.getByRole('dialog')
  vi.mocked(getConfig).mockRejectedValueOnce(new Error('temporary config outage'))
  await act(async () => window.dispatchEvent(new Event('online')))
  const retry = await screen.findByRole('button', { name: 'auth.checkConnection' })
  expect(retry.closest('[role=dialog]')).toBe(dialog)
  act(() => retry.focus()); fireEvent.click(retry)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'auth.checkConnection' })).not.toBeInTheDocument())
  await waitFor(() => expect(document.activeElement?.closest('[role=dialog]')).toBe(dialog))
  expect(draft.isConnected).toBe(true); expect(draft).toHaveValue('Private draft'); expect(unmounted).toBe(0)
  expect(bootstrap).not.toHaveBeenCalled()
  expect(useAuthStore.getState()).toMatchObject({ signedOutLocally: true, isAuthenticated: false, phase: 'anonymous' })
})
