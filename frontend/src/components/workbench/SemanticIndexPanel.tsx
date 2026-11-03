'use client'
import { EmbeddingIdentity } from './EmbeddingIdentity'
import { OriginalEmbeddingDisclosure } from './OriginalEmbeddingDisclosure'
import { captureEmbeddingDisclosure, matchesEmbeddingDisclosure, type EmbeddingDisclosure } from '@/lib/workbench/embedding-disclosure'
import { useEffect, useReducer, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { evidenceApi } from '@/lib/api/evidence'
import { workbenchApi } from '@/lib/api/workbench'
import { useSemanticStatus, currentSemanticStatus } from '@/lib/hooks/use-semantic-status'
import { useTranslation } from '@/lib/hooks/use-translation'
import { assertResourceDispatch, assertTurnDispatch, RequestNotDispatchedError } from '@/lib/api/browser-transport'
import { readTurnContext, subscribeTurnContext, type TurnContext } from '@/lib/workbench/turn-context'
import type { IndexJobStatus, IndexPreview, IndexReceipt, IndexRequest } from '@/lib/types/personal'
import { embeddingDestinationKeys } from '@/lib/utils/workbench'
import { selectedSourceReadinessFingerprint } from '@/lib/utils/workbench-readiness'
import { QUERY_KEYS } from '@/lib/api/query-client'
import type { Workspace } from '@/lib/types/personal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type RequestScope = { sourceVersionIds: readonly string[]; profileId: string | null; retrievalMode: 'lexical' | 'hybrid' }
type PreviewCapture = { generation: number; preview: IndexPreview; versions: readonly string[]; retryOf?: string; context: TurnContext }
type Submission = { notebookId: string; request: Readonly<IndexRequest>; context: TurnContext; profileFingerprint: string; destinationDescriptorVersion: string; embeddingDisclosure?: EmbeddingDisclosure; receipt?: IndexReceipt; pending: boolean }
/** Metadata previews do not authorize document or query processing. No model is selected here. */
export function SemanticIndexPanel({ notebookId, sourceVersionIds, profileId, onProfileChange, retrievalMode = 'lexical', readRequestScope }: {
  notebookId: string; sourceVersionIds: readonly string[]; profileId: string | null; onProfileChange: (id: string | null) => void; retrievalMode?: 'lexical' | 'hybrid'; readRequestScope?: () => RequestScope
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const status = useSemanticStatus(notebookId, sourceVersionIds)
  const [, repaint] = useReducer(value => value + 1, 0)
  const latest = useRef({ notebookId, sourceVersionIds, profileId, retrievalMode, readRequestScope })
  latest.current = { notebookId, sourceVersionIds, profileId, retrievalMode, readRequestScope }
  const owner = useRef({ fingerprint: '', generation: 0 })
  const mounted = useRef(false)
  const pendingPreview = useRef(false)
  const [preview, setPreview] = useState<PreviewCapture | null>(null)
  const [ack, setAck] = useState(false)
  const [duplicateAck, setDuplicateAck] = useState(false)
  const [problem, setProblem] = useState(false)
  const [busy, setBusy] = useState(false)
  const submission = useRef<Submission | null>(null)
  const sync = () => {
    const id = latest.current.notebookId
    const live = latest.current.readRequestScope?.() ?? latest.current
    const { sourceVersionIds: ids, profileId: selected } = live
    const current = currentSemanticStatus(client, id, ids)
    if (submission.current && submission.current.context.epoch !== readTurnContext()?.epoch) submission.current = null
    const workspace = client.getQueryData<Workspace>(QUERY_KEYS.workbench(id))
    const fingerprint = JSON.stringify([id, ids, selected, live.retrievalMode, readTurnContext(), current?.enabled, current?.snapshot, current?.profiles.map(row => row.profile), current?.jobs.map(job => [job.job_id, job.source_version_id, job.state]), workspace ? selectedSourceReadinessFingerprint(ids, workspace.sources) : null])
    if (owner.current.fingerprint !== fingerprint) owner.current = { fingerprint, generation: owner.current.generation + 1 }
    return owner.current.generation
  }
  const generation = sync()
  const syncRef = useRef(() => { const before = owner.current.generation; if (sync() !== before) repaint() })
  syncRef.current = () => { const before = owner.current.generation; if (sync() !== before) repaint() }
  useEffect(() => {
    mounted.current = true
    const stopContext = subscribeTurnContext(() => syncRef.current())
    const stopCache = client.getQueryCache().subscribe(event => {
      if (event.type !== 'updated' && event.type !== 'removed') return
      if (event.query.queryKey[0] === 'personal' && ['semantic-index', 'workspace'].includes(String(event.query.queryKey[1])) && event.query.queryKey[2] === latest.current.notebookId) syncRef.current()
    })
    return () => { mounted.current = false; owner.current.generation++; stopContext(); stopCache() }
  }, [client])
  const visiblePreview = preview?.generation === generation ? preview : null
  const data = currentSemanticStatus(client, notebookId, sourceVersionIds)
  const profileRow = data?.profiles.find(row => row.profile.profile_id === profileId)
  const profile = profileRow?.profile
  const ready = status.isSuccess && !!profileRow && profileRow.index.state === 'ready' && profileRow.index.selected_version_count === sourceVersionIds.length && profileRow.index.indexed_version_count === sourceVersionIds.length && sourceVersionIds.length > 0
  const available = !!readTurnContext()?.ready && status.isSuccess && !status.isError && data?.enabled === true && !!profile && sourceVersionIds.length > 0
  const unresolved = !!submission.current && !submission.current.receipt
  // The status projection deliberately omits profile identity. Only exact index
  // child GETs may identify these immutable attempts; never infer from the
  // currently selected profile. At most 20 deduplicated metadata reads per view.
  const attemptJobs = [...new Map((data?.jobs ?? []).filter(job => job.state !== 'succeeded').map(job => [job.job_id, job])).values()]
  const inspectionOverflow = attemptJobs.length > 20
  const context = readTurnContext()
  const inspections = useQueries({ queries: attemptJobs.slice(0, 20).map(job => ({
    queryKey: QUERY_KEYS.semanticIndexAttempt(notebookId, job.job_id, JSON.stringify([sourceVersionIds, profileId, profile?.fingerprint, profile?.destination_descriptor_version, retrievalMode]), generation, context?.epoch),
    enabled: available && !inspectionOverflow, retry: false, staleTime: Infinity, gcTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!context || sync() !== generation) throw new RequestNotDispatchedError('superseded')
      assertTurnDispatch(context); assertResourceDispatch()
      return workbenchApi.job(job.job_id, signal, context)
    },
  })) })
  const attempt = (job: IndexJobStatus) => {
    const index = attemptJobs.findIndex(item => item.job_id === job.job_id)
    const result = inspections[index]
    const row = result?.isSuccess ? result.data : undefined
    if (!row || row.job_id !== job.job_id || row.notebook_id !== notebookId || row.operation !== 'index_evidence' || row.source_version_id !== job.source_version_id || !sourceVersionIds.includes(String(row.source_version_id)) ) return null
    if (row.restored_history === true) return row
    if (typeof row.profile_id !== 'string' || typeof row.profile_fingerprint !== 'string' || !row.profile_id || !row.profile_fingerprint) return null
    return row
  }
  const inspectionPending = !inspectionOverflow && attemptJobs.some((job, index) => index < 20 && inspections[index]?.isPending)
  const inspectionUnavailable = inspectionOverflow || attemptJobs.some(job => !attempt(job))
  const prior = inspectionUnavailable || attemptJobs.some(job => { const row = attempt(job); return row?.restored_history !== true && row?.profile_fingerprint === profile?.fingerprint })
  const canRetry = (job: IndexJobStatus) => { const row = attempt(job); return !!row && row.restored_history !== true && row.profile_id === profileId && ['failed', 'submission_unknown', 'cancelled_local'].includes(job.state) }
  const close = () => { setPreview(null); setAck(false); setDuplicateAck(false) }
  const openPreview = async (job?: IndexJobStatus) => {
    if (sync() !== generation || !available || pendingPreview.current || busy || unresolved || (job && (!job.source_version_id || !canRetry(job)))) return
    const context = readTurnContext(); if (!context) return
    const capturedGeneration = sync(); const versions = Object.freeze(job ? [job.source_version_id!] : [...sourceVersionIds])
    pendingPreview.current = true; setBusy(true); setProblem(false); close()
    try {
      assertTurnDispatch(context); assertResourceDispatch()
      const result = await evidenceApi.previewSemanticIndex(notebookId, versions, profile!.profile_id, context)
      if (!mounted.current || sync() !== capturedGeneration) return
      if (result.profile.fingerprint !== profile!.fingerprint || result.profile.destination_descriptor_version !== profile!.destination_descriptor_version || result.snapshot.notebook_id !== notebookId || JSON.stringify(result.snapshot.entries.map(entry => entry.version_id).sort()) !== JSON.stringify([...versions].sort())) { setProblem(true); return }
      const capturedPreview = Object.freeze({ ...result, profile: Object.freeze({ ...result.profile }), snapshot: Object.freeze({ ...result.snapshot, entries: Object.freeze(result.snapshot.entries.map(entry => Object.freeze({ ...entry }))) }), warnings: Object.freeze([...result.warnings]) }) as unknown as IndexPreview
      setPreview(Object.freeze({ generation: capturedGeneration, preview: capturedPreview, versions, retryOf: job?.job_id, context }))
    } catch { if (mounted.current && sync() === capturedGeneration) setProblem(true) }
    finally { pendingPreview.current = false; if (mounted.current) setBusy(false) }
  }
  const postOriginal = async (value: Submission) => {
    if (value.pending || !matchesEmbeddingDisclosure(value.embeddingDisclosure, { profileId: value.request.profile_id, fingerprint: value.profileFingerprint, descriptorVersion: value.destinationDescriptorVersion })) return
    try { assertTurnDispatch(value.context); assertResourceDispatch() } catch { return }
    value.pending = true; repaint()
    try {
      const receipt = await evidenceApi.buildSemanticIndex(value.notebookId, value.request, value.context)
      if (!mounted.current || submission.current !== value || readTurnContext()?.epoch !== value.context.epoch) return
      const versions = [...value.request.source_version_ids].sort()
      const jobIds = receipt.jobs?.map(job => job.job_id).sort()
      if (!receipt.group_id || receipt.notebook_id !== value.notebookId || receipt.profile_id !== value.request.profile_id || receipt.preview_hash !== value.request.preview_hash || receipt.profile_fingerprint !== value.profileFingerprint || receipt.retry_safe !== false || receipt.remote_cancel_confirmed !== false || !Array.isArray(receipt.jobs) || JSON.stringify(receipt.jobs.map(job => job.source_version_id).sort()) !== JSON.stringify(versions) || !Array.isArray(receipt.job_ids) || new Set(jobIds).size !== versions.length || JSON.stringify([...receipt.job_ids].sort()) !== JSON.stringify(jobIds) || receipt.jobs.some(job => !job.job_id || job.job_id === receipt.group_id || job.retry_safe !== false || job.remote_cancel_confirmed !== false)) throw new Error('receipt mismatch')
      value.receipt = Object.freeze({ ...receipt, jobs: Object.freeze(receipt.jobs.map(job => Object.freeze({ ...job, ...(job.error ? { error: Object.freeze({ ...job.error }) } : {}) }))), job_ids: Object.freeze([...receipt.job_ids]) }) as IndexReceipt
      void client.invalidateQueries({ queryKey: ['personal', 'semantic-index', value.notebookId] })
    } catch { /* Unknown is retained, never automatically replayed or replaced. */ }
    finally { value.pending = false; if (mounted.current) repaint() }
  }
  const confirm = () => {
    const value = visiblePreview
    if (!value || sync() !== value.generation || submission.current?.pending || unresolved || (value.preview.profile.destination_kind !== 'on_device' && !ack) || (value.retryOf && !duplicateAck)) return
    let key: string; try { key = crypto.randomUUID() } catch { setProblem(true); return }
    const request = Object.freeze({ source_version_ids: value.versions, profile_id: value.preview.profile.profile_id, preview_hash: value.preview.preview_hash,
      acknowledge_external_processing: ack, idempotency_key: key, ...(value.retryOf ? { retry_of_job_id: value.retryOf } : {}), acknowledge_duplicate_embedding_cost: !!value.retryOf && duplicateAck })
    const embeddingDisclosure = captureEmbeddingDisclosure(value.preview.profile)
    if (!embeddingDisclosure) { setProblem(true); return }
    const captured = { notebookId, request, embeddingDisclosure, destinationDescriptorVersion: value.preview.profile.destination_descriptor_version, context: value.context, profileFingerprint: value.preview.profile.fingerprint, pending: false }
    submission.current = captured; close(); void postOriginal(captured)
  }
  const cancel = async (job: IndexJobStatus) => {
    const context = readTurnContext(); if (!context || busy || sync() !== generation) return
    setBusy(true); setProblem(false)
    try { assertTurnDispatch(context); assertResourceDispatch(); await workbenchApi.cancelJob(job.job_id, context); void status.refetch() }
    catch { if (mounted.current) setProblem(true) }
    finally { if (mounted.current) setBusy(false) }
  }
  const original = submission.current
  const originalDisclosureSafe = !!original && matchesEmbeddingDisclosure(original.embeddingDisclosure, { profileId: original.request.profile_id, fingerprint: original.profileFingerprint, descriptorVersion: original.destinationDescriptorVersion })
  return <section aria-label={t('workbench.semanticIndex')} className="space-y-2 rounded-md border p-3 text-xs">
    <h3 className="font-semibold">{t('workbench.semanticIndex')}</h3>
    <label className="block space-y-1"><span>{t('workbench.embeddingProfile')}</span><select className="w-full rounded border bg-background p-2" value={profileId ?? ''} onChange={event => { const selected = event.target.value || null; latest.current.profileId = selected; onProfileChange(selected); syncRef.current(); close() }}><option value="">{t('workbench.chooseEmbeddingProfile')}</option>{data?.profiles.map(row => <option key={row.profile.profile_id} value={row.profile.profile_id}>{row.profile.profile_id}</option>)}</select></label>
    {!profile && <p role="status">{t('workbench.chooseEmbeddingProfile')}</p>}
    {profile && <><EmbeddingIdentity disclosure={captureEmbeddingDisclosure(profile)} /><p>{t('workbench.embeddingConfigured')}</p><p className="break-all">{profile.endpoint}</p><p>{t('workbench.embeddingDestination', { kind: t(embeddingDestinationKeys[profile.destination_kind] ?? embeddingDestinationKeys.unknown), version: profile.destination_descriptor_version })}</p><p role="status">{t(ready ? 'workbench.semanticReady' : 'workbench.semanticNotReady')}</p><p>{t('workbench.semanticCoverage', { indexed: profileRow!.index.indexed_version_count, selected: profileRow!.index.selected_version_count })}</p></>}
    {data?.enabled === false && <p role="status">{t('workbench.hybridDisabled')}</p>}
    {available && attemptJobs.length > 0 && inspectionPending && <p role="status">{t('workbench.indexInspecting')}</p>}
    {available && attemptJobs.length > 0 && !inspectionPending && inspectionUnavailable && <p role="status">{t('workbench.indexInspectionUnavailable')}</p>}
    {status.isError && <p role="alert">{t('workbench.semanticStatusFailed')}</p>}
    {problem && <p role="alert">{t('workbench.semanticActionFailed')}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!available || busy || unresolved || prior} onClick={() => { void openPreview() }}>{t('workbench.previewIndex')}</Button><Button size="sm" variant="ghost" disabled={!sourceVersionIds.length || status.isFetching} onClick={() => { void status.refetch(); for (const inspection of inspections) void inspection.refetch() }}>{t('workbench.refreshIndexStatus')}</Button></div>
    <p>{t('workbench.indexExtractionSeparate')}</p>
    {original && <div className="space-y-2 border-t pt-2">
      <p>{t(original.receipt ? 'workbench.indexReceipt' : original.pending ? 'workbench.indexSubmitting' : 'workbench.indexUnknown')}</p>
      <OriginalEmbeddingDisclosure mode="documents" summary={original.embeddingDisclosure} identity={{ profileId: original.request.profile_id, fingerprint: original.profileFingerprint, descriptorVersion: original.destinationDescriptorVersion }} sourceVersionIds={original.request.source_version_ids} />
      {original.receipt ? <p className="break-all">{original.receipt.group_id} · {original.receipt.state}</p> : <><p>{t('workbench.indexRecoveryWarning')}</p><Button size="sm" variant="outline" disabled={!originalDisclosureSafe || original.pending || !readTurnContext()?.ready || readTurnContext()?.epoch !== original.context.epoch} onClick={() => { void postOriginal(original) }}>{t('workbench.recoverIndexSubmission')}</Button></>}
    </div>}
    {data?.jobs.map(job => <div className="border-t pt-2 space-y-1" key={job.job_id}><p className="break-all">{job.source_version_id ?? job.job_id}</p><p>{t('workbench.indexJobProgress', { state: job.state, stage: job.stage, completed: job.completed_evidence, total: job.total_evidence })}</p>{!['queued', 'running', 'succeeded', 'failed', 'submission_unknown', 'cancelled_local'].includes(job.state) && <p>{t('workbench.indexUnknown')}</p>}{job.error && <p>{job.error.code}</p>}{['queued', 'running'].includes(job.state) && <Button size="sm" variant="outline" disabled={busy} onClick={() => { void cancel(job) }}>{t('workbench.cancelWaiting')}</Button>}{canRetry(job) && job.source_version_id && <Button size="sm" variant="outline" disabled={!available || busy || unresolved} onClick={() => { void openPreview(job) }}>{t('workbench.retryFullVersion')}</Button>}<p>{t('workbench.indexCancelMeaning')}</p></div>)}
    <Dialog open={!!visiblePreview} onOpenChange={open => { if (!open) close() }}><DialogContent className="max-w-lg"><DialogTitle>{t('workbench.previewIndex')}</DialogTitle>{visiblePreview && <form aria-label={t('workbench.previewIndex')} onSubmit={event => { event.preventDefault(); confirm() }} className="space-y-3">
      <EmbeddingIdentity disclosure={captureEmbeddingDisclosure(visiblePreview.preview.profile)} />
      <p className="break-all">{visiblePreview.versions.join(', ')}</p><p className="break-all">{visiblePreview.preview.profile.endpoint}</p>
      <p>{t('workbench.embeddingDestination', { kind: t(embeddingDestinationKeys[visiblePreview.preview.profile.destination_kind] ?? embeddingDestinationKeys.unknown), version: visiblePreview.preview.profile.destination_descriptor_version })}</p>
      <p>{t('workbench.indexCounts', { evidence: visiblePreview.preview.evidence_count, bytes: visiblePreview.preview.input_bytes })}</p>
      <p>{t('workbench.documentQuerySeparate')}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />{t('workbench.ackDocumentProcessing')}</label>
      {visiblePreview.retryOf && <label className="flex items-start gap-2"><input type="checkbox" checked={duplicateAck} onChange={event => setDuplicateAck(event.target.checked)} />{t('workbench.ackDuplicateCost')}</label>}
      {visiblePreview.preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={close}>{t('workbench.cancelIndexPreview')}</Button><Button type="submit" disabled={(visiblePreview.preview.profile.destination_kind !== 'on_device' && !ack) || (!!visiblePreview.retryOf && !duplicateAck)}>{t('workbench.confirmIndex')}</Button></div>
    </form>}</DialogContent></Dialog>
  </section>
}
