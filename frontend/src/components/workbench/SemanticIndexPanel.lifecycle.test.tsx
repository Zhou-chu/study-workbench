import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SemanticStatus, IndexReceipt } from '@/lib/types/personal'
import { beforeEach, expect, it, vi } from 'vitest'
import { workbenchApi } from '@/lib/api/workbench'
import { evidenceApi } from '@/lib/api/evidence'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { invalidateTurnContext, publishTurnTarget, readTurnContext } from '@/lib/workbench/turn-context'
import { SemanticIndexPanel } from './SemanticIndexPanel'
import { workbenchEn, workbenchZh } from '@/lib/locales/workbench'
const disclosureLocale = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/lib/api/evidence', () => ({ evidenceApi: { semanticStatus: vi.fn(), previewSemanticIndex: vi.fn(), buildSemanticIndex: vi.fn() } }))
vi.mock('@/lib/api/workbench', () => ({ workbenchApi: { cancelJob: vi.fn(), job: vi.fn() } }))
vi.mock('@/lib/hooks/use-translation', async () => {
  const { workbenchEn, workbenchZh } = await import('@/lib/locales/workbench')
  return { useTranslation: () => ({ t: (key: string, values?: Record<string, string | number>) => {
    const dictionary = disclosureLocale.language === 'zh' ? workbenchZh : workbenchEn
    let value = String(dictionary[key.replace('workbench.', '') as keyof typeof workbenchEn] ?? key)
    for (const [name, text] of Object.entries(values ?? {})) value = value.replace(`{{${name}}}`, String(text))
    return value
  } }) }
})
const profile = { profile_id: 'profile:one', model_id: 'model:one', provider: 'fixture', model_name: 'fixture', revision: 'r1', endpoint: 'https://fixture.example/embed', credential_binding_id: 'binding', dimension: 3, document_prefix: '', query_prefix: '', preprocessing_revision: 'evidence-identity-v1', max_input_bytes: 1000, cosine_min_score: 0, destination_descriptor_version: 'd1', destination_kind: 'remote', fingerprint: 'a'.repeat(64), endpoint_fingerprint: 'b'.repeat(64) } as const
const snapshot = { notebook_id: 'notebook:1', entries: [{ version_id: 'version:1', extraction_id: 'extraction:1', manifest_hash: 'c'.repeat(64), scope_epoch: 1 }] }
const status: SemanticStatus = { notebook_id: 'notebook:1', snapshot, enabled: true, profiles: [{ profile, index: { state: 'not_indexed', indexed_version_count: 0, selected_version_count: 1, profile_id: profile.profile_id, manifests: [] } }], jobs: [], retry_safe: false, remote_cancel_confirmed: false }
const preview = { snapshot, profile, preview_hash: 'd'.repeat(64), evidence_count: 4, input_bytes: 123, warnings: [] }
const child = { job_id: 'job:child', source_version_id: 'version:1', state: 'queued', stage: 'queued', completed_evidence: 0, total_evidence: 4, retry_safe: false, remote_cancel_confirmed: false } as const
const receipt: IndexReceipt = { group_id: 'job:group', notebook_id: 'notebook:1', profile_id: profile.profile_id, jobs: [child], profile_fingerprint: profile.fingerprint, preview_hash: preview.preview_hash, job_ids: [child.job_id], state: 'queued', retry_safe: false, remote_cancel_confirmed: false }
const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
function show(profileId: string | null = profile.profile_id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3 }, mutations: { retry: 3 } } })
  const view = (selected: string | null, ids = ['version:1']) => <QueryClientProvider client={client}><SemanticIndexPanel notebookId="notebook:1" sourceVersionIds={ids} profileId={selected} onProfileChange={vi.fn()} /></QueryClientProvider>
  const rendered = render(view(profileId))
  return { client, ...rendered, rerenderPanel: (selected: string | null, ids?: string[]) => rendered.rerender(view(selected, ids)) }
}
beforeEach(() => {
  disclosureLocale.language = 'en'; vi.resetAllMocks(); invalidateTurnContext(); publishTurnTarget(target, true)
  sessionCoordinator.setPhase('authenticated'); useAuthStore.setState({ phase: 'authenticated' })
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue(structuredClone(status))
  vi.mocked(evidenceApi.previewSemanticIndex).mockResolvedValue(structuredClone(preview))
  vi.mocked(evidenceApi.buildSemanticIndex).mockResolvedValue(structuredClone(receipt))
  vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: child.job_id, notebook_id: 'notebook:1', operation: 'index_evidence', state: 'failed', source_version_id: 'version:1', profile_id: profile.profile_id, profile_fingerprint: profile.fingerprint })
})

it('retires late preview after profile/scope switches and cannot confirm an old disclosure', async () => {
  let finish!: (value: typeof preview) => void
  vi.mocked(evidenceApi.previewSemanticIndex).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const { rerenderPanel } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' }))
  await waitFor(() => expect(evidenceApi.previewSemanticIndex).toHaveBeenCalledTimes(1))
  rerenderPanel('profile:two', ['version:2'])
  await act(async () => finish(preview))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
})
it('does not revive document consent across a profile rotation ABA in the canonical cache', async () => {
  const { client } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ }))
  const key = QUERY_KEYS.semanticIndex('notebook:1', ['version:1'], readTurnContext()!.epoch)
  const rotated = structuredClone(status); rotated.profiles[0].profile.fingerprint = 'rotated'
  act(() => { client.setQueryData(key, rotated); client.setQueryData(key, structuredClone(status)) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  expect(screen.getByRole('checkbox', { name: /document excerpts/ })).not.toBeChecked()
  expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
})
it('keeps same-key uncertain recovery bound to its original scope/profile even after UI switches', async () => {
  vi.mocked(evidenceApi.buildSemanticIndex).mockRejectedValue(new Error('lost ACK'))
  const { rerenderPanel } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
  await screen.findByRole('button', { name: 'Recover original submission (sends POST)' })
  const original = vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[0]
  rerenderPanel('profile:two', ['version:2'])
  fireEvent.click(screen.getByRole('button', { name: 'Recover original submission (sends POST)' }))
  await waitFor(() => expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(2))
  expect(vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[1]).toEqual(original)
})
it('fences a late submission receipt across privacy invalidation', async () => {
  let finish!: (value: IndexReceipt) => void
  vi.mocked(evidenceApi.buildSemanticIndex).mockReturnValue(new Promise(resolve => { finish = resolve }))
  show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
  await waitFor(() => expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1))
  act(() => invalidateTurnContext()); await act(async () => finish(receipt))
  expect(screen.queryByText(/Submission receipt/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Recover original submission (sends POST)' })).not.toBeInTheDocument()
})

it('submits the consented confirmation form once and keeps its immutable receipt separate from live status', async () => {
  const { client } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ }))
  const form = screen.getByRole('form', { name: 'Preview indexing' })
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  await screen.findByText(/Submission receipt/)
  expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1)
  const next = structuredClone(status); next.jobs = [{ ...child, state: 'succeeded', stage: 'completed', completed_evidence: 4 }]
  act(() => client.setQueryData(QUERY_KEYS.semanticIndex('notebook:1', ['version:1'], readTurnContext()!.epoch), next))
  expect(screen.getByText('job:group · queued')).toBeVisible()
  await waitFor(() => expect(screen.getByText('succeeded · phase completed · 4 / 4 excerpts')).toBeVisible())
  expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1)
})
it('proves an old failure belongs to a different profile before allowing a normal new-profile build', async () => {
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), jobs: [{ ...child, state: 'failed' }] })
  vi.mocked(workbenchApi.job).mockResolvedValue({ job_id: child.job_id, notebook_id: 'notebook:1', operation: 'index_evidence', state: 'failed', source_version_id: 'version:1', profile_id: 'profile:other', profile_fingerprint: 'other-fingerprint' })
  show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  expect(workbenchApi.job).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Preview full-version retry' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
  await waitFor(() => expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1))
  expect(vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[0][1]).not.toHaveProperty('retry_of_job_id')
})
it('fences late attempt inspection after a profile switch and does not offer a mismatched retry', async () => {
  const other = { ...profile, profile_id: 'profile:other', fingerprint: 'other-fingerprint' }
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), profiles: [...status.profiles, { ...status.profiles[0], profile: other }], jobs: [{ ...child, state: 'submission_unknown' }] })
  let finish!: (value: Awaited<ReturnType<typeof workbenchApi.job>>) => void
  vi.mocked(workbenchApi.job).mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue({ job_id: child.job_id, notebook_id: 'notebook:1', operation: 'index_evidence', state: 'submission_unknown', source_version_id: 'version:1', profile_id: profile.profile_id, profile_fingerprint: profile.fingerprint })
  const { rerenderPanel } = show()
  await waitFor(() => expect(workbenchApi.job).toHaveBeenCalledTimes(1))
  rerenderPanel(other.profile_id)
  await act(async () => finish({ job_id: child.job_id, notebook_id: 'notebook:1', operation: 'index_evidence', state: 'submission_unknown', source_version_id: 'version:1', profile_id: profile.profile_id, profile_fingerprint: profile.fingerprint }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: 'Preview full-version retry' })).not.toBeInTheDocument()
  expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
})

it.each(['scope', 'profile', 'mode'] as const)('fences confirmation synchronously when live %s intent changes before observer delivery', async change => {
  const live = { sourceVersionIds: ['version:1'], profileId: profile.profile_id as string | null, retrievalMode: 'lexical' as 'lexical' | 'hybrid' }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><SemanticIndexPanel notebookId="notebook:1" sourceVersionIds={['version:1']} profileId={profile.profile_id} onProfileChange={vi.fn()} readRequestScope={() => live} /></QueryClientProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ }))
  const confirm = screen.getByRole('button', { name: 'Confirm indexing' })
  act(() => {
    if (change === 'scope') live.sourceVersionIds = ['version:two']
    else if (change === 'profile') live.profileId = 'profile:two'
    else live.retrievalMode = 'hybrid'
    fireEvent.click(confirm)
  })
  await act(async () => { await Promise.resolve() })
  expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
})

it.each(['en', 'zh'])('shows frozen provider, model and revision before document consent and after same-ID rotation: %s', async language => {
  disclosureLocale.language = language
  const copy = language === 'zh' ? workbenchZh : workbenchEn
  const { client } = show()
  await waitFor(() => expect(screen.getByRole('button', { name: copy.previewIndex })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: copy.previewIndex }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('fixture · fixture · model:one')
  expect(dialog).toHaveTextContent('r1')
  expect(dialog).toHaveTextContent(copy.embeddingModelIdentity)
  expect(dialog).toHaveTextContent(copy.embeddingRevision)
  expect(within(dialog).getByRole('checkbox', { name: copy.ackDocumentProcessing })).not.toBeChecked()
  expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('checkbox', { name: copy.ackDocumentProcessing }))
  const rotated = { ...profile, model_name: 'new-visible-model', revision: 'new-visible-revision', fingerprint: 'f'.repeat(64) }
  act(() => client.setQueryData(QUERY_KEYS.semanticIndex('notebook:1', ['version:1'], readTurnContext()!.epoch), { ...status, profiles: [{ ...status.profiles[0], profile: rotated }] }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  vi.mocked(evidenceApi.previewSemanticIndex).mockResolvedValue({ ...preview, profile: rotated })
  fireEvent.click(screen.getByRole('button', { name: copy.previewIndex }))
  const next = await screen.findByRole('dialog')
  expect(next).toHaveTextContent('fixture · new-visible-model · model:one')
  expect(next).toHaveTextContent('new-visible-revision')
  expect(within(next).getByRole('checkbox', { name: copy.ackDocumentProcessing })).not.toBeChecked()
  expect(within(next).getByRole('button', { name: copy.confirmIndex })).toBeDisabled()
})
