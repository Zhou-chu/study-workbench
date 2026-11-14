'use client'

import { isAuthRecoveryError } from '@/lib/api/browser-transport'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { evidenceApi } from '@/lib/api/evidence'
import { workbenchApi } from '@/lib/api/workbench'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { activeJob } from '@/lib/hooks/use-workbench'
import { useTranslation } from '@/lib/hooks/use-translation'
import { requestError, stateKeys } from '@/lib/utils/workbench'
import type { BridgeJob } from '@/lib/types/personal'
import { Button } from '@/components/ui/button'

interface Props {
  versionId: string
  extractionId?: string
  restored: boolean
  snapshot?: boolean
  onComplete: () => void
}
/** A keyed instance owns only its own local job. Leaving the reader stops polling,
 * not the durable CPU task. Mutations are never automatically replayed. */
export function EvidenceMaintenance({ versionId, extractionId, restored, snapshot = false, onComplete }: Props) {
  const { t } = useTranslation()
  const controller = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const handled = useRef<string | null>(null)
  const completed = useRef(onComplete)
  completed.current = onComplete
  const [job, setJob] = useState<BridgeJob | null>(null)
  const [operation, setOperation] = useState<'reparse' | 'revalidate'>('reparse')
  useEffect(() => () => controller.current?.abort(), [])
  const submit = useMutation({
    mutationFn: async (kind: 'reparse' | 'revalidate') => {
      const key = crypto.randomUUID()
      controller.current = new AbortController()
      return kind === 'revalidate' && extractionId
        ? evidenceApi.revalidate(versionId, extractionId, key, controller.current!.signal)
        : evidenceApi.reparse(versionId, key, controller.current!.signal)
    },
    retry: false,
    onSuccess: value => { if (!controller.current!.signal.aborted) setJob(value) },
    onError: () => { busy.current = false },
  })
  const status = useQuery({
    queryKey: QUERY_KEYS.personalJob(job?.job_id || ''),
    queryFn: ({ signal }) => workbenchApi.job(job!.job_id, signal),
    enabled: !!job && activeJob(job.state),
    retry: false,
    refetchInterval: query => !isAuthRecoveryError(query.state.error) && activeJob(query.state.data?.state) ? 1000 : false,
  })
  const current = status.data || job
  useEffect(() => {
    if (!current || activeJob(current.state) || controller.current!.signal.aborted) return
    busy.current = false
    if (current.state === 'succeeded' && handled.current !== current.job_id) {
      handled.current = current.job_id
      completed.current()
    }
  }, [current])
  const start = (kind: 'reparse' | 'revalidate') => {
    if (busy.current) return
    busy.current = true
    handled.current = null
    setJob(null)
    setOperation(kind)
    submit.mutate(kind)
  }
  const waiting = submit.isPending || (!!current && activeJob(current.state))
  const result = current?.state === 'succeeded' && current.restored_history !== true && current.result && typeof current.result === 'object' && !Array.isArray(current.result) ? current.result as Record<string, unknown> : null
  const validCounts = result && ['checked_count', 'verified_count', 'unverified_count'].every(key => typeof result[key] === 'number' && Number.isSafeInteger(result[key]) && Number(result[key]) >= 0)
  const error = submit.error || status.error
  const errorObject = current?.error && typeof current.error === 'object' ? current.error as Record<string, unknown> : undefined
  const jobError = typeof current?.error === 'string' ? current.error : typeof errorObject?.message === 'string' ? errorObject.message : undefined
  return <div className="space-y-2 pt-3 text-xs">
    <p className="text-muted-foreground">{t(snapshot ? 'webDiscovery.snapshotMaintenance' : 'workbench.maintenanceMeaning')}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={waiting} onClick={() => start('reparse')}>{t(snapshot ? 'workbench.jobOperations.reparse' : 'workbench.reparse')}</Button>
      {!snapshot && restored && extractionId && <Button size="sm" variant="outline" disabled={waiting} onClick={() => start('revalidate')}>{t('workbench.revalidate')}</Button>}
    </div>
    {waiting && <p role="status">{t('workbench.maintenancePending')}</p>}
    {current && !waiting && current.state !== 'succeeded' && <p role="status">{t(Object.hasOwn(stateKeys, current.state) ? stateKeys[current.state] : 'workbench.unavailable')}</p>}
    {result && operation === 'reparse' && <p role="status">{t('workbench.reparseComplete')}</p>}
    {result && validCounts && operation === 'revalidate' && <p role="status">{t(Number(result.unverified_count) > 0 ? 'workbench.revalidationPartial' : 'workbench.revalidationComplete', { checked: Number(result.checked_count), verified: Number(result.verified_count), unverified: Number(result.unverified_count) })}</p>}
    {(error || jobError) && <p role="alert" className="text-destructive">{requestError(error) || jobError || t('workbench.error')}</p>}
    {status.isError && <Button size="sm" variant="outline" onClick={() => status.refetch()}>{t('workbench.refreshJob')}</Button>}
  </div>
}
