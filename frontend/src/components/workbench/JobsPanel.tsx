'use client'
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

function JobCard({ job, onChanged }: { job: BridgeJob; onChanged: () => void }) {
  const { t } = useTranslation()
  const [audioUrl, setAudioUrl] = useState<string>()
  const status = useQuery({ queryKey: QUERY_KEYS.personalJob(job.job_id), queryFn: () => workbenchApi.job(job.job_id), initialData: job, enabled: activeJob(job.state), retry: false, refetchInterval: query => activeJob(query.state.data?.state) ? 2000 : false })
  const current = status.data || job
  const remoteWork = current.provider === 'notebooklm' || current.operation === 'chat'
  const canCancel = current.state === 'queued' || (current.state === 'running' && current.operation === 'chat') || (activeJob(current.state) && current.provider === 'notebooklm')
  const cancel = useMutation({ mutationFn: () => workbenchApi.cancelJob(job.job_id), retry: false, onSuccess: () => { status.refetch(); onChanged() } })
  const artifact = current.result?.artifact as { artifact_id?: string; mime_type?: string } | undefined
  const downloadUrl = current.result?.download_url || (artifact?.artifact_id && current.result?.downloaded ? `/personal/artifacts/${encodeURIComponent(artifact.artifact_id)}/download` : undefined)
  const download = useMutation({ mutationFn: async (play: boolean) => {
    if (!downloadUrl) return
    const blob = await portableApi.download(downloadUrl)
    if (play && blob.type.startsWith('audio/')) setAudioUrl(URL.createObjectURL(blob))
    else saveBlob(blob, `${artifact?.artifact_id || job.job_id}.${blob.type.startsWith('audio/') ? (blob.type.includes('wav') ? 'wav' : 'mp3') : 'zip'}`)
  }, retry: false })
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
  const errorText = typeof current.error === 'string' ? current.error : (current.error as { message?: string } | null)?.message
  return <article className="rounded-md border p-3 space-y-2 text-xs">
    <p className="font-medium break-all">{current.operation} · {current.job_id}</p>
    <p role="status">{t(stateKeys[current.state] || 'workbench.unavailable')}</p>
    {current.submission_state && <p>{t('workbench.submissionStatus', { status: current.submission_state })}</p>}
    {current.state === 'submission_unknown' && <p className="text-muted-foreground">{t('workbench.unknownSubmission')}</p>}
    {errorText && <p className="text-destructive">{errorText}</p>}
    {current.result?.downloaded === false && <p className="text-muted-foreground">{t('workbench.artifactNotSaved')}</p>}
    {typeof current.result?.download_error === 'string' && <p className="text-muted-foreground">{current.result.download_error}</p>}
    {current.result?.import_report != null && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(current.result.import_report, null, 2)}</pre>}
    {(status.isError || cancel.isError || download.isError) && <p role="alert" className="text-destructive">{requestError(status.error || cancel.error || download.error) || t('workbench.error')}</p>}
    {(current.remote_may_continue || (['running', 'waiting_remote'].includes(current.state) && remoteWork)) && <p className="text-muted-foreground">{t('workbench.remoteMayContinue')}</p>}
    {canCancel && <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t('workbench.cancelWaiting')}</Button>}
    {downloadUrl && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(false)}>{t('workbench.downloadResult')}</Button>{artifact?.mime_type?.startsWith('audio/') && <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(true)}>{t('workbench.playAudio')}</Button>}</div>}
    {audioUrl && <audio className="w-full" controls src={audioUrl} />}
  </article>
}
export function JobsPanel({ jobs, onChanged }: { jobs: BridgeJob[]; onChanged: () => void }) {
  const { t } = useTranslation()
  return <section className="space-y-3 border-t pt-3"><h3 className="font-semibold">{t('workbench.jobs')}</h3>{!jobs.length && <p className="text-xs text-muted-foreground">{t('workbench.noJobs')}</p>}{jobs.map(job => <JobCard key={job.job_id} job={job} onChanged={onChanged} />)}</section>
}
