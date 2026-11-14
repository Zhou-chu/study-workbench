'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSourceSnapshot } from '@/lib/hooks/use-source-snapshot'
import { useTranslation } from '@/lib/hooks/use-translation'
import { sourceSnapshotKey } from '@/lib/utils/source-snapshot-key'
import type { SnapshotOrigin, SourceSnapshotRequest, SourceSnapshotResult } from '@/lib/types/source-snapshots'

const labels = {
  add: 'sourceSnapshots.add',
  adding: 'sourceSnapshots.adding',
  added: 'sourceSnapshots.added',
  alreadyAdded: 'sourceSnapshots.alreadyAdded',
  retry: 'sourceSnapshots.retry',
  failed: 'sourceSnapshots.failed',
  unknownOutcome: 'sourceSnapshots.unknownOutcome',
  conflict: 'sourceSnapshots.conflict',
  empty: 'sourceSnapshots.empty',
  resultNotReady: 'sourceSnapshots.resultNotReady',
  tooLarge: 'sourceSnapshots.tooLarge',
} as const

interface SnapshotProblem {
  key: 'unknownOutcome' | 'conflict' | 'empty' | 'resultNotReady' | 'tooLarge' | 'failed'
  retryable: boolean
}
interface Operation {
  request?: SourceSnapshotRequest
  state: 'pending' | 'succeeded' | 'failed'
  result?: SourceSnapshotResult
  problem?: SnapshotProblem
}

function snapshotProblem(error: unknown): SnapshotProblem {
  const response = (error as { response?: { status?: number; data?: { detail?: string | { code?: string }; error?: { code?: string } } } })?.response
  const detail = response?.data?.detail
  const code = (typeof detail === 'object' ? detail?.code : detail) || response?.data?.error?.code || ''
  if (code === 'NOTE_REVISION_CONFLICT' || code === 'SNAPSHOT_IDEMPOTENCY_CONFLICT') return { key: 'conflict', retryable: false }
  if (code === 'EMPTY_SNAPSHOT') return { key: 'empty', retryable: false }
  if (code === 'RESULT_NOT_READY') return { key: 'resultNotReady', retryable: true }
  if (code === 'SNAPSHOT_TOO_LARGE' || response?.status === 413) return { key: 'tooLarge', retryable: false }
  if (!response?.status || response.status >= 500) return { key: 'unknownOutcome', retryable: true }
  return { key: 'failed', retryable: response.status === 401 || response.status === 429 }
}

export interface SnapshotPromotionButtonProps {
  notebookId: string
  origin: SnapshotOrigin
  onAdded?: (result: SourceSnapshotResult) => void
}

/** Only pass saved notes or completed turns. This action never edits a draft. */
export function SnapshotPromotionButton({ notebookId, origin, onAdded }: SnapshotPromotionButtonProps) {
  const { t } = useTranslation()
  const mutation = useSourceSnapshot()
  const messageId = useId()
  const [operations, setOperations] = useState<Record<string, Operation>>({})
  // A synchronous guard covers repeated clicks before React updates the DOM.
  // Retain requests per origin so switching cards/revisions cannot lose a key.
  const operationsRef = useRef(new Map<string, Operation>())
  const operationId = JSON.stringify([notebookId, origin.kind, origin.id, origin.kind === 'note' ? origin.revision : null])
  const operation = operations[operationId]
  const problem = operation?.problem
  const pending = operation?.state === 'pending'
  const succeeded = operation?.state === 'succeeded'

  const submit = async () => {
    const existing = operationsRef.current.get(operationId)
    if (existing?.state === 'pending' || existing?.state === 'succeeded' || (existing?.problem && !existing.problem.retryable)) return
    let request = existing?.request
    const update = (value: Operation) => {
      operationsRef.current.set(operationId, value)
      setOperations(previous => ({ ...previous, [operationId]: value }))
    }
    update({ request, state: 'pending' })
    let result: SourceSnapshotResult
    try {
      if (!request) {
        const key = await sourceSnapshotKey(notebookId, origin)
        request = origin.kind === 'note'
          ? { origin_kind: 'note', note_id: origin.id, expected_revision: origin.revision, idempotency_key: key }
          : { origin_kind: 'turn', turn_id: origin.id, idempotency_key: key }
        update({ request, state: 'pending' })
      }
      result = await mutation.mutateAsync({ notebookId, request })
    } catch (error) {
      update({ request, state: 'failed', problem: snapshotProblem(error) })
      return
    }
    update({ request, state: 'succeeded', result })
    // A consumer exception cannot turn an acknowledged snapshot into a retry.
    onAdded?.(result)
  }

  const label = pending ? 'adding' : succeeded ? (operation.result?.existing ? 'alreadyAdded' : 'added') : problem?.retryable ? 'retry' : 'add'
  return <div className="space-y-1.5">
    <Button type="button" size="sm" variant="outline" disabled={pending || succeeded || Boolean(problem && !problem.retryable)} aria-describedby={problem ? messageId : undefined} onClick={() => { void submit() }}>
      {t(labels[label])}
    </Button>
    {problem && <p id={messageId} role="alert" className="text-xs text-muted-foreground">{t(labels[problem.key])}</p>}
  </div>
}
