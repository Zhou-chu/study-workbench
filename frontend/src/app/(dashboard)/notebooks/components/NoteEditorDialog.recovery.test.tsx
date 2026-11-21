import { SessionRecovery } from '@/components/auth/SessionRecovery'
import { useAuthStore } from '@/lib/stores/auth-store'
import { RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { notesApi } from '@/lib/api/notes'
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
import { NoteEditorDialog } from './NoteEditorDialog'
vi.mock('@/lib/api/notes', () => ({ notesApi: { get: vi.fn(), list: vi.fn(), update: vi.fn(), create: vi.fn() } }))
vi.mock('@/components/ui/markdown-editor', () => ({ MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Body" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock('@/components/common/InlineEdit', () => ({ InlineEdit: ({ value, onSave }: { value: string; onSave: (value: string) => void }) => <input aria-label="Title" value={value} onChange={event => onSave(event.target.value)} /> }))
const original = { id: 'note:a', revision: 3, title: 'Original', content: 'Full body', note_type: 'human', created: '', updated: '' }
const onClose = vi.fn()
beforeEach(() => { vi.clearAllMocks(); vi.mocked(notesApi.get).mockResolvedValue(original) })

function showRecoverableNote() {
  useAuthStore.setState({ phase: 'authenticated', isAuthenticated: true, hasHydrated: true, isLoading: false, signedOutLocally: false, serverRevocation: null, error: null,
    login: async () => { useAuthStore.setState({ phase: 'authenticated', isAuthenticated: true }); return true } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><NoteEditorDialog open onOpenChange={onClose} notebookId="notebook:1" note={original} /><SessionRecovery /></QueryClientProvider>)
}
async function expireAndRecoverNote() {
  await act(async () => useAuthStore.setState({ phase: 'reauth-required', isAuthenticated: false }))
  fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))
  fireEvent.change(screen.getByLabelText('auth.passwordPlaceholder'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))
  await waitFor(() => expect(screen.queryByTestId('session-recovery')).not.toBeInTheDocument())
}
it.each(['not-sent', 'auth-rejected'] as const)('retains notebook note predecessor and draft for a manual retry after %s', async kind => {
  vi.mocked(notesApi.update).mockRejectedValueOnce(kind === 'not-sent' ? new RequestNotDispatchedError('authentication') : { response: { status: 401, data: { error: { code: 'AUTH_REQUIRED' } } } })
  showRecoverableNote(); const body = await screen.findByLabelText('Body')
  fireEvent.change(body, { target: { value: 'Retained manual retry draft' } })
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retained title' } })
  fireEvent.click(screen.getByRole('button', { name: 'sources.saveNote' }))
  await screen.findByText(kind === 'not-sent' ? 'noteConflict.notSent' : 'noteConflict.authRejected')
  await expireAndRecoverNote()
  expect(screen.getByLabelText('Body')).toBe(body); expect(body).toHaveValue('Retained manual retry draft')
  expect(notesApi.update).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'sources.saveNote' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'noteConflict.compare' })).not.toBeInTheDocument()
  vi.mocked(notesApi.update).mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: 'NOTE_REVISION_CONFLICT', current_revision: 4 } } } })
  fireEvent.click(screen.getByRole('button', { name: 'sources.saveNote' }))
  await screen.findByText('noteConflict.conflict')
  expect(notesApi.update).toHaveBeenLastCalledWith('note:a', { expected_revision: 3, title: 'Retained title', content: 'Retained manual retry draft' })
  expect(screen.getByRole('button', { name: 'sources.saveNote' })).toBeDisabled()
})
it('retains unknown-save reconciliation after reauthentication instead of silently resubmitting', async () => {
  vi.mocked(notesApi.update).mockRejectedValueOnce(new Error('dispatched acknowledgement lost'))
  showRecoverableNote(); const body = await screen.findByLabelText('Body')
  fireEvent.change(body, { target: { value: 'Unknown-save draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'sources.saveNote' })); await screen.findByText('noteConflict.unknown')
  await expireAndRecoverNote()
  expect(screen.getByLabelText('Body')).toBe(body); expect(body).toHaveValue('Unknown-save draft')
  expect(screen.getByRole('button', { name: 'sources.saveNote' })).toBeDisabled()
  expect(notesApi.update).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled()
})
