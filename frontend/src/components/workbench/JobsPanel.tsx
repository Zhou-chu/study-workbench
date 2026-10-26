'use client'
import { isAuthRecoveryError } from '@/lib/api/browser-transport'
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { workbenchApi } from '@/lib/api/workbench'
import { portableApi, saveBlob } from '@/lib/api/portable'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { activeJob } from '@/lib/hooks/use-workbench'
import { useTranslation } from '@/lib/hooks/use-translation'
import { requestError, stateKeys } from '@/lib/utils/workbench'
import type { BridgeJob } from '@/lib/types/personal'
import { Button } from '@/components/ui/button'

const operationKeys: Record<string, string> = {
  extract_evidence: 'workbench.jobOperations.extract',
  source_snapshot: 'sourceSnapshots.add',
  web_import: 'webDiscovery.imported',
  read: 'workbench.jobOperations.read',
  reparse: 'workbench.jobOperations.reparse',
  revalidate: 'workbench.jobOperations.revalidate',
  portable_export: 'workbench.jobOperations.export',
  portable_import: 'workbench.jobOperations.import',
  import: 'workbench.jobOperations.import',
  chat: 'workbench.jobOperations.question',
  ask: 'workbench.jobOperations.question',
  question: 'workbench.jobOperations.question',
  outline: 'workbench.jobOperations.outline',
  audio: 'workbench.jobOperations.audio',
  sync: 'workbench.jobOperations.sync',
  create_notebook: 'workbench.jobOperations.createNotebook',
  download: 'workbench.jobOperations.download',
}

function canPoll(job: BridgeJob | undefined) {
  return !!job && job.restored_history !== true && job.replay_allowed !== false && typeof job.operation === 'string' && Object.hasOwn(operationKeys, job.operation) && activeJob(job.state)
}

export type TurnFence = { key: string; parentJobId?: string; turnId?: string }
function isFenced(job: BridgeJob, fence?: TurnFence): boolean {
  if (!fence) return false
  if (job.job_id === fence.parentJobId || (fence.turnId && job.turn_id === fence.turnId)) return true
  const snapshot = job.request_snapshot && typeof job.request_snapshot === 'object' && !Array.isArray(job.request_snapshot) ? job.request_snapshot as Record<string, unknown> : null
  const keys = [job.idempotency_key, snapshot?.idempotency_key].filter((key): key is string => typeof key === 'string' && !!key.trim())
  if (keys.includes(fence.key)) return true
  return (job.operation === 'chat' || job.operation === 'ask') && keys.length === 0
}
function JobCard({ job, onChanged, fenced }: { job: BridgeJob; onChanged: () => void; fenced: boolean }) {
  const { t } = useTranslation()
  const [audioUrl, setAudioUrl] = useState<string>()
  const status = useQuery({ queryKey: QUERY_KEYS.personalJob(job.job_id), queryFn: () => workbenchApi.job(job.job_id), initialData: job, enabled: !fenced && canPoll(job), retry: false, refetchInterval: query => !fenced && !isAuthRecoveryError(query.state.error) && canPoll(query.state.data) ? 2000 : false })
  const current = fenced ? job : status.data || job
  const knownOperation = typeof current.operation === 'string' && Object.hasOwn(operationKeys, current.operation)
  const knownState = ['queued', 'running', 'waiting_remote', 'succeeded', 'failed', 'needs_reauth', 'submission_unknown', 'cancelled_local'].includes(current.state)
  const live = current.restored_history !== true && current.replay_allowed !== false
  const remoteWork = current.provider === 'notebooklm' || current.operation === 'chat'
  const canCancel = live && knownOperation && knownState && (current.state === 'queued' || (current.state === 'running' && current.operation === 'chat') || (activeJob(current.state) && current.provider === 'notebooklm'))
  const cancel = useMutation({ mutationFn: () => workbenchApi.cancelJob(job.job_id), retry: false, onSuccess: () => { if (!fenced) void status.refetch(); onChanged() } })
  const result = current.result && typeof current.result === 'object' && !Array.isArray(current.result) ? current.result as Record<string, unknown> : undefined
  const artifact = result?.artifact && typeof result.artifact === 'object' && !Array.isArray(result.artifact) ? result.artifact as Record<string, unknown> : undefined
  const artifactId = typeof artifact?.artifact_id === 'string' && artifact.artifact_id ? artifact.artifact_id : undefined
  const audio = typeof artifact?.mime_type === 'string' && artifact.mime_type.startsWith('audio/')
  const candidate = typeof result?.download_url === 'string' ? result.download_url : (artifactId && result?.downloaded === true ? `/personal/artifacts/${encodeURIComponent(artifactId)}/download` : undefined)
  const downloadUrl = knownOperation && knownState && candidate && /^\/(?:api\/)?personal\/(?:exports|artifacts)\/[^/?#]+\/download$/.test(candidate) ? candidate : undefined
  const download = useMutation({ mutationFn: async (play: boolean) => {
    if (!downloadUrl) return
    const blob = await portableApi.download(downloadUrl)
    if (play && blob.type.startsWith('audio/')) setAudioUrl(URL.createObjectURL(blob))
    else saveBlob(blob, `${artifactId || job.job_id}.${blob.type.startsWith('audio/') ? (blob.type.includes('wav') ? 'wav' : 'mp3') : 'zip'}`)
  }, retry: false })
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
  const errorObject = current.error && typeof current.error === 'object' ? current.error as Record<string, unknown> : undefined
  const errorText = typeof current.error === 'string' ? current.error : typeof errorObject?.message === 'string' ? errorObject.message : undefined
  return <article className="rounded-md border p-3 space-y-2 text-xs">
    <p className="font-medium">{t(knownOperation && typeof current.operation === 'string' ? operationKeys[current.operation] : 'workbench.jobOperations.other')}</p>
    <p role="status">{t(Object.hasOwn(stateKeys, current.state) ? stateKeys[current.state] : 'workbench.unavailable')}</p>
    {current.state === 'submission_unknown' && <p className="text-muted-foreground">{t('workbench.unknownSubmission')}</p>}
    {errorText && <p className="text-destructive">{errorText}</p>}
    {result?.downloaded === false && <p className="text-muted-foreground">{t('workbench.artifactNotSaved')}</p>}
    {typeof result?.download_error === 'string' && <p className="text-muted-foreground">{result.download_error}</p>}
    {result?.import_report != null && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(result.import_report, null, 2)}</pre>}
    {((!fenced && status.isError) || cancel.isError || download.isError) && <p role="alert" className="text-destructive">{requestError((!fenced && status.error) || cancel.error || download.error) || t('workbench.error')}</p>}
    {(current.remote_may_continue === true || (['running', 'waiting_remote'].includes(current.state) && remoteWork)) && <p className="text-muted-foreground">{t('workbench.remoteMayContinue')}</p>}
    {canCancel && <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t('workbench.cancelWaiting')}</Button>}
    {downloadUrl && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(false)}>{t('workbench.downloadResult')}</Button>{audio && <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(true)}>{t('workbench.playAudio')}</Button>}</div>}
    <details className="text-muted-foreground">
      <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t('workbench.jobTechnicalDetails')}</summary>
      <dl className="mt-2 space-y-1 break-all">
        <div><dt>{t('workbench.jobId')}</dt><dd>{current.job_id}</dd></div>
        <div><dt>{t('workbench.jobOperation')}</dt><dd>{typeof current.operation === 'string' ? current.operation : JSON.stringify(current.operation)}</dd></div>
      </dl>
      {typeof current.submission_state === 'string' && <p>{t('workbench.submissionStatus', { status: current.submission_state })}</p>}
      {(current.restored_history === true || !knownOperation || !knownState) && <pre className="whitespace-pre-wrap break-words">{JSON.stringify(current, null, 2)}</pre>}
    </details>
    {audioUrl && <audio className="w-full" controls src={audioUrl} />}
  </article>
}
export function JobsPanel({ jobs, onChanged, turnFence }: { jobs: BridgeJob[]; onChanged: () => void; turnFence?: TurnFence }) {
  const { t } = useTranslation()
  return <section className="space-y-3 border-t pt-3"><h3 className="font-semibold">{t('workbench.jobs')}</h3>{!jobs.length && <p className="text-xs text-muted-foreground">{t('workbench.noJobs')}</p>}{jobs.map(job => <JobCard key={job.job_id} job={job} onChanged={onChanged} fenced={isFenced(job, turnFence)} />)}</section>
}
