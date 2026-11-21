import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { expect, it, vi } from 'vitest'
import { ConnectionGuard } from './ConnectionGuard'
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
