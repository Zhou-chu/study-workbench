import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SemanticStatus, IndexReceipt } from '@/lib/types/personal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workbenchApi } from '@/lib/api/workbench'
import { evidenceApi } from '@/lib/api/evidence'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { useAuthStore } from '@/lib/stores/auth-store'
import { invalidateTurnContext, publishTurnTarget } from '@/lib/workbench/turn-context'
import { SemanticIndexPanel } from './SemanticIndexPanel'
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
describe('explicit semantic index controls', () => {
  it('never selects or previews on mount; missing profile is unavailable', async () => {
    show(null); expect((await screen.findAllByText(/Choose an embedding profile/)).some(node => node.tagName === 'P')).toBe(true)
    expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeDisabled()
    expect(evidenceApi.previewSemanticIndex).not.toHaveBeenCalled(); expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
  })
  it('requires preview then separate document consent and confirmation; counts are not prices', async () => {
    show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
    expect(screen.getByText(/Configured, not tested/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' }))
    expect(await screen.findByText('4 evidence excerpts · 123 input bytes. Counts are not a price estimate.')).toBeVisible()
    expect(screen.getAllByText(profile.endpoint).length).toBeGreaterThan(0); expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm indexing' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
    await waitFor(() => expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1))
    expect(vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[0][1]).toMatchObject({ source_version_ids: ['version:1'], profile_id: profile.profile_id, preview_hash: preview.preview_hash, acknowledge_external_processing: true, acknowledge_duplicate_embedding_cost: false })
    expect(await screen.findByText(/Submission receipt/)).toBeVisible()
  })
  it('Escape closes confirmation without dispatch or claiming remote cancellation', async () => {
    show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
  })
  it('retains uncertain submission identity and never retries automatically', async () => {
    vi.mocked(evidenceApi.buildSemanticIndex).mockRejectedValue(new Error('lost ack'))
    show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
    const recover = await screen.findByRole('button', { name: 'Recover original submission (sends POST)' })
    expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[0]; fireEvent.click(recover)
    await waitFor(() => expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(2)); expect(vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[1]).toEqual(sent)
  })
  it('does not call a partial selected index ready', async () => {
    vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), profiles: [{ profile, index: { ...status.profiles[0].index, state: 'ready', indexed_version_count: 1, selected_version_count: 2 } }] } as never)
    show(); expect(await screen.findByText('Semantic index not ready for the whole selection')).toBeVisible()
    expect(screen.queryByText('Semantic index ready for the whole selection')).not.toBeInTheDocument()
  })
})

it('requires current full-version retry preview and separate duplicate-cost acknowledgment for a failed/unknown job', async () => {
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), jobs: [{ ...child, state: 'submission_unknown', stage: 'unknown' }] })
  show(); const retry = await screen.findByRole('button', { name: 'Preview full-version retry' })
  expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeDisabled(); expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
  fireEvent.click(retry); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ }))
  expect(screen.getByRole('button', { name: 'Confirm indexing' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /duplicate previous/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
  await waitFor(() => expect(evidenceApi.buildSemanticIndex).toHaveBeenCalledTimes(1))
  expect(vi.mocked(evidenceApi.buildSemanticIndex).mock.calls[0][1]).toMatchObject({ source_version_ids: ['version:1'], retry_of_job_id: 'job:child', acknowledge_duplicate_embedding_cost: true, preview_hash: preview.preview_hash })
})
it('discloses unknown destination and requires document consent without granting query consent', async () => {
  const unknown = { ...profile, destination_kind: 'unknown' as const }
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), profiles: [{ ...status.profiles[0], profile: unknown }] })
  vi.mocked(evidenceApi.previewSemanticIndex).mockResolvedValue({ ...preview, profile: unknown })
  show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  expect(screen.getAllByText(/Unknown destination/).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'Confirm indexing' })).toBeDisabled(); expect(screen.queryByRole('checkbox', { name: /sending this query/ })).not.toBeInTheDocument()
})


it('does not accept a mismatched profile fingerprint or incomplete group as a confirmed receipt', async () => {
  vi.mocked(evidenceApi.buildSemanticIndex).mockResolvedValue({ ...receipt, profile_fingerprint: 'different', jobs: [] })
  show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Preview indexing' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: /document excerpts/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm indexing' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Recover original submission (sends POST)' })).toBeEnabled())
  expect(screen.queryByText(/Submission receipt/)).not.toBeInTheDocument()
})

it('does not automatically queue or retry an unknown future-state child and describes local cancellation truthfully', async () => {
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), jobs: [{ ...child, state: 'future_state', stage: 'future_phase' }] })
  show(); expect(await screen.findByText('future_state · phase future_phase · 0 / 4 excerpts')).toBeVisible()
  expect(screen.getByText('Local cancellation does not confirm that remote processing stopped or that no quota was used.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Preview full-version retry' })).not.toBeInTheDocument()
  expect(evidenceApi.previewSemanticIndex).not.toHaveBeenCalled(); expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
})


it('bounds metadata inspection and fails visibly closed instead of silently submitting an ambiguous retry', async () => {
  vi.mocked(evidenceApi.semanticStatus).mockResolvedValue({ ...structuredClone(status), jobs: Array.from({ length: 21 }, (_, index) => ({ ...child, job_id: `job:${index}`, state: 'submission_unknown' })) })
  show(); expect(await screen.findByText(/more than 20 attempts need inspection/)).toBeVisible()
  expect(workbenchApi.job).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Preview indexing' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Preview full-version retry' })).not.toBeInTheDocument()
  expect(evidenceApi.buildSemanticIndex).not.toHaveBeenCalled()
})
