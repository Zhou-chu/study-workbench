import wire from '../../../../contracts/v1/fixtures/hybrid-turn-requests.json'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { captureEmbeddingDisclosure } from '@/lib/workbench/embedding-disclosure'
import { createTurnRegistry } from '@/lib/workbench/turn-operations'
import { TurnRecoveryPanel } from './TurnRecoveryPanel'
vi.mock('@/lib/hooks/use-translation', async () => {
  const { workbenchEn } = await import('@/lib/locales/workbench')
  return { useTranslation: () => ({ t: (key: string, values?: Record<string, string | number>) => {
    let value = String(workbenchEn[key.replace('workbench.', '') as keyof typeof workbenchEn] ?? key)
    for (const [name, text] of Object.entries(values ?? {})) value = value.replace(`{{${name}}}`, String(text))
    return value
  } }) }
})
function operation() {
  const embeddingDisclosure = captureEmbeddingDisclosure({ ...wire.profile, preprocessing_revision: 'evidence-identity-v1', profile_id: 'original-profile', fingerprint: 'fp1', destination_descriptor_version: 'd1', provider: 'Original provider', model_id: 'original-model', model_name: 'Original model', destination_kind: 'unknown', endpoint: 'https://original.example/embed' })!
  const registry = createTurnRegistry()
  const result = registry.admit({ sessionId: 'session', context: { epoch: 1, ready: true, target: { mode: 'legacy_password', apiBase: 'https://api.example/api', protocol: null } }, owner: { mountId: 'mount' }, embeddingDisclosure,
    request: { task: 'question', notebook_id: 'notebook', engine: 'independent', selection_origin: 'local', source_version_ids: ['original-version'], remote_source_ids: [], message: 'Original question', retrieval_mode: 'hybrid', embedding_profile_id: 'original-profile', disclosed_profile_fingerprint: 'fp1', destination_descriptor_version: 'd1', acknowledge_query_processing: true } })
  if (!result.ok) throw new Error('Invalid fixture')
  registry.settlePost(result.token, { kind: 'unknown', reason: 'transport' })
  return registry.getSnapshot('notebook')!
}
it('shows the original embedding destination/mode/provider/model/descriptor/scope outside the API-target disclosure', () => {
  const original = operation()
  render(<TurnRecoveryPanel recovery={{ operation: original, ready: true, replayAvailable: true, retryOriginal: vi.fn(), checkOriginal: vi.fn() } as never} />)
  const summary = screen.getByRole('region', { name: 'Original embedding disclosure (not current controls)' })
  expect(within(summary).getByText('https://original.example/embed')).toBeVisible()
  expect(within(summary).getByText('original-profile')).toBeVisible(); expect(within(summary).getByText('original-version')).toBeVisible()
  expect(within(summary).getByText(/Original provider.*Original model.*original-model/)).toBeVisible()
  expect(within(summary).getByText('Original destination descriptor: d1')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Retry original request (sends POST)' })).toBeEnabled()
})
it.each(['missing', 'rehydrated', 'tampered'] as const)('keeps %s legacy metadata check-only even if a stale observer says replay is available', variant => {
  const original = operation(); const retry = vi.fn(); const check = vi.fn()
  const summary = variant === 'missing' ? undefined : variant === 'rehydrated' ? JSON.parse(JSON.stringify(original.capture.embeddingDisclosure)) : { ...original.capture.embeddingDisclosure, endpoint: 'https://user:secret@tampered.example/embed' }
  render(<TurnRecoveryPanel recovery={{ operation: { ...original, capture: { ...original.capture, embeddingDisclosure: summary } }, ready: true, replayAvailable: true, retryOriginal: retry, checkOriginal: check } as never} />)
  expect(screen.getByText(/original safe embedding disclosure is unavailable/)).toBeVisible()
  const send = screen.getByRole('button', { name: 'Retry original request (sends POST)' }); expect(send).toBeDisabled(); fireEvent.click(send); expect(retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Check original request (read only)' })); expect(check).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/tampered.example/)).not.toBeInTheDocument(); expect(screen.queryByText(/user:secret/)).not.toBeInTheDocument()
})
it.each([
  { engine: 'notebooklm', task: 'question' },
  { engine: 'independent', task: 'outline' },
] as const)('does not label $engine $task as original lexical processing', ({ engine, task }) => {
  const original = operation()
  const dto = { ...original.capture.dto, engine, task, retrieval_mode: undefined, embedding_profile_id: undefined, disclosed_profile_fingerprint: undefined, destination_descriptor_version: undefined, acknowledge_query_processing: undefined }
  render(<TurnRecoveryPanel recovery={{ operation: { ...original, capture: { ...original.capture, dto, embeddingDisclosure: undefined } }, ready: true, replayAvailable: true, retryOriginal: vi.fn(), checkOriginal: vi.fn() } as never} />)
  expect(screen.queryByRole('region', { name: 'Original embedding disclosure (not current controls)' })).not.toBeInTheDocument()
  expect(screen.queryByText('Original processing: Lexical only')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check original request (read only)' })).toBeEnabled()
})
it('retains original lexical retrieval disclosure for a local question', () => {
  const original = operation()
  const dto = { ...original.capture.dto, retrieval_mode: 'lexical', embedding_profile_id: undefined, disclosed_profile_fingerprint: undefined, destination_descriptor_version: undefined, acknowledge_query_processing: undefined }
  render(<TurnRecoveryPanel recovery={{ operation: { ...original, capture: { ...original.capture, dto, embeddingDisclosure: undefined } }, ready: true, replayAvailable: true, retryOriginal: vi.fn(), checkOriginal: vi.fn() } as never} />)
  expect(screen.getByText('Original processing: Lexical only')).toBeVisible()
})
